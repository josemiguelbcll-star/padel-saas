-- ============================================================================
-- 0127_fix_stock_actual_consumos.sql
-- Corrige el error 42703 (record "v_producto" has no field "stock_actual").
-- La tabla `productos` no posee columna `stock_actual` (el stock se calcula
-- sumando dinámicamente `movimientos_stock`).
--
-- Se corrigen:
-- 1. `fn_cargar_consumo_turno`: calcula stock desde `movimientos_stock` bajo lock
--    y elimina el UPDATE a `productos.stock_actual`.
-- 2. `fn_cargar_consumo_clase`: ídem para consumos de clases.
-- 3. `fn_quitar_consumo_clase`: elimina el UPDATE a `productos.stock_actual` ya que
--    la reposición se registra en `movimientos_stock`.
-- 4. `fn_resetear_datos_club_modular`: elimina el UPDATE a `productos.stock_actual`
--    al resetear buffet (el borrado de `movimientos_stock` ya deja el stock en 0).
-- ============================================================================

BEGIN;

-- 1. fn_cargar_consumo_turno
CREATE OR REPLACE FUNCTION fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR DEFAULT 'general',
  p_reserva_jugador_id BIGINT DEFAULT NULL
)
RETURNS reserva_consumos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva reservas;
  v_club_id BIGINT;
  v_usuario_id UUID;
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

  -- Lock exclusivo del producto
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

  -- Debounce anti-doble-submit (2 segundos)
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

  -- Calcular stock bajo el lock desde movimientos_stock
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- Si se asigna a una persona puntual
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

  -- Insertar consumo
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

  -- Movimiento de stock (fuente: consumo_turno)
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

GRANT EXECUTE ON FUNCTION fn_cargar_consumo_turno(BIGINT, BIGINT, INT, VARCHAR, BIGINT) TO authenticated;

-- 2. fn_cargar_consumo_clase
CREATE OR REPLACE FUNCTION fn_cargar_consumo_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_clase_alumno_id BIGINT DEFAULT NULL
)
RETURNS clase_consumos
LANGUAGE plpgsql
SECURITY INVOKER
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

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clases WHERE id = p_clase_id AND club_id = v_club_id) THEN
    RAISE EXCEPTION 'La clase no existe.';
  END IF;

  -- Lock exclusivo del producto
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

  -- Calcular stock bajo el lock desde movimientos_stock
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  IF p_clase_alumno_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM clase_ocurrencia_alumnos
      WHERE id = p_clase_alumno_id AND clase_id = p_clase_id AND fecha = p_fecha AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'El alumno especificado no pertenece a esta clase en esta fecha.';
    END IF;
  END IF;

  -- Insertar consumo
  INSERT INTO clase_consumos (
    club_id, clase_id, fecha,
    clase_alumno_id, producto_id, producto_nombre,
    precio_unitario, costo_unitario, cantidad,
    subtotal, linea, usuario_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha,
    p_clase_alumno_id, v_producto.id, v_producto.nombre,
    v_producto.precio, v_producto.costo, p_cantidad,
    v_producto.precio * p_cantidad, v_producto.linea, v_usuario_id
  )
  RETURNING * INTO v_consumo;

  -- Registrar movimiento de stock (fuente: consumo_clase)
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    clase_consumo_id, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_clase',
    v_consumo.id, v_usuario_id
  );

  RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cargar_consumo_clase(BIGINT, DATE, BIGINT, INT, BIGINT) TO authenticated;

-- 3. fn_quitar_consumo_clase
CREATE OR REPLACE FUNCTION fn_quitar_consumo_clase(
  p_consumo_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
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

  SELECT * INTO v_consumo
  FROM clase_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe.';
  END IF;

  -- Registrar movimiento de reposición
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    observaciones, usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo_clase',
    format('Reposición por eliminación de consumo de clase #%s', v_consumo.id),
    v_usuario_id
  );

  DELETE FROM clase_consumos WHERE id = p_consumo_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_quitar_consumo_clase(BIGINT) TO authenticated;

-- 4. fn_resetear_datos_club_modular (remover UPDATE productos SET stock_actual = 0)
CREATE OR REPLACE FUNCTION fn_resetear_datos_club_modular(
  p_club_id BIGINT,
  p_reset_reservas BOOLEAN DEFAULT FALSE,
  p_reset_buffet BOOLEAN DEFAULT FALSE,
  p_reset_clases BOOLEAN DEFAULT FALSE,
  p_reset_jugadores BOOLEAN DEFAULT FALSE,
  p_reset_finanzas BOOLEAN DEFAULT FALSE,
  p_reset_productos BOOLEAN DEFAULT FALSE,
  p_reset_canchas BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_is_superadmin BOOLEAN := FALSE;
  v_is_club_admin BOOLEAN := FALSE;
  v_resumen JSONB := '{}'::JSONB;
BEGIN
  v_caller_auth_id := auth.uid();

  -- 1. Check si caller es superadmin
  IF v_caller_auth_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM plataforma_admins
      WHERE id = v_caller_auth_id AND activo = TRUE
    ) INTO v_is_superadmin;
  END IF;

  -- 2. Check si caller es admin del club
  IF v_caller_auth_id IS NOT NULL AND NOT v_is_superadmin THEN
    SELECT EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = v_caller_auth_id
        AND club_id = p_club_id
        AND rol = 'admin'
        AND activo = TRUE
    ) INTO v_is_club_admin;
  END IF;

  IF NOT v_is_superadmin AND NOT v_is_club_admin THEN
    RAISE EXCEPTION 'No autorizado para resetear datos de este club.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ==========================================================================
  -- A. RESERVAS Y TURNOS
  -- ==========================================================================
  IF p_reset_reservas THEN
    DELETE FROM reserva_consumos WHERE club_id = p_club_id;
    DELETE FROM reserva_pagos WHERE club_id = p_club_id;
    DELETE FROM reserva_jugadores WHERE club_id = p_club_id;
    DELETE FROM reservas WHERE club_id = p_club_id;
    DELETE FROM turnos_fijos_bloqueos WHERE club_id = p_club_id;
    DELETE FROM turnos_fijos WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{reservas}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- B. BUFFET Y VENTAS / STOCK
  -- ==========================================================================
  IF p_reset_buffet THEN
    DELETE FROM venta_items WHERE club_id = p_club_id;
    DELETE FROM ventas WHERE club_id = p_club_id;
    DELETE FROM compra_items WHERE club_id = p_club_id;
    DELETE FROM compras WHERE club_id = p_club_id;
    DELETE FROM movimientos_stock WHERE club_id = p_club_id;
    DELETE FROM reserva_consumos WHERE club_id = p_club_id;
    DELETE FROM clase_consumos WHERE club_id = p_club_id;

    IF p_reset_productos THEN
      DELETE FROM productos WHERE club_id = p_club_id;
      DELETE FROM proveedores WHERE club_id = p_club_id;
      v_resumen := jsonb_set(v_resumen, '{productos}', 'true'::jsonb);
    END IF;

    v_resumen := jsonb_set(v_resumen, '{buffet}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- C. CLASES Y ALUMNOS
  -- ==========================================================================
  IF p_reset_clases THEN
    DELETE FROM clase_cobros WHERE club_id = p_club_id;
    DELETE FROM clase_consumos WHERE club_id = p_club_id;
    DELETE FROM clase_ocurrencia_alumnos WHERE club_id = p_club_id;
    DELETE FROM clase_alumnos_fijos WHERE club_id = p_club_id;
    DELETE FROM clase_ocurrencias WHERE club_id = p_club_id;
    DELETE FROM clases WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{clases}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- D. FINANZAS, GASTOS Y CAJAS
  -- ==========================================================================
  IF p_reset_finanzas THEN
    DELETE FROM gasto_cuotas WHERE club_id = p_club_id;
    DELETE FROM gastos WHERE club_id = p_club_id;
    DELETE FROM gastos_recurrentes WHERE club_id = p_club_id;
    DELETE FROM otros_ingresos WHERE club_id = p_club_id;
    DELETE FROM movimientos_caja WHERE club_id = p_club_id;
    DELETE FROM transferencias WHERE club_id = p_club_id;
    DELETE FROM movimientos_cuenta WHERE club_id = p_club_id;
    DELETE FROM turnos_caja WHERE club_id = p_club_id;
    DELETE FROM cajas WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{finanzas}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- E. JUGADORES
  -- ==========================================================================
  IF p_reset_jugadores THEN
    UPDATE reserva_jugadores SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE reserva_pagos SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE reservas SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE clase_cobros SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE clase_ocurrencia_alumnos SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE clase_alumnos_fijos SET jugador_id = NULL WHERE club_id = p_club_id;
    
    BEGIN
      DELETE FROM jugador_movimientos_cuenta WHERE club_id = p_club_id;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;

    DELETE FROM jugadores WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{jugadores}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- F. CANCHAS Y TARIFAS
  -- ==========================================================================
  IF p_reset_canchas THEN
    DELETE FROM franjas_turno WHERE club_id = p_club_id;
    DELETE FROM tarifas WHERE club_id = p_club_id;
    DELETE FROM canchas WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{canchas}', 'true'::jsonb);
  END IF;

  v_resumen := jsonb_set(v_resumen, '{ok}', 'true'::jsonb);
  RETURN v_resumen;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_resetear_datos_club_modular(BIGINT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

COMMIT;
