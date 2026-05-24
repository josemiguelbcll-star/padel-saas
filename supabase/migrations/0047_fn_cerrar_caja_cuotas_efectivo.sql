-- ============================================================================
-- 0047_fn_cerrar_caja_cuotas_efectivo.sql
-- FIX del arqueo de caja: contemplar las cuotas (gasto_cuotas) pagadas en
-- EFECTIVO al calcular el esperado de cierre.
--
-- =====================================================================
-- EL BUG
-- =====================================================================
-- En el modelo de Cuentas por Pagar (0045), un gasto a plazo o recibido
-- por OC nace SIEMPRE pendiente: gastos.fecha_pago = NULL,
-- gastos.medio_pago = NULL, gastos.turno_caja_id = NULL. El efectivo que
-- sale del cajón al pagar una cuota se registra en la CUOTA
-- (gasto_cuotas.turno_caja_id + medio_pago='efectivo'), no en el gasto.
--
-- fn_cerrar_caja quedó congelada en la 0028 (anterior a la 0045): su
-- cálculo del esperado RESTA los gastos en efectivo leyendo la tabla
-- `gastos`, pero NUNCA mira `gasto_cuotas`. Resultado: cuando se paga una
-- cuota en efectivo, la plata salió del cajón pero el esperado no la
-- descuenta → el arqueo marca un FALTANTE FALSO igual al monto de la
-- cuota.
--
-- =====================================================================
-- EL FIX (quirúrgico, aditivo)
-- =====================================================================
-- CREATE OR REPLACE de fn_cerrar_caja con el cuerpo COMPLETO de la 0028
-- + exactamente 3 agregados:
--   1. DECLARE v_cuotas_efectivo DECIMAL(12,2).
--   2. SELECT que suma las cuotas en efectivo de ESTA caja.
--   3. Un término más en v_esperado que las RESTA (igual que los gastos
--      en efectivo: la cuota pagada en efectivo es plata que salió del
--      cajón).
--
-- Las 4 fuentes existentes (cobros efectivo con reembolsos, movimientos
-- manuales, otros_ingresos efectivo, gastos efectivo), el gate de rol, la
-- validación de p_efectivo_contado, el lock FOR UPDATE, el UPDATE con la
-- diferencia y el RETURN quedan IDÉNTICOS a la 0028. Signatura idéntica
-- → cero cambio para el frontend.
--
-- =====================================================================
-- NO-DUPLICACIÓN (confirmado contra el código de la 0045)
-- =====================================================================
-- Un gasto cae en UNA sola rama, nunca en las dos:
--   - Gasto pagado al instante (ABM legacy): gastos.fecha_pago NOT NULL,
--     gastos.medio_pago seteado, SIN cuota (fn_registrar_gasto 0045:429
--     crea cuota solo si fecha_pago IS NULL). → lo cuenta la rama de
--     `gastos` (v_gastos_efectivo).
--   - Gasto pendiente (ABM / recepción de OC): gastos.fecha_pago NULL,
--     gastos.medio_pago NULL, CON cuota. → NO lo cuenta la rama de
--     `gastos` (medio_pago NULL); lo cuenta la rama nueva de
--     `gasto_cuotas` (v_cuotas_efectivo).
-- La guarda `fecha_pago IS NULL` al crear la cuota garantiza la
-- exclusión mutua. La rama nueva y v_gastos_efectivo nunca tocan el
-- mismo gasto.
--
-- =====================================================================
-- SIN guarda `activo` en la rama de cuotas (decisión tomada)
-- =====================================================================
-- gasto_cuotas NO tiene columna `activo` y las cuotas son inmutables
-- hoy (no existe flujo de anulación). El SELECT nuevo suma TODAS las
-- cuotas en efectivo de la caja, sin filtro `activo`. Cuando se
-- construya la anulación de cuotas (Filosofía B), se resolverá la
-- exclusión de las anuladas ahí — probablemente con JOIN a `gastos`
-- por el `activo` del gasto madre. No se agrega columna a gasto_cuotas
-- en esta migración.
--
-- =====================================================================
-- IMPACTO EN CIERRES HISTÓRICOS
-- =====================================================================
-- Ninguno. Los cierres ya cerrados no se recalculan (esta función solo
-- corre al cerrar una caja abierta). Las cajas que aún no tienen cuotas
-- en efectivo dan v_cuotas_efectivo = 0 (mismo esperado que antes). El
-- fix corrige los cierres futuros de cajas con pagos de cuota en
-- efectivo.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_cerrar_caja(
  p_turno_caja_id BIGINT,
  p_efectivo_contado DECIMAL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS turnos_caja
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_turno turnos_caja;
  v_entradas_cobros DECIMAL(12,2);
  v_movimientos_neto DECIMAL(12,2);
  v_otros_ingresos_efectivo DECIMAL(12,2);  -- ⭐ NUEVO 0028
  v_gastos_efectivo DECIMAL(12,2);          -- ⭐ NUEVO 0028
  v_cuotas_efectivo DECIMAL(12,2);          -- ⭐ NUEVO 0047
  v_esperado DECIMAL(12,2);
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cerrar la caja.';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio y no puede ser negativo.';
  END IF;

  -- Lock para evitar cierres concurrentes (sin cambios).
  SELECT * INTO v_turno
  FROM turnos_caja
  WHERE id = p_turno_caja_id AND club_id = current_club_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada.';
  END IF;
  IF v_turno.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta caja ya está cerrada.';
  END IF;

  -- ── Entradas de cobros en efectivo (regla de oro) ────────────────
  -- IDÉNTICO a 0022/0028. Filtramos por turno_caja_id Y medio_pago='efectivo'
  -- (doble defensa). reserva_pagos.tipo='reembolso' resta (devolvimos
  -- efectivo).
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'reembolso' THEN -monto ELSE monto END
  ), 0)
  INTO v_entradas_cobros
  FROM (
    SELECT monto, tipo
      FROM reserva_pagos
      WHERE turno_caja_id = p_turno_caja_id
        AND medio_pago = 'efectivo'
    UNION ALL
    SELECT monto_total AS monto, 'pago' AS tipo
      FROM ventas
      WHERE turno_caja_id = p_turno_caja_id
        AND medio_pago = 'efectivo'
    UNION ALL
    SELECT monto, 'pago' AS tipo
      FROM clase_cobros
      WHERE turno_caja_id = p_turno_caja_id
        AND medio_pago = 'efectivo'
  ) entradas;

  -- ── Movimientos manuales (neto) ──────────────────────────────────
  -- IDÉNTICO a 0022/0028. ajuste_positivo suma; el resto (retiro,
  -- pago_proveedor, ajuste_negativo) resta.
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'ajuste_positivo' THEN monto ELSE -monto END
  ), 0)
  INTO v_movimientos_neto
  FROM caja_movimientos_manuales
  WHERE turno_caja_id = p_turno_caja_id;

  -- ── Otros ingresos en efectivo de esta caja (SUMAN) ──────────────
  -- IDÉNTICO a 0028. Filtro triple: caja específica + efectivo + activo
  -- (para que los ingresos anulados con activo=FALSE no se cuenten).
  SELECT COALESCE(SUM(monto), 0)
  INTO v_otros_ingresos_efectivo
  FROM otros_ingresos
  WHERE turno_caja_id = p_turno_caja_id
    AND medio_pago = 'efectivo'
    AND activo = TRUE;

  -- ── Gastos en efectivo de esta caja (RESTAN) ─────────────────────
  -- IDÉNTICO a 0028. Mismo filtro triple. Cubre los gastos pagados al
  -- instante en efectivo (camino legacy / ABM); los gastos a plazo o de
  -- OC nacen pendientes (medio_pago NULL) y NO entran acá — su efectivo
  -- se descuenta por la rama de cuotas de abajo.
  SELECT COALESCE(SUM(monto), 0)
  INTO v_gastos_efectivo
  FROM gastos
  WHERE turno_caja_id = p_turno_caja_id
    AND medio_pago = 'efectivo'
    AND activo = TRUE;

  -- ── ⭐ NUEVO 0047 — Cuotas de gastos pagadas en EFECTIVO (RESTAN) ──
  -- En el modelo de CxP (0045) el gasto nace pendiente y el efectivo
  -- sale del cajón al pagar la cuota (gasto_cuotas.turno_caja_id +
  -- medio_pago='efectivo'). Hasta esta migración el arqueo no lo
  -- descontaba → marcaba un faltante falso. Restamos igual que los
  -- gastos en efectivo.
  --
  -- SIN guarda `activo`: gasto_cuotas no tiene esa columna y las cuotas
  -- son inmutables hoy (sin flujo de anulación). Cuando se construya la
  -- anulación de cuotas, la exclusión de las anuladas se resolverá ahí
  -- (probablemente JOIN a gastos por el activo del gasto madre).
  --
  -- NO duplica con v_gastos_efectivo: un gasto con cuotas tiene
  -- gastos.medio_pago=NULL, así que nunca entra en la rama de `gastos`.
  SELECT COALESCE(SUM(monto), 0)
  INTO v_cuotas_efectivo
  FROM gasto_cuotas
  WHERE turno_caja_id = p_turno_caja_id
    AND medio_pago = 'efectivo';

  -- ⭐ ESPERADO: apertura + cobros + movimientos neto
  --    + otros_ingresos efectivo (suma) − gastos efectivo (resta)
  --    − cuotas efectivo (resta — ⭐ NUEVO 0047).
  v_esperado := v_turno.monto_apertura
              + v_entradas_cobros
              + v_movimientos_neto
              + v_otros_ingresos_efectivo
              - v_gastos_efectivo
              - v_cuotas_efectivo;          -- ⭐ NUEVO 0047

  UPDATE turnos_caja
  SET cerrada_en = NOW(),
      usuario_cierre = auth.uid(),
      efectivo_esperado = v_esperado,
      efectivo_contado = p_efectivo_contado,
      diferencia = p_efectivo_contado - v_esperado,
      observaciones_cierre = p_observaciones
  WHERE id = p_turno_caja_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION fn_cerrar_caja(BIGINT, DECIMAL, TEXT) IS
  'Cierra una caja abierta con arqueo. Calcula esperado server-side:
   apertura + cobros efectivo (con reembolsos restando) + movimientos
   manuales netos + otros_ingresos efectivo (0028) − gastos efectivo
   (0028) − cuotas de gastos pagadas en efectivo (0047). Guarda
   diferencia = contado − esperado. Gate: admin O vendedor. Lock
   FOR UPDATE para concurrencia.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0047_fn_cerrar_caja_cuotas_efectivo.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Pre-requisito: tener caja abierta para los tests de efectivo. Si no:
--   SELECT fn_abrir_caja(0);

-- ---------- A. Signatura intacta ----------
-- SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS ret
-- FROM pg_proc WHERE proname = 'fn_cerrar_caja';
-- → args y ret idénticos a la 0028 (3 params, RETURNS turnos_caja).

-- ---------- B. Pago de cuota en efectivo se descuenta del esperado ----------
-- 1. Abrí caja: SELECT fn_abrir_caja(0);  (monto_apertura = 0)
-- 2. Cargá un gasto pendiente (genera 1 cuota):
--    await window.supabase.rpc('fn_registrar_gasto', {
--      p_categoria_id: <X>, p_monto: 3000, p_fecha_gasto: '2026-05-24',
--      p_fecha_vencimiento: '2026-06-24'
--    });
-- 3. Pagá la cuota en efectivo:
--    await window.supabase.rpc('fn_pagar_cuota', {
--      p_cuota_id: <id_cuota>, p_fecha_pago: '2026-05-24', p_medio_pago: 'efectivo'
--    });
-- 4. Cerrá la caja contando 0 (salieron $3000 del cajón vacío → esperado = -3000):
--    await window.supabase.rpc('fn_cerrar_caja', {
--      p_turno_caja_id: <id>, p_efectivo_contado: 0
--    });
-- → efectivo_esperado = -3000, diferencia = 0 - (-3000) = 3000... NO:
--   diferencia = contado − esperado = 0 − (−3000) = 3000. Para que cuadre
--   en 0 hay que arrancar la caja con apertura 3000 y contar 0, o
--   apertura 0 y contar -3000 (imposible: contado >= 0).
--   Prueba limpia: apertura=3000, pagar cuota 3000 efectivo, contar 0:
--   esperado = 3000 − 3000 = 0; diferencia = 0 − 0 = 0. CUADRA. ✓
--   (Antes del fix: esperado = 3000; diferencia = 0 − 3000 = −3000 faltante FALSO.)

-- ---------- C. No-duplicación: gasto pagado al instante en efectivo ----------
-- Gasto con pago al instante en efectivo (sin cuota):
--   await window.supabase.rpc('fn_registrar_gasto', {
--     p_categoria_id: <X>, p_monto: 1000, p_fecha_gasto: '2026-05-24',
--     p_fecha_pago: '2026-05-24', p_medio_pago: 'efectivo'
--   });
-- → Lo cuenta SOLO v_gastos_efectivo (gastos.medio_pago='efectivo'); no
--   genera cuota, así que v_cuotas_efectivo no lo toca. Se resta una sola vez.

-- ---------- D. Caja sin cuotas en efectivo → mismo esperado que antes ----------
-- Una caja con solo cobros/ventas/gastos al instante (sin pagos de cuota
-- en efectivo) da v_cuotas_efectivo = 0 → esperado idéntico a la 0028.
-- ============================================================================
