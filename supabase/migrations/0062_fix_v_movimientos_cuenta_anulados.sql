-- ============================================================================
-- 0062_fix_v_movimientos_cuenta_anulados.sql
-- FIX de integridad: v_movimientos_cuenta contaba gastos / otros_ingresos
-- ANULADOS (activo=FALSE) en el saldo de la cuenta y en el flujo de caja.
--
-- =====================================================================
-- EL BUG
-- =====================================================================
-- v_movimientos_cuenta (0057→0060) filtra cada rama por cuenta_id IS NOT NULL,
-- pero las ramas `gastos` y `otros_ingresos` NO excluyen las filas con
-- activo=FALSE. Un gasto anulado vía fn_anular_gasto (0048) queda con
-- activo=FALSE pero conserva su cuenta_id → seguía pesando en v_cuentas_saldo
-- y en fn_flujo_caja. Confirmado: gasto id 4 (activo=false, cuenta_id=3) seguía
-- restando del saldo.
--
-- El EERR (useResumenFinanciero) y fn_cerrar_caja YA filtran activo=TRUE; la
-- vista quedó desalineada.
--
-- =====================================================================
-- EL FIX (quirúrgico, por patrón de cada rama)
-- =====================================================================
-- CREATE OR REPLACE de la vista con el cuerpo IDÉNTICO a 0060, agregando
-- AND activo = TRUE SOLO en las dos ramas que tienen ese flag y lo ignoraban:
--   - gastos          → AND g.activo = TRUE
--   - otros_ingresos  → AND oi.activo = TRUE
--
-- Las otras 6 ramas quedan IDÉNTICAS — cada una maneja su anulación por su
-- propio patrón, NO por un flag activo:
--   - reserva_pagos  → la anulación es un REEMBOLSO (tipo='reembolso', signo −),
--                      ya contemplado en la vista (no se desactiva el original).
--   - gasto_cuotas   → la reversión de un pago NULEA cuenta_id (Casos 1/2 de
--                      fn_anular_pago_cuota) → ya sale por cuenta_id IS NOT NULL;
--                      el Caso 3 lo conserva A PROPÓSITO (el −monto firme lo
--                      compensa el ajuste_positivo). gasto_cuotas NO tiene activo.
--   - clase_cobros, ventas → sin flag de anulación hoy (no construida); nada
--                      que excluir. (Latente: al construir la anulación de venta
--                      habrá que revisar su rama.)
--   - caja_movimientos_manuales, transferencias → INMUTABLES (corregir = asiento
--                      compensatorio); no se anulan.
--
-- Mismo contrato de columnas (cuenta_id, club_id, fecha, origen, ref_id, signo,
-- monto) → CREATE OR REPLACE válido; v_cuentas_saldo (que la consume) no se toca.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW v_movimientos_cuenta
WITH (security_invoker = true) AS

  -- Cobros de reservas (seña/pago/reembolso). reembolso resta. (IDÉNTICO 0060)
  SELECT
    rp.cuenta_id,
    rp.club_id,
    rp.fecha_hora                                            AS fecha,
    'reserva_pago'::text                                     AS origen,
    rp.id                                                    AS ref_id,
    (CASE WHEN rp.tipo = 'reembolso' THEN -1 ELSE 1 END)::smallint AS signo,
    rp.monto                                                 AS monto
  FROM reserva_pagos rp
  WHERE rp.cuenta_id IS NOT NULL

  UNION ALL

  -- Cobros de clases. Siempre ingreso. (IDÉNTICO 0060)
  SELECT
    cc.cuenta_id, cc.club_id, cc.fecha_hora, 'clase_cobro', cc.id,
    1::smallint, cc.monto
  FROM clase_cobros cc
  WHERE cc.cuenta_id IS NOT NULL

  UNION ALL

  -- Ventas de buffet. Siempre ingreso. (IDÉNTICO 0060)
  SELECT
    v.cuenta_id, v.club_id, v.fecha_hora, 'venta', v.id,
    1::smallint, v.monto_total
  FROM ventas v
  WHERE v.cuenta_id IS NOT NULL

  UNION ALL

  -- Gastos pagados DIRECTO. Egreso. fecha = fecha_pago.
  -- ⭐ FIX 0062: excluir gastos ANULADOS (activo=FALSE).
  SELECT
    g.cuenta_id, g.club_id, g.fecha_pago::timestamptz, 'gasto', g.id,
    (-1)::smallint, g.monto
  FROM gastos g
  WHERE g.cuenta_id IS NOT NULL
    AND g.activo = TRUE

  UNION ALL

  -- Otros ingresos cobrados. Ingreso. fecha = fecha_cobro.
  -- ⭐ FIX 0062: excluir otros_ingresos ANULADOS (activo=FALSE).
  SELECT
    oi.cuenta_id, oi.club_id, oi.fecha_cobro::timestamptz, 'otro_ingreso', oi.id,
    1::smallint, oi.monto
  FROM otros_ingresos oi
  WHERE oi.cuenta_id IS NOT NULL
    AND oi.activo = TRUE

  UNION ALL

  -- Cuotas pagadas de cuentas por pagar. Egreso. fecha = fecha_pago. (IDÉNTICO 0060)
  SELECT
    gc.cuenta_id, gc.club_id, gc.fecha_pago::timestamptz, 'gasto_cuota', gc.id,
    (-1)::smallint, gc.monto
  FROM gasto_cuotas gc
  WHERE gc.cuenta_id IS NOT NULL

  UNION ALL

  -- Movimientos manuales de caja (efectivo → cuenta efectivo del club). (IDÉNTICO 0060)
  SELECT
    mcd.cuenta_id, cm.club_id, cm.fecha_hora, 'caja_manual', cm.id,
    (CASE WHEN cm.tipo = 'ajuste_positivo' THEN 1 ELSE -1 END)::smallint,
    cm.monto
  FROM caja_movimientos_manuales cm
  JOIN medio_cuenta_default mcd
    ON mcd.club_id = cm.club_id
   AND mcd.medio_pago = 'efectivo'

  UNION ALL

  -- Transferencia: pata ORIGEN (egreso de la cuenta origen). (IDÉNTICO 0060)
  SELECT
    tr.cuenta_origen_id, tr.club_id, tr.fecha::timestamptz, 'transferencia_origen', tr.id,
    (-1)::smallint, tr.monto
  FROM transferencias tr

  UNION ALL

  -- Transferencia: pata DESTINO (ingreso a la cuenta destino). (IDÉNTICO 0060)
  SELECT
    tr.cuenta_destino_id, tr.club_id, tr.fecha::timestamptz, 'transferencia_destino', tr.id,
    1::smallint, tr.monto
  FROM transferencias tr;

COMMENT ON VIEW v_movimientos_cuenta IS
  'Libro mayor derivado de tesorería: UNION de las 6 tablas de plata (cuenta_id
   NOT NULL) + caja_movimientos_manuales (→ cuenta efectivo) + transferencias
   (0060, dos patas). 0062: las ramas gastos y otros_ingresos excluyen activo=
   FALSE (anulados). reserva_pagos anula por reembolso (signo −); gasto_cuotas
   por nuleo de cuenta_id; caja_manual y transferencias son inmutables.
   Normalizado a (cuenta_id, club_id, fecha, origen, ref_id, signo, monto).
   signo*monto = aporte al saldo. security_invoker=true.';

GRANT SELECT ON v_movimientos_cuenta TO authenticated;

COMMIT;

-- ============================================================================
-- Fin de la migración 0062_fix_v_movimientos_cuenta_anulados.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE (ver query en el mensaje)
-- ============================================================================
-- (a) El gasto anulado id 4 (activo=false) YA NO aparece en v_movimientos_cuenta.
-- (b) Σ v_cuentas_saldo sube exactamente +6.000.000 (el gasto dejó de restar).
-- (c) El cuadre de fn_flujo_caja sigue dando 0 (último saldo_cierre == Σ saldo).
-- ============================================================================
