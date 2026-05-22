-- ============================================================================
-- 0026_consumo_turno_acepta_shop.sql
-- fn_cargar_consumo_turno: revertir el bloqueo de productos shop.
--
-- =====================================================================
-- CONTEXTO — POR QUÉ ESTA MIGRACIÓN
-- =====================================================================
-- La 0025 agregó un bloque que rechazaba cargar productos de línea=shop
-- a la cuenta del turno:
--
--   IF v_producto.linea = 'shop' THEN
--     RAISE EXCEPTION 'Los artículos de shop no se cargan a la cuenta
--                      del turno; vendelos en el mostrador.';
--   END IF;
--
-- Esa restricción fue un error de diseño. En un club de pádel es
-- normal que un jugador agarre pelotas (u otro artículo de shop)
-- durante el partido y lo pague al final junto con el alquiler y los
-- consumos del buffet. El turno tiene que poder absorber CUALQUIER
-- producto activo.
--
-- =====================================================================
-- QUÉ HACE ESTA MIGRACIÓN
-- =====================================================================
-- CREATE OR REPLACE de fn_cargar_consumo_turno con UN SOLO cambio
-- respecto de la 0025:
--   ⭐ REMOVIDO: el bloque IF v_producto.linea = 'shop' THEN RAISE.
--
-- QUÉ SE MANTIENE (importante):
--   - El snapshot de `linea` en el INSERT a reserva_consumos: sirve
--     para el EERR (saber si lo cargado al turno fue buffet o shop).
--     NO se saca. Sigue siendo parte de la fila.
--   - Todo el resto de la lógica original (validaciones de sesión,
--     cantidad, tipo_reparto, reserva no cancelada, lock del producto,
--     check activo, cálculo de stock, INSERT en movimientos_stock).
--   - Signatura IDÉNTICA. El frontend no se entera.
--
-- Resultado: la función vuelve al comportamiento previo a la 0025
-- (acepta cualquier producto activo) pero conserva el snapshot de
-- línea agregado en la 0024/0025.
--
-- =====================================================================
-- IMPACTO EN EL FRONTEND
-- =====================================================================
-- El bloque 3 frontend (cuando se haga) NO debe filtrar
-- ConsumosCatalogo a línea='buffet'. El catálogo del turno muestra
-- TODOS los productos activos (buffet + shop), igual que antes de la
-- 0025.
--
-- No hay nada que rollbackear en el frontend porque ese filtro nunca
-- llegó a implementarse.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR
)
RETURNS reserva_consumos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva reservas;
  v_producto productos;
  v_stock INT;
  v_consumo reserva_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  IF p_tipo_reparto IS NULL
     OR p_tipo_reparto NOT IN ('partido', 'general') THEN
    RAISE EXCEPTION 'Tipo de reparto inválido (esperado: partido o general).';
  END IF;

  -- Verificar reserva: existe, del club, no cancelada.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION
      'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  -- Lock exclusivo del producto: serializa con ventas y otras cargas
  -- concurrentes que toquen el stock del mismo producto.
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION
      'El producto "%" está desactivado, no se puede vender.',
      v_producto.nombre;
  END IF;

  -- ⭐ REMOVIDO 0026 — el bloque que rechazaba linea='shop' (introducido
  --    en la 0025) era un error de diseño. En un club de pádel un
  --    jugador puede cargar pelotas (u otro artículo de shop) a la
  --    cuenta del turno y pagarlas al final. La función acepta
  --    CUALQUIER producto activo, como hacía antes de la 0025.

  -- Calcular stock bajo el lock.
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION
      'Stock insuficiente de "%": hay % unidades, querés cargar %.',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- INSERT del consumo con snapshots + tipo_reparto + línea.
  -- El snapshot de `linea` se MANTIENE (introducido en 0025): sirve
  -- para el EERR (saber si lo cargado al turno fue buffet o shop).
  -- Ahora la línea snapshot puede ser 'buffet' O 'shop' (antes de la
  -- 0026 siempre era 'buffet' por el check removido; ahora refleja
  -- la línea real del producto).
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto,
    linea
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    p_tipo_reparto,
    v_producto.linea
  )
  RETURNING * INTO v_consumo;

  -- INSERT movimiento de salida atado al consumo nuevo (sin cambios).
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


COMMIT;

-- ============================================================================
-- Fin de la migración 0026_consumo_turno_acepta_shop.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Cargar producto de SHOP al turno → debe FUNCIONAR ----------
-- En consola del browser (logueado como admin/vendedor del club):
--   await window.supabase.rpc('fn_cargar_consumo_turno', {
--     p_reserva_id: <ID de una reserva activa>,
--     p_producto_id: <ID de Pelotas Bull Padel — el de linea=shop>,
--     p_cantidad: 1,
--     p_tipo_reparto: 'partido'
--   });
-- → OK (sin error). Verificar que el snapshot quedó con linea='shop':
--   SELECT id, producto_nombre, linea, tipo_reparto
--   FROM reserva_consumos ORDER BY id DESC LIMIT 1;
-- → linea = 'shop' (NO 'buffet' por default — refleja la línea real).

-- ---------- B. Cargar producto de BUFFET al turno → sigue funcionando ----------
-- Mismo escenario con un producto de buffet:
-- → OK, linea = 'buffet' en el snapshot.

-- ---------- C. Signatura sin cambios ----------
-- SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS ret
-- FROM pg_proc
-- WHERE proname = 'fn_cargar_consumo_turno';
-- -- args y ret idénticos a antes (BIGINT, BIGINT, INT, VARCHAR → reserva_consumos).
-- ============================================================================
