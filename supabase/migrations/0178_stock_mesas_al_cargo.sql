-- 0178 — Stock de mesas de buffet se descuenta AL CARGAR el consumo
--
-- Antes: los consumos de buffet_mesa_consumos no tocaban stock; el
-- descuento ocurría recién en fn_cerrar_mesa_buffet → fn_cerrar_venta
-- (fuente 'venta'). Problema: dos mesas podían llevarse la última unidad
-- y el segundo cierre fallaba (o peor, quedaba inconsistencia).
--
-- Ahora:
--   1. fn_cargar_consumo_mesa  → descuenta stock al instante
--      (fuente 'mesa_consumo', link buffet_mesa_consumo_id).
--   2. fn_quitar_consumo_mesa  → repone stock al quitar/reducir
--      (fuente 'reposicion_mesa_consumo').
--   3. fn_cerrar_mesa_buffet   → crea la venta SIN volver a descontar
--      stock (los items ya salieron del inventario al cargarse).
--   4. Backfill: consumos de mesas abiertas al momento de migrar
--      reciben su movimiento 'mesa_consumo' retroactivo.
--
-- Anulación: NO requiere cambios. fn_anular_venta repone por venta_items
-- (fuente 'anulacion_venta', cantidad positiva) y los venta_items de una
-- mesa reflejan exactamente el neto de consumos descontados → el stock
-- vuelve a cero neto. fn_corregir_venta igual (anula + venta nueva que
-- descuenta por el camino normal 'venta').

-- ============================================================================
-- 1. CHECKs de movimientos_stock: nuevas fuentes
-- ============================================================================
ALTER TABLE movimientos_stock
  DROP CONSTRAINT IF EXISTS mov_stock_fuente_enum;
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_fuente_enum CHECK (
    fuente IN (
      'compra_manual', 'venta', 'ajuste', 'ajuste_manual',
      'compra_bot_whatsapp', 'consumo_turno', 'reposicion_consumo',
      'consumo_clase', 'reposicion_consumo_clase', 'anulacion_venta',
      'mesa_consumo', 'reposicion_mesa_consumo'
    )
  );

ALTER TABLE movimientos_stock
  DROP CONSTRAINT IF EXISTS mov_stock_coherencia_fuente;
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_coherencia_fuente CHECK (
    (fuente = 'venta' AND cantidad < 0 AND venta_id IS NOT NULL)
    OR (fuente = 'anulacion_venta' AND cantidad > 0 AND venta_id IS NOT NULL)
    OR (fuente IN ('consumo_turno', 'consumo_clase', 'mesa_consumo') AND cantidad < 0)
    OR (fuente IN ('reposicion_consumo', 'reposicion_consumo_clase', 'reposicion_mesa_consumo') AND cantidad > 0)
    OR (fuente IN ('compra_manual', 'compra_bot_whatsapp') AND cantidad > 0)
    OR (fuente IN ('ajuste', 'ajuste_manual'))
  );

-- ============================================================================
-- 2. Link movimiento → consumo de mesa (espejo de reserva_consumo_id, 0013)
-- ============================================================================
ALTER TABLE movimientos_stock
  ADD COLUMN IF NOT EXISTS buffet_mesa_consumo_id BIGINT
  REFERENCES buffet_mesa_consumos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mov_stock_mesa_consumo
  ON movimientos_stock(buffet_mesa_consumo_id)
  WHERE buffet_mesa_consumo_id IS NOT NULL;

COMMENT ON COLUMN movimientos_stock.buffet_mesa_consumo_id IS
  'FK al consumo de mesa que originó este movimiento (sólo fuente
   mesa_consumo). ON DELETE SET NULL: al quitar un consumo que llega a
   cero la fila se borra y el movimiento queda como evidencia histórica,
   igual que reserva_consumo_id.';

-- ============================================================================
-- 3. Backfill: consumos de mesas ABIERTAS ya cargados → su salida de stock
--    (las mesas cerradas ya descontaron vía fn_cerrar_venta, no se tocan).
-- ============================================================================
INSERT INTO movimientos_stock (
  club_id, producto_id, cantidad, fuente,
  buffet_mesa_consumo_id, observaciones, usuario_id
)
SELECT
  mc.club_id,
  mc.producto_id,
  -mc.cantidad,
  'mesa_consumo',
  mc.id,
  'Consumo de mesa (regularización por cambio de esquema)',
  COALESCE(
    (SELECT u.id FROM usuarios u
      WHERE u.club_id = mc.club_id AND u.rol = 'admin' AND u.activo
      ORDER BY u.fecha_alta LIMIT 1),
    (SELECT u.id FROM usuarios u
      WHERE u.club_id = mc.club_id
      ORDER BY u.fecha_alta LIMIT 1)
  )
FROM buffet_mesa_consumos mc
JOIN buffet_mesas bm ON bm.id = mc.mesa_id
WHERE bm.abierta = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM movimientos_stock ms
    WHERE ms.buffet_mesa_consumo_id = mc.id
      AND ms.fuente = 'mesa_consumo'
  );

-- ============================================================================
-- 4. fn_cargar_consumo_mesa — cargo con descuento de stock inmediato
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_cargar_consumo_mesa(
  p_mesa_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT
)
RETURNS buffet_mesa_consumos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_usuario_id UUID := auth.uid();
  v_mesa buffet_mesas;
  v_producto productos;
  v_stock INT;
  v_existente buffet_mesa_consumos;
  v_consumo buffet_mesa_consumos;
BEGIN
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF NOT has_user_permission('mostrador', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para cargar consumos.';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  -- Lock de la mesa: serializa cargos/quites concurrentes sobre la misma
  -- mesa (upsert de consumos + movimientos de stock atómicos).
  SELECT * INTO v_mesa
  FROM buffet_mesas
  WHERE id = p_mesa_id AND club_id = v_club_id AND abierta = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La mesa no existe, no pertenece a tu club o ya está cerrada.';
  END IF;

  -- Lock del producto + validaciones.
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado.', v_producto.nombre;
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;
  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente de "%": hay % unidades.',
      v_producto.nombre, v_stock;
  END IF;

  -- Upsert del consumo (mismo patrón que el frontend: 1 fila por producto).
  SELECT * INTO v_existente
  FROM buffet_mesa_consumos
  WHERE mesa_id = p_mesa_id AND producto_id = p_producto_id
  LIMIT 1;

  IF FOUND THEN
    UPDATE buffet_mesa_consumos
    SET cantidad = cantidad + p_cantidad
    WHERE id = v_existente.id
    RETURNING * INTO v_consumo;
  ELSE
    INSERT INTO buffet_mesa_consumos (
      club_id, mesa_id, producto_id, cantidad
    ) VALUES (
      v_club_id, p_mesa_id, p_producto_id, p_cantidad
    )
    RETURNING * INTO v_consumo;
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    buffet_mesa_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, -p_cantidad, 'mesa_consumo',
    v_consumo.id,
    'Consumo mesa ' || COALESCE(v_mesa.nombre, '#' || p_mesa_id::TEXT),
    v_usuario_id
  );

  RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cargar_consumo_mesa(BIGINT, BIGINT, INT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.fn_cargar_consumo_mesa(BIGINT, BIGINT, INT)
  FROM PUBLIC;

-- ============================================================================
-- 5. fn_quitar_consumo_mesa — quita/reduce y repone stock
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_quitar_consumo_mesa(
  p_mesa_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_usuario_id UUID := auth.uid();
  v_mesa buffet_mesas;
  v_existente buffet_mesa_consumos;
  v_a_reponer INT;
BEGIN
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF NOT has_user_permission('mostrador', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para quitar consumos.';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_mesa
  FROM buffet_mesas
  WHERE id = p_mesa_id AND club_id = v_club_id AND abierta = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La mesa no existe, no pertenece a tu club o ya está cerrada.';
  END IF;

  SELECT * INTO v_existente
  FROM buffet_mesa_consumos
  WHERE mesa_id = p_mesa_id AND producto_id = p_producto_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese producto no está cargado en la mesa.';
  END IF;

  -- Reponer lo que realmente se descuenta (si piden más de lo cargado,
  -- se repone como máximo lo cargado).
  v_a_reponer := LEAST(p_cantidad, v_existente.cantidad);

  IF p_cantidad >= v_existente.cantidad THEN
    DELETE FROM buffet_mesa_consumos WHERE id = v_existente.id;
  ELSE
    UPDATE buffet_mesa_consumos
    SET cantidad = cantidad - p_cantidad
    WHERE id = v_existente.id;
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, v_a_reponer, 'reposicion_mesa_consumo',
    'Quitado de mesa ' || COALESCE(v_mesa.nombre, '#' || p_mesa_id::TEXT),
    v_usuario_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_quitar_consumo_mesa(BIGINT, BIGINT, INT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.fn_quitar_consumo_mesa(BIGINT, BIGINT, INT)
  FROM PUBLIC;

-- ============================================================================
-- 6. fn_cerrar_mesa_buffet — cierra la venta SIN descontar stock de nuevo
-- ============================================================================
-- Los consumos ya salieron del inventario al cargarse (fuente
-- 'mesa_consumo'). Esta versión replica la rama de pago único de
-- fn_cerrar_venta (la mesa siempre cobró con un solo medio) pero omite
-- la validación de stock y los movimientos 'venta'.
CREATE OR REPLACE FUNCTION public.fn_cerrar_mesa_buffet(
  p_mesa_id BIGINT,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_jugador_id BIGINT DEFAULT NULL
)
RETURNS ventas
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_mesa buffet_mesas;
  v_venta ventas;
  v_producto productos;
  v_total DECIMAL(12,2) := 0;
  v_pids BIGINT[];
  v_cants INT[];
  v_i INT;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
  v_turno_caja_id BIGINT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Lock y validar mesa
  SELECT * INTO v_mesa
  FROM buffet_mesas
  WHERE id = p_mesa_id AND club_id = v_club_id AND abierta = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La mesa no existe, no pertenece a tu club o ya está cerrada.';
  END IF;

  -- Consolidar ítems desde los consumos (ya descontados del stock).
  SELECT
    array_agg(producto_id ORDER BY producto_id),
    array_agg(cantidad ORDER BY producto_id)
  INTO v_pids, v_cants
  FROM (
    SELECT producto_id, SUM(cantidad)::INT AS cantidad
    FROM buffet_mesa_consumos
    WHERE mesa_id = p_mesa_id
    GROUP BY producto_id
  ) c;

  IF v_pids IS NULL THEN
    RAISE EXCEPTION 'La mesa no tiene consumos registrados.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- Lock de productos y cálculo del total (precio/costo actuales, igual
  -- que hacía fn_cerrar_venta al momento del cierre).
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto % ya no existe en tu club.', v_pids[v_i];
    END IF;

    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
    END IF;

    v_total := v_total + (v_producto.precio * v_cants[v_i]);
  END LOOP;

  -- Resolver cuenta del medio de pago (rama de pago único).
  SELECT mcd.cuenta_id, c.es_caja_fisica
    INTO v_cuenta_id, v_es_caja
  FROM medio_cuenta_default mcd
  JOIN cuentas c ON c.id = mcd.cuenta_id
  WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
  v_es_caja := COALESCE(v_es_caja, FALSE);

  IF v_es_caja OR p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  INSERT INTO ventas (
    club_id, monto_total, medio_pago, observaciones, usuario_id,
    turno_caja_id, cuenta_id, jugador_id
  ) VALUES (
    v_club_id, v_total, p_medio_pago, p_observaciones, v_usuario_id,
    v_turno_caja_id, v_cuenta_id, p_jugador_id
  )
  RETURNING * INTO v_venta;

  INSERT INTO venta_pagos (
    club_id, venta_id, monto, medio_pago, cuenta_id, turno_caja_id, usuario_id, jugador_id
  ) VALUES (
    v_club_id, v_venta.id, v_total, p_medio_pago, v_cuenta_id, v_turno_caja_id, v_usuario_id, p_jugador_id
  );

  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    INSERT INTO venta_items (
      club_id, venta_id, producto_id, producto_nombre,
      cantidad, precio_unitario, costo_unitario, subtotal,
      linea
    ) VALUES (
      v_club_id, v_venta.id, v_producto.id, v_producto.nombre,
      v_cants[v_i], v_producto.precio, v_producto.costo,
      v_producto.precio * v_cants[v_i],
      v_producto.linea
    );
    -- Sin movimientos_stock: ya descontados como 'mesa_consumo'.
  END LOOP;

  UPDATE buffet_mesas
  SET abierta = FALSE,
      cerrada_at = NOW(),
      venta_id = v_venta.id
  WHERE id = p_mesa_id;

  RETURN v_venta;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cerrar_mesa_buffet(BIGINT, VARCHAR, TEXT, BIGINT)
  TO authenticated;
