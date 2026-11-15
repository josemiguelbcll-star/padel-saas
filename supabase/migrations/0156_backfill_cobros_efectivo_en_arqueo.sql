-- ============================================================================
-- 0156_backfill_cobros_efectivo_en_arqueo.sql
-- Corrige los cobros en efectivo que quedaron SIN caja (turno_caja_id NULL) y
-- por eso nunca entraron a su arqueo. Los REASIGNA a la caja abierta en el
-- momento del cobro y RECALCULA el arqueo de las cajas cerradas afectadas.
--
-- NO crea ninguna tabla/objeto: solo UPDATEs sobre las tablas existentes.
--
-- =====================================================================
-- POR QUÉ PASA (causa raíz)
-- =====================================================================
-- El arqueo (fn_cerrar_caja) suma SOLO las filas con turno_caja_id = <caja>.
-- Hubo ventanas donde las RPCs de cobro escribían cuenta_id (0057) pero NO el
-- turno_caja_id (ej. la seña de fn_crear_reserva hasta que se cerró el hueco
-- en 0129). Esos cobros en efectivo quedaron con turno_caja_id = NULL → nunca
-- se sumaron al esperado de la caja de ese día.
--
-- =====================================================================
-- QUÉ HACE (idempotente, no destructivo)
-- =====================================================================
--   PASO 1 — Reasigna turno_caja_id a los cobros huérfanos (reserva_pagos,
--     clase_cobros, venta_pagos, ventas) que entran al cajón (cuenta
--     es_caja_fisica o medio_pago='efectivo'), según la caja ABIERTA en su
--     fecha_hora (modalidad por_dia o por_vendedor). Si no había caja abierta
--     (cobro pre-caja), queda NULL (histórico real).
--   PASO 2 — Recalcula efectivo_esperado y diferencia de las cajas CERRADAS,
--     replicando el cálculo de fn_cerrar_caja (0130). Solo escribe las que
--     quedaron desactualizadas; el resto no se toca. efectivo_contado se
--     conserva.
--
-- No modifica montos, medios, cuentas ni cajas abiertas. Re-ejecutar no
-- cambia nada (solo actúa sobre turno_caja_id IS NULL y sobre esperados que
-- difieren).
-- ============================================================================

BEGIN;

-- ============================================================================
-- PASO 1a — reserva_pagos (señas / pagos / reembolsos en efectivo)
-- ============================================================================
UPDATE reserva_pagos rp
SET turno_caja_id = (
  SELECT t.id
    FROM turnos_caja t
   WHERE t.club_id = rp.club_id
     AND t.abierta_en <= rp.fecha_hora
     AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= rp.fecha_hora
     AND (t.modalidad = 'por_dia' OR t.vendedor_id = rp.usuario_id)
   ORDER BY t.abierta_en DESC, t.id DESC
   LIMIT 1
)
WHERE rp.turno_caja_id IS NULL
  AND (rp.medio_pago = 'efectivo'
       OR rp.cuenta_id IN (SELECT id FROM cuentas WHERE es_caja_fisica = TRUE))
  AND EXISTS (
    SELECT 1 FROM turnos_caja t
     WHERE t.club_id = rp.club_id
       AND t.abierta_en <= rp.fecha_hora
       AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= rp.fecha_hora
       AND (t.modalidad = 'por_dia' OR t.vendedor_id = rp.usuario_id)
  );

-- ============================================================================
-- PASO 1b — clase_cobros (cobros de clases en efectivo)
-- ============================================================================
UPDATE clase_cobros cc
SET turno_caja_id = (
  SELECT t.id
    FROM turnos_caja t
   WHERE t.club_id = cc.club_id
     AND t.abierta_en <= cc.fecha_hora
     AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= cc.fecha_hora
     AND (t.modalidad = 'por_dia' OR t.vendedor_id = cc.usuario_id)
   ORDER BY t.abierta_en DESC, t.id DESC
   LIMIT 1
)
WHERE cc.turno_caja_id IS NULL
  AND (cc.medio_pago = 'efectivo'
       OR cc.cuenta_id IN (SELECT id FROM cuentas WHERE es_caja_fisica = TRUE))
  AND EXISTS (
    SELECT 1 FROM turnos_caja t
     WHERE t.club_id = cc.club_id
       AND t.abierta_en <= cc.fecha_hora
       AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= cc.fecha_hora
       AND (t.modalidad = 'por_dia' OR t.vendedor_id = cc.usuario_id)
  );

-- ============================================================================
-- PASO 1c — venta_pagos (partes en efectivo de ventas buffet/mostrador)
--   fn_cerrar_caja (0130) lee venta_pagos: es la fuente que va al arqueo.
-- ============================================================================
UPDATE venta_pagos vp
SET turno_caja_id = (
  SELECT t.id
    FROM turnos_caja t
   WHERE t.club_id = vp.club_id
     AND t.abierta_en <= vp.fecha_hora
     AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= vp.fecha_hora
     AND (t.modalidad = 'por_dia' OR t.vendedor_id = vp.usuario_id)
   ORDER BY t.abierta_en DESC, t.id DESC
   LIMIT 1
)
WHERE vp.turno_caja_id IS NULL
  AND (vp.medio_pago = 'efectivo'
       OR vp.cuenta_id IN (SELECT id FROM cuentas WHERE es_caja_fisica = TRUE))
  AND EXISTS (
    SELECT 1 FROM turnos_caja t
     WHERE t.club_id = vp.club_id
       AND t.abierta_en <= vp.fecha_hora
       AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= vp.fecha_hora
       AND (t.modalidad = 'por_dia' OR t.vendedor_id = vp.usuario_id)
  );

-- ============================================================================
-- PASO 1d — ventas (cabecera, por consistencia con venta_pagos)
-- ============================================================================
UPDATE ventas v
SET turno_caja_id = (
  SELECT t.id
    FROM turnos_caja t
   WHERE t.club_id = v.club_id
     AND t.abierta_en <= v.fecha_hora
     AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= v.fecha_hora
     AND (t.modalidad = 'por_dia' OR t.vendedor_id = v.usuario_id)
   ORDER BY t.abierta_en DESC, t.id DESC
   LIMIT 1
)
WHERE v.turno_caja_id IS NULL
  AND (v.medio_pago = 'efectivo'
       OR v.cuenta_id IN (SELECT id FROM cuentas WHERE es_caja_fisica = TRUE))
  AND EXISTS (
    SELECT 1 FROM turnos_caja t
     WHERE t.club_id = v.club_id
       AND t.abierta_en <= v.fecha_hora
       AND COALESCE(t.cerrada_en, 'infinity'::timestamptz) >= v.fecha_hora
       AND (t.modalidad = 'por_dia' OR t.vendedor_id = v.usuario_id)
  );

-- ============================================================================
-- PASO 2 — Recalcular arqueo de las cajas CERRADAS que quedaron desactualizadas
--   Réplica EXACTA de fn_cerrar_caja (0130):
--     esperado = apertura
--              + reserva_pagos (± reembolso) + venta_pagos + clase_cobros
--              + movimientos manuales netos + otros_ingresos
--              − gastos − cuotas de gastos + transferencias netas
--   (cada fuente filtrada por turno_caja_id y cuenta es_caja_fisica).
--   Solo actualiza las cajas cuyo esperado cambia; el resto no se toca.
-- ============================================================================
UPDATE turnos_caja t
SET efectivo_esperado = r.esperado_nuevo,
    diferencia = t.efectivo_contado - r.esperado_nuevo
FROM (
  SELECT t2.id,
         t2.monto_apertura
         + COALESCE((
             SELECT SUM(CASE WHEN rp.tipo = 'reembolso' THEN -rp.monto ELSE rp.monto END)
               FROM reserva_pagos rp
              WHERE rp.turno_caja_id = t2.id
                AND rp.cuenta_id IN (SELECT id FROM cuentas
                                     WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
           ), 0)
         + COALESCE((
             SELECT SUM(vp.monto)
               FROM venta_pagos vp
              WHERE vp.turno_caja_id = t2.id
                AND vp.cuenta_id IN (SELECT id FROM cuentas
                                     WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
           ), 0)
         + COALESCE((
             SELECT SUM(cc.monto)
               FROM clase_cobros cc
              WHERE cc.turno_caja_id = t2.id
                AND cc.cuenta_id IN (SELECT id FROM cuentas
                                     WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
           ), 0)
         + COALESCE((
             SELECT SUM(CASE WHEN cm.tipo = 'ajuste_positivo' THEN cm.monto ELSE -cm.monto END)
               FROM caja_movimientos_manuales cm
              WHERE cm.turno_caja_id = t2.id
           ), 0)
         + COALESCE((
             SELECT SUM(oi.monto)
               FROM otros_ingresos oi
              WHERE oi.turno_caja_id = t2.id
                AND oi.cuenta_id IN (SELECT id FROM cuentas
                                     WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
                AND oi.activo = TRUE
           ), 0)
         - COALESCE((
             SELECT SUM(g.monto)
               FROM gastos g
              WHERE g.turno_caja_id = t2.id
                AND g.cuenta_id IN (SELECT id FROM cuentas
                                    WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
                AND g.activo = TRUE
           ), 0)
         - COALESCE((
             SELECT SUM(gc.monto)
               FROM gasto_cuotas gc
              WHERE gc.turno_caja_id = t2.id
                AND gc.cuenta_id IN (SELECT id FROM cuentas
                                     WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
           ), 0)
         + COALESCE((
             SELECT SUM(
               (CASE WHEN tr.cuenta_destino_id IN (SELECT id FROM cuentas
                          WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
                     THEN tr.monto ELSE 0 END)
               -
               (CASE WHEN tr.cuenta_origen_id IN (SELECT id FROM cuentas
                          WHERE club_id = t2.club_id AND es_caja_fisica = TRUE)
                     THEN tr.monto ELSE 0 END)
             )
               FROM transferencias tr
              WHERE tr.turno_caja_id = t2.id
           ), 0) AS esperado_nuevo
    FROM turnos_caja t2
   WHERE t2.cerrada_en IS NOT NULL
) r
WHERE t.id = r.id
  AND t.efectivo_esperado IS DISTINCT FROM r.esperado_nuevo;

-- ── Resumen (aparece en el log del SQL Editor) ─────────────────────────────
DO $$
DECLARE
  v_rp INT;
  v_cc INT;
  v_vp INT;
BEGIN
  SELECT COUNT(*) INTO v_rp FROM reserva_pagos
   WHERE medio_pago = 'efectivo' AND turno_caja_id IS NULL;
  SELECT COUNT(*) INTO v_cc FROM clase_cobros
   WHERE medio_pago = 'efectivo' AND turno_caja_id IS NULL;
  SELECT COUNT(*) INTO v_vp FROM venta_pagos
   WHERE medio_pago = 'efectivo' AND turno_caja_id IS NULL;
  RAISE NOTICE 'Backfill 0156 → cobros en efectivo que QUEDARON sin caja (históricos pre-caja): reserva_pagos=%, clase_cobros=%, venta_pagos=%.',
    v_rp, v_cc, v_vp;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- 1. Cuántos cobros en efectivo quedan sin caja (debería ser solo el histórico
--    anterior a que el club empezara a usar cajas):
--    SELECT 'reserva_pagos' AS t, COUNT(*) FROM reserva_pagos
--      WHERE medio_pago='efectivo' AND turno_caja_id IS NULL
--    UNION ALL
--    SELECT 'clase_cobros', COUNT(*) FROM clase_cobros
--      WHERE medio_pago='efectivo' AND turno_caja_id IS NULL
--    UNION ALL
--    SELECT 'venta_pagos', COUNT(*) FROM venta_pagos
--      WHERE medio_pago='efectivo' AND turno_caja_id IS NULL;
--
-- 2. Arqueos de cajas cerradas (el esperado debe incluir ahora los cobros):
--    SELECT id, fecha_jornada, efectivo_esperado, efectivo_contado, diferencia
--      FROM turnos_caja WHERE cerrada_en IS NOT NULL
--     ORDER BY cerrada_en DESC LIMIT 10;
-- ============================================================================
