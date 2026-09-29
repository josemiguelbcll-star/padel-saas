-- ============================================================================
-- 0126_liberar_clase_por_fecha.sql
--
-- Permite "Liberar clase (solo por hoy)":
-- 1. Modifica la restricción de estado en clase_ocurrencias para admitir 'cancelada' y 'liberada'.
-- 2. Crea la RPC fn_liberar_clase_por_fecha(p_clase_id, p_fecha):
--    - Marca la ocurrencia de la clase en esa fecha como 'cancelada'/'liberada'.
--    - Valida que no haya cobros ni consumos previos en esa fecha.
-- 3. Crea la RPC fn_reactivar_clase_por_fecha(p_clase_id, p_fecha):
--    - Permite revertir la liberación si el slot aún sigue libre (sin reservas).
-- 4. Actualiza fn_crear_reserva para no bloquear slots si la clase está liberada en p_fecha.
-- 5. Actualiza fn_reservar_desde_app para no bloquear slots si la clase está liberada en p_fecha.
-- 6. Actualiza fn_disponibilidad_publica para incluir clases y omitir clases liberadas.
-- ============================================================================

BEGIN;

-- 1. Ampliar el CHECK constraint de clase_ocurrencias
ALTER TABLE clase_ocurrencias DROP CONSTRAINT IF EXISTS clase_ocurrencias_estado_check;
ALTER TABLE clase_ocurrencias ADD CONSTRAINT clase_ocurrencias_estado_check
  CHECK (estado IN ('pendiente', 'pagada', 'cancelada', 'liberada'));

-- 2. RPC: fn_liberar_clase_por_fecha
CREATE OR REPLACE FUNCTION public.fn_liberar_clase_por_fecha(
  p_clase_id BIGINT,
  p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_clase RECORD;
  v_rol VARCHAR;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();
  v_rol := current_user_rol();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para liberar clases.';
  END IF;

  SELECT * INTO v_clase
  FROM clases
  WHERE id = p_clase_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clase no encontrada.';
  END IF;

  -- 1. No permitir liberar si hay cobros en esa fecha
  IF EXISTS (
    SELECT 1 FROM clase_cobros
    WHERE clase_id = p_clase_id AND fecha = p_fecha AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION 'No se puede liberar la clase porque tiene cobros registrados en esta fecha. Anulá los cobros primero.';
  END IF;

  -- 2. No permitir liberar si hay consumos en esa fecha
  IF EXISTS (
    SELECT 1 FROM clase_consumos
    WHERE clase_id = p_clase_id AND fecha = p_fecha AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION 'No se puede liberar la clase porque tiene consumiciones registradas en esta fecha. Eliminalas primero.';
  END IF;

  -- 3. Upsert en clase_ocurrencias con estado = 'cancelada'
  INSERT INTO clase_ocurrencias (
    club_id,
    clase_id,
    fecha,
    cantidad_alumnos,
    monto_total,
    estado,
    creado_por
  ) VALUES (
    v_club_id,
    p_clase_id,
    p_fecha,
    1,
    0,
    'cancelada',
    v_usuario_id
  )
  ON CONFLICT (clase_id, fecha)
  DO UPDATE SET
    estado = 'cancelada';

  RETURN jsonb_build_object(
    'ok', true,
    'clase_id', p_clase_id,
    'fecha', p_fecha,
    'estado', 'cancelada'
  );
END;
$$;

COMMENT ON FUNCTION public.fn_liberar_clase_por_fecha(BIGINT, DATE) IS
  'Libera un slot de clase para una fecha específica, permitiendo reservar turnos normales en dicho horario.';

GRANT EXECUTE ON FUNCTION public.fn_liberar_clase_por_fecha(BIGINT, DATE) TO authenticated;

-- 3. RPC: fn_reactivar_clase_por_fecha
CREATE OR REPLACE FUNCTION public.fn_reactivar_clase_por_fecha(
  p_clase_id BIGINT,
  p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_clase RECORD;
  v_rol VARCHAR;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();
  v_rol := current_user_rol();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para reactivar clases.';
  END IF;

  SELECT * INTO v_clase
  FROM clases
  WHERE id = p_clase_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clase no encontrada.';
  END IF;

  -- Verificar si el slot fue ocupado por una reserva
  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = v_clase.cancha_id
      AND r.fecha = p_fecha
      AND r.estado != 'cancelada'
      AND tsrange(
        (p_fecha + r.hora_inicio)::timestamp,
        (p_fecha + r.hora_fin)::timestamp
      ) && tsrange(
        (p_fecha + v_clase.hora_inicio)::timestamp,
        (p_fecha + v_clase.hora_inicio + (v_clase.duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'No se puede restaurar la clase porque ese horario ya fue reservado por otro turno.';
  END IF;

  -- Restaurar la ocurrencia a pendiente o borrar si no tiene alumnos
  IF EXISTS (
    SELECT 1 FROM clase_ocurrencia_alumnos
    WHERE clase_id = p_clase_id AND fecha = p_fecha
  ) THEN
    UPDATE clase_ocurrencias
    SET estado = 'pendiente'
    WHERE clase_id = p_clase_id AND fecha = p_fecha;
  ELSE
    DELETE FROM clase_ocurrencias
    WHERE clase_id = p_clase_id AND fecha = p_fecha;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'clase_id', p_clase_id,
    'fecha', p_fecha,
    'estado', 'pendiente'
  );
END;
$$;

COMMENT ON FUNCTION public.fn_reactivar_clase_por_fecha(BIGINT, DATE) IS
  'Restaura una clase previamente liberada para una fecha si el slot aún se encuentra disponible.';

GRANT EXECUTE ON FUNCTION public.fn_reactivar_clase_por_fecha(BIGINT, DATE) TO authenticated;

-- 4. Redefinición de fn_crear_reserva contemplando clases liberadas
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

    -- Si el cobro inicial es en efectivo, vincular a la caja abierta si existe
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

-- 5. Redefinición de fn_reservar_desde_app contemplando clases liberadas
CREATE OR REPLACE FUNCTION public.fn_reservar_desde_app(
  p_cancha_id BIGINT,
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_jugador_app jugadores_app%ROWTYPE;
  v_club_id BIGINT;
  v_cancha_nombre TEXT;
  v_cancha_tarifa_id BIGINT;
  v_club_nombre TEXT;
  v_cbu_alias TEXT;
  v_nombre_banco TEXT;
  v_sena_porcentaje NUMERIC;
  v_club_instagram TEXT;
  v_config JSONB;
  v_hora_fin TIME;
  v_tarifa_id BIGINT;
  v_monto_total DECIMAL(12,2);
  v_monto_sena DECIMAL(12,2);
  v_sena_tipo TEXT;
  v_sena_valor NUMERIC;
  v_jugador_id BIGINT;
  v_reserva_id BIGINT;
  v_email TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  SELECT * INTO v_jugador_app
  FROM jugadores_app WHERE auth_user_id = v_user_id AND activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completá tu perfil antes de reservar'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_jugador_app.auth_user_id;

  SELECT c.club_id, c.nombre, c.tarifa_id INTO v_club_id, v_cancha_nombre, v_cancha_tarifa_id
  FROM canchas c WHERE c.id = p_cancha_id AND c.activa = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancha no disponible'; END IF;

  SELECT cl.nombre, cl.cbu_alias, cl.nombre_banco, cl.sena_porcentaje, cl.instagram, cl.config
  INTO v_club_nombre, v_cbu_alias, v_nombre_banco, v_sena_porcentaje, v_club_instagram, v_config
  FROM clubes cl WHERE cl.id = v_club_id AND cl.activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club no disponible'; END IF;

  IF v_cbu_alias IS NULL AND v_config IS NOT NULL THEN
    v_cbu_alias := v_config->'deposito'->>'transferencia_alias';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  -- 1. Chequeo de clases activas con tsrange seguro (ignorando clases liberadas en p_fecha)
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

  -- 2. Chequeo de turnos fijos activos con tsrange seguro
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
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible (reservado para turno fijo).';
  END IF;

  -- 3. Chequeo de reservas existentes con tsrange seguro
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

  -- 4. Resolución de Tarifa:
  IF v_cancha_tarifa_id IS NOT NULL THEN
    SELECT id, monto INTO v_tarifa_id, v_monto_total
    FROM tarifas
    WHERE id = v_cancha_tarifa_id AND activa = TRUE;
  END IF;

  IF v_tarifa_id IS NULL THEN
    SELECT id, monto INTO v_tarifa_id, v_monto_total
    FROM tarifas
    WHERE club_id = v_club_id AND activa = TRUE
      AND (vigente_desde IS NULL OR vigente_desde <= p_fecha)
      AND (vigente_hasta IS NULL OR vigente_hasta >= p_fecha)
      AND (
        dias_semana IS NULL
        OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(dias_semana)
      )
      AND (
        (desde_hora IS NULL AND hasta_hora IS NULL)
        OR (p_hora_inicio >= desde_hora AND p_hora_inicio < hasta_hora)
      )
      AND (duracion_min IS NULL OR duracion_min = p_duracion_min)
    ORDER BY duracion_min NULLS LAST, vigente_desde DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_tarifa_id IS NULL THEN
    RAISE EXCEPTION 'No hay tarifas disponibles para este slot.';
  END IF;

  -- Resolver o crear vinculación jugador_app <-> jugadores
  SELECT id INTO v_jugador_id FROM jugadores
  WHERE club_id = v_club_id 
    AND (
      (v_email IS NOT NULL AND email = v_email) 
      OR (v_jugador_app.telefono IS NOT NULL AND telefono = v_jugador_app.telefono)
    )
    AND activo = TRUE 
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono, activo)
    VALUES (
      v_club_id, 
      COALESCE(v_jugador_app.nombre_display, 'Jugador App'), 
      v_email, 
      v_jugador_app.telefono, 
      TRUE
    )
    RETURNING id INTO v_jugador_id;
  END IF;

  -- Resolver seña
  v_sena_tipo := COALESCE(v_config->'deposito'->>'sena_tipo', 'porcentaje');
  v_sena_valor := COALESCE((v_config->'deposito'->>'sena_valor')::NUMERIC, v_sena_porcentaje);

  IF v_sena_tipo = 'fijo' THEN
    v_monto_sena := LEAST(v_sena_valor, v_monto_total);
  ELSE
    v_monto_sena := ROUND((v_monto_total * v_sena_valor / 100.0), 2);
  END IF;

  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
    duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
    estado, observaciones
  ) VALUES (
    v_club_id, p_cancha_id, v_jugador_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_duracion_min, v_tarifa_id, v_monto_total, v_monto_sena, 0,
    'pendiente', 'Reservado desde la aplicación móvil.'
  )
  RETURNING id INTO v_reserva_id;

  INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
  VALUES (v_club_id, v_reserva_id, v_jugador_id, TRUE);

  RETURN json_build_object(
    'reserva_id', v_reserva_id,
    'cancha_nombre', v_cancha_nombre,
    'club_nombre', v_club_nombre,
    'fecha', p_fecha,
    'hora_inicio', p_hora_inicio,
    'hora_fin', v_hora_fin,
    'duracion_min', p_duracion_min,
    'monto_total', v_monto_total,
    'monto_sena', v_monto_sena,
    'cbu_alias', v_cbu_alias,
    'nombre_banco', v_nombre_banco,
    'club_instagram', v_club_instagram
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER) TO authenticated;

-- 6. Redefinición de fn_disponibilidad_publica incluyendo clases (salvo las liberadas)
DROP FUNCTION IF EXISTS public.fn_disponibilidad_publica(TEXT, DATE);
CREATE OR REPLACE FUNCTION public.fn_disponibilidad_publica(
  p_club_slug TEXT,
  p_fecha DATE
)
RETURNS TABLE (
  cancha_id     BIGINT,
  cancha_nombre VARCHAR,
  hora_inicio   TIME,
  hora_fin      TIME,
  disponible    BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club_data AS (
    SELECT
      id,
      hora_apertura,
      hora_cierre,
      duracion_turno_default
    FROM clubes
    WHERE slug = p_club_slug
      AND activo = TRUE
    LIMIT 1
  ),
  canchas_activas AS (
    SELECT c.id, c.nombre
    FROM canchas c
    JOIN club_data cl ON c.club_id = cl.id
    WHERE c.activa = TRUE
  ),
  paso_grid AS (
    SELECT COALESCE(
      (
        SELECT MIN(dur)
        FROM franjas_turno f
        CROSS JOIN LATERAL unnest(f.duraciones_min) AS dur
        WHERE f.club_id = (SELECT id FROM club_data)
          AND f.activa = TRUE
          AND (
            f.dias_semana IS NULL
            OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(f.dias_semana)
          )
      ),
      (SELECT duracion_turno_default FROM club_data)
    ) AS paso
  ),
  time_grid AS (
    SELECT
      (cl.hora_apertura + (gs.n * (pg.paso::TEXT || ' min')::INTERVAL))::TIME AS hora
    FROM club_data cl, paso_grid pg
    CROSS JOIN LATERAL generate_series(
      0,
      GREATEST(0,
        FLOOR(
          EXTRACT(EPOCH FROM (cl.hora_cierre - cl.hora_apertura)) / 60.0
          / pg.paso
        )::INT - 1
      )
    ) AS gs(n)
  ),
  slot_base AS (
    SELECT
      ca.id        AS cancha_id,
      ca.nombre    AS cancha_nombre,
      tg.hora      AS hora_inicio,
      COALESCE(
        (
          SELECT f.duraciones_min
          FROM franjas_turno f
          WHERE f.club_id = (SELECT id FROM club_data)
            AND f.activa = TRUE
            AND (f.cancha_id IS NULL OR f.cancha_id = ca.id)
            AND (
              f.dias_semana IS NULL
              OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(f.dias_semana)
            )
            AND (f.desde_hora IS NULL OR tg.hora >= f.desde_hora)
            AND (f.hasta_hora IS NULL OR tg.hora <  f.hasta_hora)
          ORDER BY
            (f.cancha_id IS NOT NULL) DESC,
            f.prioridad DESC,
            f.id DESC
          LIMIT 1
        ),
        (SELECT ARRAY[cl.duracion_turno_default]::INTEGER[] FROM club_data cl)
      ) AS duraciones
    FROM canchas_activas ca
    CROSS JOIN time_grid tg
  ),
  slots AS (
    SELECT
      sb.cancha_id,
      sb.cancha_nombre,
      sb.hora_inicio,
      fn_calcular_hora_fin(sb.hora_inicio, dur) AS hora_fin
    FROM slot_base sb
    CROSS JOIN LATERAL unnest(sb.duraciones) AS dur
    JOIN club_data cl ON TRUE
    WHERE fn_calcular_hora_fin(sb.hora_inicio, dur) <= cl.hora_cierre
  ),
  ocupados_reservas AS (
    SELECT DISTINCT s.cancha_id, s.hora_inicio
    FROM slots s
    JOIN reservas r ON r.cancha_id = s.cancha_id
    JOIN club_data cl ON r.club_id = cl.id
    WHERE r.fecha   = p_fecha
      AND r.estado <> 'cancelada'
      AND s.hora_inicio < r.hora_fin
      AND s.hora_fin    > r.hora_inicio
  ),
  ocupados_fijos AS (
    SELECT DISTINCT s.cancha_id, s.hora_inicio
    FROM slots s
    JOIN turnos_fijos tf ON tf.cancha_id = s.cancha_id
    JOIN club_data cl ON tf.club_id = cl.id
    WHERE tf.activo = TRUE
      AND tf.dia_semana = EXTRACT(ISODOW FROM p_fecha)::INT
      AND tf.fecha_desde <= p_fecha
      AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha)
      AND s.hora_inicio < fn_calcular_hora_fin(tf.hora_inicio, tf.duracion_min)
      AND s.hora_fin    > tf.hora_inicio
      AND NOT EXISTS (
        SELECT 1 FROM reservas r
        WHERE r.turno_fijo_id = tf.id
          AND r.fecha = p_fecha
          AND r.estado = 'cancelada'
      )
  ),
  ocupados_clases AS (
    SELECT DISTINCT s.cancha_id, s.hora_inicio
    FROM slots s
    JOIN clases c ON c.cancha_id = s.cancha_id
    JOIN club_data cl ON c.club_id = cl.id
    WHERE c.activa = TRUE
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
      AND s.hora_inicio < fn_calcular_hora_fin(c.hora_inicio, c.duracion_min)
      AND s.hora_fin    > c.hora_inicio
  ),
  ocupados AS (
    SELECT cancha_id, hora_inicio FROM ocupados_reservas
    UNION
    SELECT cancha_id, hora_inicio FROM ocupados_fijos
    UNION
    SELECT cancha_id, hora_inicio FROM ocupados_clases
  )
  SELECT
    s.cancha_id,
    s.cancha_nombre,
    s.hora_inicio,
    s.hora_fin,
    NOT EXISTS (
      SELECT 1 FROM ocupados o
      WHERE o.cancha_id   = s.cancha_id
        AND o.hora_inicio = s.hora_inicio
    ) AS disponible
  FROM slots s
  ORDER BY s.cancha_nombre, s.hora_inicio, s.hora_fin;
$$;

GRANT EXECUTE ON FUNCTION public.fn_disponibilidad_publica(TEXT, DATE) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_disponibilidad_publica(TEXT, DATE) TO authenticated;

COMMIT;
