-- ============================================================================
-- Migration 0129: Permitir reservar slot de turno fijo liberado y permisos granulares de inventario
-- ============================================================================
-- 1. Helper has_user_permission(p_modulo, p_accion) para validar permisos
--    tanto de admin como de vendedor con permisos específicos asignados.
-- 2. fn_crear_reserva y fn_reservar_desde_app: permiten reservar un slot
--    cuando el turno fijo recurrente fue liberado (cancelado) para esa fecha.
-- 3. fn_ajustar_stock y órdenes de compra: permiten operar si el usuario
--    tiene permiso ('inventario', 'editar').
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Helper function: has_user_permission
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_user_permission(p_modulo TEXT, p_accion TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_rol VARCHAR;
  v_permisos JSONB;
BEGIN
  -- Superadmin de plataforma siempre tiene permisos
  IF current_user_is_plataforma_admin() THEN
    RETURN TRUE;
  END IF;

  SELECT rol, permisos INTO v_rol, v_permisos
  FROM usuarios
  WHERE id = auth.uid();

  -- Si es admin del club, tiene todos los permisos
  IF v_rol = 'admin' THEN
    RETURN TRUE;
  END IF;

  -- Si no es admin ni vendedor, no tiene permisos
  IF v_rol <> 'vendedor' THEN
    RETURN FALSE;
  END IF;

  -- Si tiene permisos granulares configurados en JSON
  -- Estructura: {"modulos": {"inventario": {"ver": true, "editar": true}}}
  IF v_permisos IS NOT NULL 
     AND (v_permisos->'modulos'->p_modulo ? p_accion) THEN
    RETURN (v_permisos->'modulos'->p_modulo->>p_accion)::BOOLEAN;
  END IF;

  -- Defaults para vendedor alineados con src/lib/permisos.ts
  IF p_modulo IN ('reservas', 'noticias', 'caja', 'mostrador', 'finanzas') THEN
    RETURN TRUE;
  ELSIF p_modulo = 'configuracion' THEN
    RETURN (p_accion = 'ver');
  ELSIF p_modulo = 'inventario' THEN
    RETURN FALSE;
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_user_permission(TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. fn_crear_reserva contemplando turnos fijos liberados para p_fecha
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_crear_reserva(
  p_cancha_id BIGINT,
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INTEGER,
  p_jugador_titular_id BIGINT,
  p_jugadores_ids BIGINT[],
  p_nombres_libres VARCHAR[],
  p_tarifa_id BIGINT,
  p_monto_total DECIMAL,
  p_monto_pagado DECIMAL,
  p_medio_pago VARCHAR,
  p_estado VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva reservas;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_hora_fin TIME;
  v_monto_sena DECIMAL(12,2);
  v_tipo_pago VARCHAR(20);
  v_jid BIGINT;
  v_nombre VARCHAR;
  v_turno_fijo_titular_nombre VARCHAR;
  v_cuenta_id BIGINT;
  v_titular_reserva_jugador_id BIGINT;
  v_turno_caja_id BIGINT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  -- 1. Chequeo de clase activa en esa cancha (ignorando clases liberadas para p_fecha)
  IF EXISTS (
    SELECT 1
    FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND (
        (c.es_recurrente IS NOT FALSE AND EXTRACT(ISODOW FROM p_fecha)::INT = ANY(c.dias_semana))
        OR (c.es_recurrente IS FALSE AND c.fecha_clase = p_fecha)
      )
      AND NOT EXISTS (
        SELECT 1 FROM clase_ocurrencias co
        WHERE co.clase_id = c.id
          AND co.fecha = p_fecha
          AND co.estado IN ('cancelada', 'liberada')
      )
      AND tsrange(
        (p_fecha + c.hora_inicio)::timestamp,
        (p_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con una clase configurada en esa cancha.';
  END IF;

  -- 2. Bloqueo de slots de turnos fijos activos vigentes
  -- Se excluye si el turno fijo fue liberado / cancelado para esta fecha específica
  SELECT COALESCE(j.nombre, tf.nombre_libre)
    INTO v_turno_fijo_titular_nombre
  FROM turnos_fijos tf
  LEFT JOIN jugadores j ON j.id = tf.jugador_id
  WHERE tf.club_id = v_club_id
    AND tf.cancha_id = p_cancha_id
    AND tf.activo = TRUE
    AND tf.dia_semana = EXTRACT(ISODOW FROM p_fecha)::INT
    AND tf.fecha_desde <= p_fecha
    AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha)
    AND tsrange(
      ('1970-01-01'::date + tf.hora_inicio)::timestamp,
      ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
    ) && tsrange(
      ('1970-01-01'::date + p_hora_inicio)::timestamp,
      ('1970-01-01'::date + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
    )
    AND NOT EXISTS (
      SELECT 1 FROM reservas r_cancel
      WHERE r_cancel.club_id = v_club_id
        AND r_cancel.turno_fijo_id = tf.id
        AND r_cancel.fecha = p_fecha
        AND r_cancel.estado = 'cancelada'
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Ese horario está reservado para el turno fijo de %. No se puede reservar suelto. Si querés liberar el slot, desactivá o eliminá el turno fijo desde Reservas → Turnos fijos.',
      v_turno_fijo_titular_nombre;
  END IF;

  -- 3. Chequeo de superposición con otra reserva activa existente en la misma cancha
  IF EXISTS (
    SELECT 1
    FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = p_cancha_id
      AND r.fecha = p_fecha
      AND r.estado != 'cancelada'
      AND tsrange(
        (p_fecha + r.hora_inicio)::timestamp,
        (p_fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario ya está ocupado por otra reserva en esa cancha.';
  END IF;

  v_monto_sena := CASE WHEN p_estado = 'senada' THEN p_monto_pagado ELSE 0 END;
  v_tipo_pago := CASE WHEN p_estado = 'senada' THEN 'sena' ELSE 'pago' END;

  -- 1. Insert reservas
  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
    duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
    estado, observaciones, usuario_alta_id
  ) VALUES (
    v_club_id, p_cancha_id, p_jugador_titular_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_duracion_min, p_tarifa_id, p_monto_total, v_monto_sena, p_monto_pagado,
    p_estado, p_observaciones, v_usuario_id
  ) RETURNING * INTO v_reserva;

  -- 2. Titular (si lo hay).
  IF p_jugador_titular_id IS NOT NULL THEN
    INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
    VALUES (v_club_id, v_reserva.id, p_jugador_titular_id, TRUE)
    RETURNING id INTO v_titular_reserva_jugador_id;
  END IF;

  -- 3. Acompañantes con jugador_id.
  IF p_jugadores_ids IS NOT NULL THEN
    FOREACH v_jid IN ARRAY p_jugadores_ids LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
      VALUES (v_club_id, v_reserva.id, v_jid, FALSE);
    END LOOP;
  END IF;

  -- 4. Acompañantes "nombre libre".
  IF p_nombres_libres IS NOT NULL THEN
    FOREACH v_nombre IN ARRAY p_nombres_libres LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, nombre_libre, es_titular)
      VALUES (
        v_club_id,
        v_reserva.id,
        v_nombre,
        (p_jugador_titular_id IS NULL AND v_titular_reserva_jugador_id IS NULL)
      )
      RETURNING id INTO v_jid;

      IF p_jugador_titular_id IS NULL AND v_titular_reserva_jugador_id IS NULL THEN
        v_titular_reserva_jugador_id := v_jid;
      END IF;
    END LOOP;
  END IF;

  -- 5. Pago inicial si hubo.
  IF p_monto_pagado > 0 THEN
    IF p_medio_pago IS NULL THEN
      RAISE EXCEPTION 'Si hay un pago, el medio de pago es obligatorio.';
    END IF;

    IF p_cuenta_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id
      ) THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT cuenta_id INTO v_cuenta_id
      FROM medio_cuenta_default
      WHERE club_id = v_club_id AND medio_pago = p_medio_pago;
    END IF;

    IF p_medio_pago = 'efectivo' THEN
      v_turno_caja_id := current_club_caja_abierta();
    END IF;

    INSERT INTO reserva_pagos (
      club_id,
      reserva_id,
      monto,
      medio_pago,
      tipo,
      usuario_id,
      cuenta_id,
      jugador_id,
      reserva_jugador_id,
      monto_alquiler,
      monto_consumo,
      turno_caja_id
    ) VALUES (
      v_club_id,
      v_reserva.id,
      p_monto_pagado,
      p_medio_pago,
      v_tipo_pago,
      v_usuario_id,
      v_cuenta_id,
      p_jugador_titular_id,
      v_titular_reserva_jugador_id,
      p_monto_pagado,
      0,
      v_turno_caja_id
    );
  END IF;

  RETURN v_reserva;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_crear_reserva(BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT, DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. fn_reservar_desde_app contemplando turnos fijos liberados para p_fecha
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reservar_desde_app(
  p_slug TEXT,
  p_cancha_id BIGINT,
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INT,
  p_nombre TEXT,
  p_telefono TEXT,
  p_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_cancha canchas%ROWTYPE;
  v_jugador_id BIGINT;
  v_reserva_id BIGINT;
  v_tarifa_id BIGINT;
  v_monto_total DECIMAL(12,2);
  v_sena_monto DECIMAL(12,2);
  v_sena_porcentaje INT;
  v_cancha_tarifa_id BIGINT;
  v_hora_fin TIME;
  v_club_nombre TEXT;
  v_cbu_alias TEXT;
  v_nombre_banco TEXT;
  v_club_instagram TEXT;
  v_config JSONB;
  v_alias_usado TEXT;
  v_es_socio BOOLEAN := FALSE;
  v_usuario_id UUID;
BEGIN
  IF p_duracion_min IS NULL OR p_duracion_min <= 0 THEN
    p_duracion_min := 90;
  END IF;

  SELECT id INTO v_club_id FROM clubes WHERE slug = p_slug AND activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club no encontrado o inactivo'; END IF;

  SELECT * INTO v_cancha FROM canchas
  WHERE id = p_cancha_id AND club_id = v_club_id AND activa = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancha no disponible'; END IF;

  SELECT cl.nombre, cl.cbu_alias, cl.nombre_banco, cl.sena_porcentaje, cl.instagram, cl.config
  INTO v_club_nombre, v_cbu_alias, v_nombre_banco, v_sena_porcentaje, v_club_instagram, v_config
  FROM clubes cl WHERE cl.id = v_club_id AND cl.activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club no disponible'; END IF;

  IF v_cbu_alias IS NULL AND v_config IS NOT NULL THEN
    v_cbu_alias := v_config->'deposito'->>'transferencia_alias';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  -- 1. Chequeo de clases activas (ignorando clases liberadas en p_fecha)
  IF EXISTS (
    SELECT 1 FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND (
        (c.es_recurrente IS NOT FALSE AND EXTRACT(ISODOW FROM p_fecha)::INT = ANY(c.dias_semana))
        OR (c.es_recurrente IS FALSE AND c.fecha_clase = p_fecha)
      )
      AND NOT EXISTS (
        SELECT 1 FROM clase_ocurrencias co
        WHERE co.clase_id = c.id
          AND co.fecha = p_fecha
          AND co.estado IN ('cancelada', 'liberada')
      )
      AND tsrange(
        (p_fecha + c.hora_inicio)::timestamp,
        (p_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario coincide con una clase configurada en la cancha.';
  END IF;

  -- 2. Chequeo de turnos fijos activos (ignorando si fue liberado / cancelado para p_fecha)
  IF EXISTS (
    SELECT 1 FROM turnos_fijos tf
    WHERE tf.club_id = v_club_id
      AND tf.cancha_id = p_cancha_id
      AND tf.activo = TRUE
      AND tf.dia_semana = EXTRACT(ISODOW FROM p_fecha)::INT
      AND tf.fecha_desde <= p_fecha
      AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha)
      AND tsrange(
        ('1970-01-01'::date + tf.hora_inicio)::timestamp,
        ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
      AND NOT EXISTS (
        SELECT 1 FROM reservas r_cancel
        WHERE r_cancel.club_id = v_club_id
          AND r_cancel.turno_fijo_id = tf.id
          AND r_cancel.fecha = p_fecha
          AND r_cancel.estado = 'cancelada'
      )
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible (reservado para turno fijo).';
  END IF;

  -- 3. Chequeo de reservas existentes
  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = p_cancha_id
      AND r.fecha = p_fecha
      AND r.estado NOT IN ('cancelada')
      AND tsrange(
        (p_fecha + r.hora_inicio)::timestamp,
        (p_fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible. Elegí otro horario.';
  END IF;

  -- 4. Resolución de Tarifa
  IF v_cancha_tarifa_id IS NOT NULL THEN
    SELECT id, monto INTO v_tarifa_id, v_monto_total
    FROM tarifas
    WHERE id = v_cancha_tarifa_id AND club_id = v_club_id AND activa = TRUE;
  END IF;

  IF v_tarifa_id IS NULL THEN
    SELECT rt.tarifa_id, rt.monto
    INTO v_tarifa_id, v_monto_total
    FROM fn_resolver_tarifa(p_fecha, p_hora_inicio, p_duracion_min) rt;
  END IF;

  IF v_tarifa_id IS NULL THEN
    RAISE EXCEPTION 'No hay tarifa configurada para este horario y duración.';
  END IF;

  -- 5. Upsert del jugador
  SELECT j.id, COALESCE(j.es_socio, FALSE)
  INTO v_jugador_id, v_es_socio
  FROM jugadores j
  WHERE j.club_id = v_club_id
    AND (
      (p_telefono IS NOT NULL AND p_telefono <> '' AND j.telefono = p_telefono)
      OR
      (p_email IS NOT NULL AND p_email <> '' AND LOWER(j.email) = LOWER(p_email))
    )
  LIMIT 1;

  IF v_jugador_id IS NULL THEN
    v_usuario_id := auth.uid();
    IF v_usuario_id IS NOT NULL THEN
      SELECT j.id, COALESCE(j.es_socio, FALSE)
      INTO v_jugador_id, v_es_socio
      FROM jugadores j
      WHERE j.club_id = v_club_id AND j.usuario_id = v_usuario_id
      LIMIT 1;
    END IF;
  END IF;

  IF v_jugador_id IS NOT NULL THEN
    UPDATE jugadores
    SET
      nombre = COALESCE(NULLIF(p_nombre, ''), nombre),
      telefono = COALESCE(NULLIF(p_telefono, ''), telefono),
      email = COALESCE(NULLIF(p_email, ''), email),
      usuario_id = COALESCE(usuario_id, auth.uid())
    WHERE id = v_jugador_id;
  ELSE
    INSERT INTO jugadores (club_id, nombre, telefono, email, usuario_id)
    VALUES (v_club_id, p_nombre, NULLIF(p_telefono, ''), NULLIF(p_email, ''), auth.uid())
    RETURNING id INTO v_jugador_id;
  END IF;

  -- 6. Insertar Reserva
  v_sena_porcentaje := COALESCE(v_sena_porcentaje, 50);
  v_sena_monto := ROUND((v_monto_total * v_sena_porcentaje / 100.0), 2);

  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha,
    hora_inicio, hora_fin, duracion_min,
    tarifa_id, monto_total, monto_sena, monto_pagado,
    estado, observaciones
  ) VALUES (
    v_club_id, p_cancha_id, v_jugador_id, p_fecha,
    p_hora_inicio, v_hora_fin, p_duracion_min,
    v_tarifa_id, v_monto_total, v_sena_monto, 0,
    'pendiente', 'Reserva online'
  )
  RETURNING id INTO v_reserva_id;

  INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
  VALUES (v_club_id, v_reserva_id, v_jugador_id, TRUE);

  v_alias_usado := COALESCE(v_cbu_alias, 'No configurado');

  RETURN jsonb_build_object(
    'reserva_id', v_reserva_id,
    'estado', 'pendiente',
    'cancha_nombre', v_cancha.nombre,
    'fecha', p_fecha,
    'hora_inicio', p_hora_inicio,
    'hora_fin', v_hora_fin,
    'duracion_min', p_duracion_min,
    'monto_total', v_monto_total,
    'sena_monto', v_sena_monto,
    'sena_porcentaje', v_sena_porcentaje,
    'club_nombre', v_club_nombre,
    'cbu_alias', v_alias_usado,
    'nombre_banco', v_nombre_banco,
    'club_instagram', v_club_instagram,
    'es_socio', v_es_socio
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reservar_desde_app(TEXT, BIGINT, DATE, TIME, INT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_reservar_desde_app(TEXT, BIGINT, DATE, TIME, INT, TEXT, TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. fn_ajustar_stock validando permiso granular de inventario
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ajustar_stock(
  p_producto_id BIGINT,
  p_cantidad INT,
  p_razon TEXT
)
RETURNS movimientos_stock
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_stock_actual INT;
  v_stock_resultante INT;
  v_mov movimientos_stock;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Valida si es admin o vendedor con permiso de editar inventario
  IF NOT has_user_permission('inventario', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para ajustar el stock de inventario.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad = 0 THEN
    RAISE EXCEPTION 'La cantidad del ajuste no puede ser 0.';
  END IF;
  IF p_razon IS NULL OR LENGTH(TRIM(p_razon)) = 0 THEN
    RAISE EXCEPTION 'La razón del ajuste es obligatoria.';
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock_actual
  FROM movimientos_stock
  WHERE producto_id = p_producto_id;

  v_stock_resultante := v_stock_actual + p_cantidad;

  IF v_stock_resultante < 0 THEN
    RAISE EXCEPTION
      'El ajuste dejaría el stock en negativo (actual: %, ajuste: %, resultante: %). Ajustá solo hasta lo que hay.',
      v_stock_actual, p_cantidad, v_stock_resultante;
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente, venta_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, p_cantidad, 'ajuste', NULL,
    TRIM(p_razon), v_usuario_id
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;

COMMENT ON FUNCTION fn_ajustar_stock IS
  'Ajuste manual de stock por recuento, rotura, etc. Requiere permiso de inventario editar.';
GRANT EXECUTE ON FUNCTION fn_ajustar_stock(BIGINT, INT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Órdenes de compra: fn_crear_oc y fn_recibir_oc con permiso granular
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_crear_oc(
  p_proveedor_id BIGINT,
  p_linea VARCHAR,
  p_fecha_oc DATE,
  p_items JSONB,
  p_condicion_pago VARCHAR DEFAULT 'al_recibir',
  p_fecha_compromiso_pago DATE DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS compras
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_proveedor proveedores;
  v_categoria categorias_gasto;
  v_compra compras;
  v_pids BIGINT[];
  v_bultos INT[];
  v_und_por_bulto INT[];
  v_costos_por_bulto DECIMAL(12,2)[];
  v_i INT;
  v_n INT;
  v_producto productos;
  v_cant INT;
  v_costo_unit DECIMAL(12,2);
  v_subtotal DECIMAL(12,2);
  v_monto_neto_oc DECIMAL(12,2) := 0;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('inventario', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para crear órdenes de compra.';
  END IF;

  IF p_linea IS NULL OR p_linea NOT IN ('buffet','shop') THEN
    RAISE EXCEPTION 'La línea de la OC debe ser buffet o shop.';
  END IF;
  IF p_fecha_oc IS NULL THEN
    RAISE EXCEPTION 'La fecha de la OC es obligatoria.';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La OC tiene que tener al menos un producto.';
  END IF;
  IF p_condicion_pago IS NULL
     OR p_condicion_pago NOT IN ('al_dia','a_plazo','al_recibir') THEN
    RAISE EXCEPTION 'Condición de pago inválida.';
  END IF;
  IF p_condicion_pago = 'a_plazo' AND p_fecha_compromiso_pago IS NULL THEN
    RAISE EXCEPTION 'Si la condición es "a plazo", indicá la fecha de compromiso de pago.';
  END IF;
  IF p_condicion_pago <> 'a_plazo' AND p_fecha_compromiso_pago IS NOT NULL THEN
    RAISE EXCEPTION 'La fecha de compromiso de pago solo aplica con condición "a plazo".';
  END IF;

  SELECT * INTO v_proveedor
  FROM proveedores WHERE id = p_proveedor_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_proveedor.activo THEN
    RAISE EXCEPTION 'El proveedor "%" está desactivado.', v_proveedor.nombre;
  END IF;

  SELECT cg.* INTO v_categoria
  FROM categorias_gasto cg
  JOIN unidades_negocio u ON u.id = cg.unidad_id
  WHERE cg.club_id = v_club_id AND u.tipo = p_linea
    AND cg.es_mercaderia = TRUE AND cg.activa = TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Tu club no tiene una categoría marcada como mercadería para la unidad de %.',
      p_linea;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la OC.';
  END IF;

  SELECT
    array_agg((x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad_bultos')::INT),
    array_agg((x->>'unidades_por_bulto')::INT),
    array_agg((x->>'costo_por_bulto')::DECIMAL(12,2))
  INTO v_pids, v_bultos, v_und_por_bulto, v_costos_por_bulto
  FROM jsonb_array_elements(p_items) x;

  v_n := cardinality(v_pids);
  FOR v_i IN 1..v_n LOOP
    IF v_bultos[v_i] IS NULL OR v_bultos[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad de bultos debe ser mayor a 0.';
    END IF;
    IF v_und_por_bulto[v_i] IS NULL OR v_und_por_bulto[v_i] <= 0 THEN
      RAISE EXCEPTION 'Las unidades por bulto deben ser mayor a 0.';
    END IF;
    IF v_costos_por_bulto[v_i] IS NULL OR v_costos_por_bulto[v_i] <= 0 THEN
      RAISE EXCEPTION 'El costo por bulto debe ser mayor a 0.';
    END IF;

    SELECT * INTO v_producto
    FROM productos WHERE id = v_pids[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto ID % no existe o no pertenece a tu club.', v_pids[v_i];
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado.', v_producto.nombre;
    END IF;
    IF v_producto.linea <> p_linea THEN
      RAISE EXCEPTION
        'El producto "%" es de línea %, no coincide con la línea de la OC (%).',
        v_producto.nombre, v_producto.linea, p_linea;
    END IF;

    v_monto_neto_oc := v_monto_neto_oc + (v_bultos[v_i] * v_costos_por_bulto[v_i]);
  END LOOP;

  INSERT INTO compras (
    club_id, proveedor_id, linea, categoria_id, fecha, estado,
    monto_neto, monto_total, condicion_pago,
    fecha_compromiso_pago, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_proveedor_id, p_linea, v_categoria.id, p_fecha_oc, 'pedida',
    v_monto_neto_oc, v_monto_neto_oc, p_condicion_pago,
    p_fecha_compromiso_pago, TRIM(p_observaciones), v_usuario_id
  )
  RETURNING * INTO v_compra;

  FOR v_i IN 1..v_n LOOP
    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_subtotal := v_bultos[v_i] * v_costos_por_bulto[v_i];
    v_costo_unit := ROUND(v_subtotal / v_cant, 4);

    INSERT INTO compra_items (
      compra_id, club_id, producto_id, cantidad,
      costo_unitario, subtotal,
      cantidad_bultos, unidades_por_bulto, costo_por_bulto
    ) VALUES (
      v_compra.id, v_club_id, v_pids[v_i], v_cant,
      v_costo_unit, v_subtotal,
      v_bultos[v_i], v_und_por_bulto[v_i], v_costos_por_bulto[v_i]
    );
  END LOOP;

  RETURN v_compra;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_crear_oc(BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT) TO authenticated;

COMMIT;
