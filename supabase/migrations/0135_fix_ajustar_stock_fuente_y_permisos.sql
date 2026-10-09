-- ============================================================================
-- Migration 0135_fix_ajustar_stock_fuente_y_permisos.sql
--
-- AUDITORÍA COMPLETA BASADA ESTRICTAMENTE EN EL ESQUEMA REAL DE TABLAS (tablas.md):
--
-- 1. PERMISOS VENDEDOR:
--    Actualiza `has_user_permission` para que el rol 'vendedor' tenga acceso
--    operativo por defecto a: reservas, noticias, caja, mostrador, finanzas e inventario.
--
-- 2. INVENTARIO - MOVIMIENTOS STOCK (movimientos_stock):
--    Ajusta los CHECK constraints de `fuente` para admitir las fuentes reales:
--    'compra_manual', 'venta', 'ajuste', 'ajuste_manual', 'compra_bot_whatsapp',
--    'consumo_turno', 'reposicion_consumo', 'consumo_clase', 'reposicion_consumo_clase'.
--
-- 3. RPC fn_ajustar_stock:
--    Usa exclusivamente las columnas existentes de `movimientos_stock`
--    (club_id, producto_id, cantidad, fuente, venta_id, compra_id, reserva_consumo_id,
--    observaciones, usuario_id) e inserta con fuente 'ajuste'.
--
-- 4. RPC fn_registrar_movimiento_stock:
--    Usa exclusivamente las columnas existentes de `movimientos_stock`
--    e inserta con fuente 'compra_manual'.
--
-- 5. RPC fn_cargar_consumo_turno y fn_quitar_consumo_turno:
--    Usa exclusivamente las columnas existentes de `reserva_consumos` y `movimientos_stock`.
--    Soporta asignación a `reserva_jugador_id` y `jugador_id`.
--
-- 6. RPC fn_cargar_consumo_clase y fn_quitar_consumo_clase:
--    Corrige el INSERT en `clase_consumos` usando la columna real `clase_alumno_id`
--    (NO `clase_ocurrencia_alumno_id`, que no existe en el esquema).
--    Inserta el descuento en `movimientos_stock` con `clase_consumo_id`.
--
-- 7. PERMISOS VENDEDOR EN PAGOS Y COBROS (reserva_pagos y clase_cobros):
--    - RLS y RPC fn_eliminar_pago_reserva: permite a 'admin' y 'vendedor' eliminar pagos
--      y recalcular saldos en `reservas` y `reserva_jugadores`.
--    - RLS y RPC fn_borrar_cobro_clase: permite a 'admin' y 'vendedor' anular cobros
--      en `clase_cobros`.
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
  IF current_user_is_plataforma_admin() THEN
    RETURN TRUE;
  END IF;

  SELECT rol, permisos INTO v_rol, v_permisos
  FROM usuarios
  WHERE id = auth.uid();

  IF v_rol = 'admin' THEN
    RETURN TRUE;
  END IF;

  IF v_rol <> 'vendedor' THEN
    RETURN FALSE;
  END IF;

  IF v_permisos IS NOT NULL 
     AND (v_permisos->'modulos'->p_modulo ? p_accion) THEN
    RETURN (v_permisos->'modulos'->p_modulo->>p_accion)::BOOLEAN;
  END IF;

  IF p_modulo IN ('reservas', 'noticias', 'caja', 'mostrador', 'finanzas', 'inventario') THEN
    RETURN TRUE;
  ELSIF p_modulo = 'configuracion' THEN
    RETURN (p_accion = 'ver');
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_user_permission(TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Ampliar CHECK constraints en movimientos_stock
-- ----------------------------------------------------------------------------
ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS movimientos_stock_fuente_check;
ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS mov_stock_fuente_enum;
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_fuente_enum CHECK (
    fuente IN (
      'compra_manual',
      'venta',
      'ajuste',
      'ajuste_manual',
      'compra_bot_whatsapp',
      'consumo_turno',
      'reposicion_consumo',
      'consumo_clase',
      'reposicion_consumo_clase'
    )
  );

ALTER TABLE movimientos_stock DROP CONSTRAINT IF EXISTS mov_stock_coherencia_fuente;
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_coherencia_fuente CHECK (
    (fuente = 'venta' AND cantidad < 0 AND venta_id IS NOT NULL)
    OR (fuente IN ('consumo_turno', 'consumo_clase') AND cantidad < 0)
    OR (fuente IN ('reposicion_consumo', 'reposicion_consumo_clase') AND cantidad > 0)
    OR (fuente IN ('compra_manual', 'compra_bot_whatsapp') AND cantidad > 0)
    OR (fuente IN ('ajuste', 'ajuste_manual'))
  );

-- ----------------------------------------------------------------------------
-- 3. RPC fn_ajustar_stock
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ajustar_stock(
  p_producto_id BIGINT,
  p_cantidad INT,
  p_razon TEXT
)
RETURNS movimientos_stock
LANGUAGE plpgsql
SECURITY DEFINER
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

  IF NOT has_user_permission('inventario', 'editar') 
     AND NOT has_user_permission('configuracion', 'editar') 
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
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
      'El ajuste dejaría el stock en negativo (actual: %, ajuste: %, resultante: %). Corregí la cantidad.',
      v_stock_actual, p_cantidad, v_stock_resultante;
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, compra_id, reserva_consumo_id,
    observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, p_cantidad, 'ajuste',
    NULL, NULL, NULL,
    TRIM(p_razon), v_usuario_id
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ajustar_stock(BIGINT, INT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC fn_registrar_movimiento_stock (cargar stock)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_registrar_movimiento_stock(
  p_producto_id BIGINT,
  p_cantidad INT,
  p_observaciones TEXT
)
RETURNS movimientos_stock
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_mov movimientos_stock;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('configuracion', 'editar') 
     AND NOT has_user_permission('inventario', 'editar')
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cargar stock.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a cargar debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente, venta_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, p_cantidad, 'compra_manual', NULL, TRIM(p_observaciones), v_usuario_id
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_registrar_movimiento_stock(BIGINT, INT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC fn_cargar_consumo_turno (soporta grupal e individual)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR DEFAULT 'general',
  p_reserva_jugador_id BIGINT DEFAULT NULL
)
RETURNS reserva_consumos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva reservas;
  v_producto productos;
  v_consumo reserva_consumos;
  v_jugador_id BIGINT := NULL;
  v_tipo_reparto_final VARCHAR;
  v_stock INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') 
     AND NOT has_user_permission('mostrador', 'editar') 
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cargar consumos al turno.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a un turno cerrado.';
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o está inactivo.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
  END IF;

  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE club_id      = v_club_id
    AND reserva_id   = p_reserva_id
    AND producto_id  = v_producto.id
    AND cantidad     = p_cantidad
    AND tipo_reparto = COALESCE(p_tipo_reparto, 'general')
    AND (
      (p_reserva_jugador_id IS NULL AND reserva_jugador_id IS NULL)
      OR reserva_jugador_id = p_reserva_jugador_id
    )
    AND usuario_id   = v_usuario_id
    AND fecha_hora  >= NOW() - INTERVAL '2 seconds'
  ORDER BY fecha_hora DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_consumo;
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  IF p_reserva_jugador_id IS NOT NULL THEN
    SELECT jugador_id INTO v_jugador_id
    FROM reserva_jugadores
    WHERE id = p_reserva_jugador_id AND reserva_id = p_reserva_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La persona indicada no pertenece a este turno.';
    END IF;
    v_tipo_reparto_final := 'individual';
  ELSE
    v_tipo_reparto_final := COALESCE(p_tipo_reparto, 'general');
    IF v_tipo_reparto_final NOT IN ('general', 'partido') THEN
      v_tipo_reparto_final := 'general';
    END IF;
  END IF;

  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto, linea,
    reserva_jugador_id, jugador_id
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    v_tipo_reparto_final, v_producto.linea,
    p_reserva_jugador_id, v_jugador_id
  )
  RETURNING * INTO v_consumo;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_turno',
    NULL, v_consumo.id, v_usuario_id
  );

  RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cargar_consumo_turno(BIGINT, BIGINT, INT, VARCHAR, BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC fn_quitar_consumo_turno
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_quitar_consumo_turno(
  p_consumo_id BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_consumo reserva_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') 
     AND NOT has_user_permission('mostrador', 'editar') 
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para quitar consumos del turno.';
  END IF;

  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe o no pertenece a tu club.';
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo',
    NULL, NULL,
    format('Reposición por quitado del consumo #%s del turno #%s',
           v_consumo.id, v_consumo.reserva_id),
    v_usuario_id
  );

  DELETE FROM reserva_consumos WHERE id = p_consumo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_quitar_consumo_turno(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC fn_cargar_consumo_clase (columna verificada en tablas.md: clase_alumno_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cargar_consumo_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_clase_alumno_id BIGINT DEFAULT NULL
)
RETURNS clase_consumos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_consumo clase_consumos;
  v_stock INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') 
     AND NOT has_user_permission('mostrador', 'editar') 
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cargar consumos a la clase.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clases WHERE id = p_clase_id AND club_id = v_club_id) THEN
    RAISE EXCEPTION 'La clase no existe.';
  END IF;

  IF p_clase_alumno_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM clase_ocurrencia_alumnos
      WHERE id = p_clase_alumno_id AND clase_id = p_clase_id AND fecha = p_fecha AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'El alumno especificado no pertenece a esta clase en esta fecha.';
    END IF;
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o está inactivo.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  INSERT INTO clase_consumos (
    club_id, clase_id, fecha, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, linea, usuario_id,
    clase_alumno_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_producto.linea, v_usuario_id,
    p_clase_alumno_id
  )
  RETURNING * INTO v_consumo;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    clase_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_clase',
    v_consumo.id, format('Consumo en clase #%s fecha %s', p_clase_id, p_fecha), v_usuario_id
  );

  RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cargar_consumo_clase(BIGINT, DATE, BIGINT, INT, BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPC fn_quitar_consumo_clase
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_quitar_consumo_clase(
  p_consumo_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_consumo clase_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') 
     AND NOT has_user_permission('mostrador', 'editar') 
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para quitar consumos de la clase.';
  END IF;

  SELECT * INTO v_consumo
  FROM clase_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe.';
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    clase_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo_clase',
    NULL, format('Reposición por eliminación de consumo #%s de clase #%s', v_consumo.id, v_consumo.clase_id),
    v_usuario_id
  );

  DELETE FROM clase_consumos WHERE id = p_consumo_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_quitar_consumo_clase(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Políticas RLS y RPC para deshacer pagos en reservas (admin y vendedor)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "reserva_pagos_update_solo_admin" ON reserva_pagos;
DROP POLICY IF EXISTS "reserva_pagos_delete_solo_admin" ON reserva_pagos;
DROP POLICY IF EXISTS "reserva_pagos_update_admin_vendedor" ON reserva_pagos;
DROP POLICY IF EXISTS "reserva_pagos_delete_admin_vendedor" ON reserva_pagos;

CREATE POLICY "reserva_pagos_update_admin_vendedor"
ON reserva_pagos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

CREATE POLICY "reserva_pagos_delete_admin_vendedor"
ON reserva_pagos FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON reserva_pagos TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_eliminar_pago_reserva(
  p_pago_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago reserva_pagos;
  v_reserva reservas;
  v_nuevo_monto_pagado DECIMAL(12,2) := 0;
  v_nuevo_monto_sena DECIMAL(12,2) := 0;
  v_nuevo_estado VARCHAR(20);
  v_total_pagado_persona DECIMAL(12,2) := 0;
BEGIN
  IF current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar pagos de reservas.';
  END IF;

  SELECT * INTO v_pago
  FROM reserva_pagos
  WHERE id = p_pago_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no existe o no pertenece a tu club.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_pago.reserva_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva asociada al pago no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cerrada' THEN
    RAISE EXCEPTION 'No se pueden eliminar pagos de un turno que ya ha sido cerrado.';
  END IF;

  DELETE FROM reserva_pagos
  WHERE id = p_pago_id;

  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(CASE WHEN tipo = 'sena' THEN monto ELSE 0 END), 0)
  INTO v_nuevo_monto_pagado, v_nuevo_monto_sena
  FROM reserva_pagos
  WHERE reserva_id = v_reserva.id;

  IF v_reserva.estado NOT IN ('cancelada', 'cerrada', 'jugada') THEN
    IF v_nuevo_monto_pagado >= v_reserva.monto_total AND v_reserva.monto_total > 0 THEN
      v_nuevo_estado := 'pagada';
    ELSIF v_nuevo_monto_pagado > 0 THEN
      v_nuevo_estado := 'senada';
    ELSE
      v_nuevo_estado := 'pendiente';
    END IF;
  ELSE
    v_nuevo_estado := v_reserva.estado;
  END IF;

  UPDATE reservas
  SET
    monto_pagado = LEAST(v_reserva.monto_total, v_nuevo_monto_pagado),
    monto_sena = v_nuevo_monto_sena,
    estado = v_nuevo_estado
  WHERE id = v_reserva.id;

  IF v_pago.reserva_jugador_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado_persona
    FROM reserva_pagos
    WHERE reserva_jugador_id = v_pago.reserva_jugador_id;

    IF v_total_pagado_persona = 0 THEN
      UPDATE reserva_jugadores
      SET cuota_fija = NULL
      WHERE id = v_pago.reserva_jugador_id;
    ELSE
      UPDATE reserva_jugadores
      SET cuota_fija = v_total_pagado_persona
      WHERE id = v_pago.reserva_jugador_id
        AND cuota_fija IS NOT NULL
        AND cuota_fija > v_total_pagado_persona;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_eliminar_pago_reserva(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. Políticas RLS y RPC para anular cobros en clases (admin y vendedor)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "clase_cobros_update_solo_admin" ON clase_cobros;
DROP POLICY IF EXISTS "clase_cobros_delete_solo_admin" ON clase_cobros;
DROP POLICY IF EXISTS "clase_cobros_update_admin_vendedor" ON clase_cobros;
DROP POLICY IF EXISTS "clase_cobros_delete_admin_vendedor" ON clase_cobros;

CREATE POLICY "clase_cobros_update_admin_vendedor"
ON clase_cobros FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

CREATE POLICY "clase_cobros_delete_admin_vendedor"
ON clase_cobros FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON clase_cobros TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_borrar_cobro_clase(
  p_cobro_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cobro clase_cobros;
BEGIN
  IF current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar cobros de clases.';
  END IF;

  SELECT * INTO v_cobro
  FROM clase_cobros
  WHERE id = p_cobro_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cobro no existe o no pertenece a tu club.';
  END IF;

  DELETE FROM clase_cobros
  WHERE id = p_cobro_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_borrar_cobro_clase(BIGINT) TO authenticated;

COMMIT;
