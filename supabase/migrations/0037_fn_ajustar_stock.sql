-- ============================================================================
-- 0037_fn_ajustar_stock.sql
-- RPC fn_ajustar_stock para que el admin registre ajustes manuales de
-- inventario (recuento físico, rotura, faltante, vencido, otro) con
-- razón obligatoria, dejando rastro en el libro mayor.
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- - Crea fn_ajustar_stock(p_producto_id, p_cantidad, p_razon).
-- - p_cantidad puede ser positiva o negativa (señal libre permitida por
--   el CHECK mov_stock_coherencia_fuente del 0009 cuando fuente='ajuste').
-- - Inserta UN movimiento con fuente='ajuste' y venta_id=NULL.
-- - Valida que el stock resultante no quede negativo (RAISE si sí).
--
-- NO toca: productos, ventas, venta_items, fn_cerrar_venta, ni el modelo
-- de costo. Esto es Bloque 1 del módulo de inventario (Nivel A — sin
-- migración de tablas).
--
-- =====================================================================
-- CONCURRENCIA — SERIALIZACIÓN POR PRODUCTO
-- =====================================================================
-- SELECT FOR UPDATE sobre productos[X] toma row lock exclusivo hasta el
-- COMMIT. Garantiza que dos ajustes concurrentes sobre el mismo producto
-- se serialicen:
--
--   TX1: FOR UPDATE productos[X] → lock adquirido.
--   TX2: FOR UPDATE productos[X] → ESPERA hasta que TX1 termine.
--   TX1: lee SUM movimientos, valida, INSERT, COMMIT → libera lock.
--   TX2: obtiene lock + ve los cambios committed de TX1 (READ COMMITTED).
--        Lee SUM ya con el INSERT de TX1 incluido, valida con stock
--        actualizado.
--
-- Aunque la validación SUM lee `movimientos_stock` (otra tabla), el lock
-- sobre `productos` sigue siendo el punto de serialización: ambas TX
-- pasan obligatoriamente por ese cuello antes de leer movimientos.
--
-- Mismo patrón que `fn_cerrar_venta` (0009): el lock sobre la fila de
-- producto es la barrera contra race conditions de stock.
--
-- Edge con compras manuales (fuente='compra_manual'): la RPC de compra
-- NO hace FOR UPDATE (solo suma, no valida non-negativo). Si una
-- compra y un ajuste corren a la vez sobre el mismo producto, no hay
-- bug — en el peor caso el ajuste se rechaza conservadoramente porque
-- todavía no ve la entrada commiteada, y el admin reintenta.
--
-- =====================================================================
-- GATE
-- =====================================================================
-- Admin del club. Razón obligatoria. SECURITY INVOKER — la policy
-- mov_stock_insert ya permite INSERT a cualquier authenticated del
-- club, pero el gate en el body limita explícitamente a admin (defensa
-- en capas + queda registrada la intención en código).
-- ============================================================================

BEGIN;

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
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede ajustar stock.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad = 0 THEN
    RAISE EXCEPTION 'La cantidad del ajuste no puede ser 0.';
  END IF;
  IF p_razon IS NULL OR LENGTH(TRIM(p_razon)) = 0 THEN
    RAISE EXCEPTION 'La razón del ajuste es obligatoria.';
  END IF;

  -- ── Lock + validación de pertenencia al club. ─────────────────────
  --    SELECT FOR UPDATE sobre la fila del producto serializa ajustes
  --    concurrentes (y choca con cierres de venta del mismo producto).
  --    Ver bloque CONCURRENCIA en el header.
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  -- ── Calcular stock actual y validar no-negativo. ──────────────────
  --    Como tenemos el lock de productos[X], cualquier otra TX que
  --    quiera tocar el stock de este producto (ajuste o venta) está
  --    esperando. Las compras pueden haber commiteado en paralelo, pero
  --    solo suman — la validación las cuenta en SUM y no genera bug.
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock_actual
  FROM movimientos_stock
  WHERE producto_id = p_producto_id;

  v_stock_resultante := v_stock_actual + p_cantidad;

  IF v_stock_resultante < 0 THEN
    RAISE EXCEPTION
      'El ajuste dejaría el stock en negativo (actual: %, ajuste: %, resultante: %). Ajustá solo hasta lo que hay.',
      v_stock_actual, p_cantidad, v_stock_resultante;
  END IF;

  -- ── INSERT del movimiento. ────────────────────────────────────────
  --    fuente='ajuste' permite signo libre y venta_id NULL
  --    (CHECK mov_stock_coherencia_fuente del 0009). La policy
  --    mov_stock_insert valida club_id = current_club_id().
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
  'Ajuste manual de stock (recuento físico, rotura, faltante, vencido,
   otro). Inserta un movimiento con fuente=''ajuste'' y razón
   obligatoria. Gate: admin del club. Serializa ajustes concurrentes
   del mismo producto vía SELECT FOR UPDATE sobre productos. Valida
   que el stock resultante no quede negativo.';

GRANT EXECUTE ON FUNCTION fn_ajustar_stock(BIGINT, INT, TEXT) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0037_fn_ajustar_stock.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Existencia + signatura + grant ----------
-- SELECT proname, pg_get_function_identity_arguments(oid)
-- FROM pg_proc WHERE proname = 'fn_ajustar_stock';
-- → 1 fila: "p_producto_id bigint, p_cantidad integer, p_razon text"
--
-- SELECT has_function_privilege('authenticated',
--   'fn_ajustar_stock(BIGINT, INT, TEXT)', 'execute');
-- → true

-- ---------- B. Ajuste positivo (entrada manual con razón) ----------
-- Como admin de Signo, sobre un producto existente:
--   await window.supabase.rpc('fn_ajustar_stock', {
--     p_producto_id: <id>, p_cantidad: 5, p_razon: 'Recuento físico'
--   });
-- → fila nueva en movimientos_stock con cantidad=5, fuente='ajuste',
--   observaciones='Recuento físico', venta_id=NULL.
-- → vw_productos_con_stock muestra +5 para ese producto.

-- ---------- C. Ajuste negativo (faltante / rotura) ----------
-- Stock actual del producto: digamos 24.
--   await window.supabase.rpc('fn_ajustar_stock', {
--     p_producto_id: <id>, p_cantidad: -2, p_razon: 'Rotura - dos unidades dañadas'
--   });
-- → movimiento con cantidad=-2 fuente='ajuste'.
-- → vw_productos_con_stock muestra -2 para ese producto (22 final).

-- ---------- D. Rechazo: dejaría stock negativo ----------
-- Stock actual: 5.
--   await window.supabase.rpc('fn_ajustar_stock', {
--     p_producto_id: <id>, p_cantidad: -10, p_razon: 'Test'
--   });
-- → ERROR: 'El ajuste dejaría el stock en negativo (actual: 5, ajuste: -10,
--   resultante: -5). Ajustá solo hasta lo que hay.'
-- → cero inserción en movimientos_stock.

-- ---------- E. Rechazo: cantidad 0 ----------
-- → ERROR: 'La cantidad del ajuste no puede ser 0.'

-- ---------- F. Rechazo: razón vacía ----------
--   await window.supabase.rpc('fn_ajustar_stock', {
--     p_producto_id: <id>, p_cantidad: 1, p_razon: ''
--   });
-- → ERROR: 'La razón del ajuste es obligatoria.'

-- ---------- G. Rechazo: rol vendedor ----------
-- Como vendedor:
-- → ERROR: 'Solo el administrador puede ajustar stock.'

-- ---------- H. Rechazo: producto de otro club ----------
-- Como admin del club 1, intentar ajustar producto del club 2:
-- → ERROR: 'El producto no existe o no pertenece a tu club.'
--   (RLS también filtra; la verificación en el body da mensaje claro).

-- ---------- I. Concurrencia (manual, difícil de simular) ----------
-- En 2 conexiones simultáneas, ambos como admin, sobre stock = 5:
--   conn1> BEGIN; SELECT fn_ajustar_stock(<id>, -3, 'Test A');
--   conn2> BEGIN; SELECT fn_ajustar_stock(<id>, -4, 'Test B');
--          (espera por el lock)
--   conn1> COMMIT;
--   conn2> (continúa, lee stock=2, intenta -4 → resulta -2 < 0 → RAISE)
--          ROLLBACK.
-- → Resultado final: 1 sola fila insertada (la del -3).

-- ---------- J. No rompe ventas concurrentes ----------
-- Vender el mismo producto mientras se carga un ajuste:
-- → Ambas RPCs hacen SELECT FOR UPDATE sobre productos[X]. La segunda
--   espera a la primera. Stock consistente al final.
-- ============================================================================
