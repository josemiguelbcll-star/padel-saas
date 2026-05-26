-- ============================================================================
-- 0057_tesoreria_cuenta_id_backfill.sql
-- Tesorería — ETAPA 2, PASO 1 (aditivo y de bajo riesgo): atar las filas de
-- plata existentes a una cuenta + libro mayor derivado + saldo vivo.
--
-- =====================================================================
-- ALCANCE (lo que SÍ y lo que NO)
-- =====================================================================
-- ESTA migración SOLO hace lo aditivo/derivado (no toca dinero en vivo):
--   1. ADD COLUMN cuenta_id (NULL) en las 6 tablas de plata + índices
--      parciales + FK a cuentas(id).
--   2. BACKFILL: cuenta_id = medio_cuenta_default[club, medio_pago] para las
--      filas que YA tienen medio_pago. Efectivo siempre resuelve (seed 0056);
--      un medio sin default deja cuenta_id NULL (NUNCA inventa una cuenta).
--   3. CREATE VIEW v_movimientos_cuenta — libro mayor derivado (UNION ALL de
--      las 6 tablas + caja_movimientos_manuales), normalizado.
--   4. CREATE OR REPLACE v_cuentas_saldo — saldo = saldo_inicial + Σ
--      movimientos. Mismo contrato de columnas que 0056 (el frontend no
--      cambia).
--
-- NO TOCA (clave — eso es de pasos siguientes, en sesión dedicada):
--   - Las ~9 RPCs de cobro/pago (no reciben p_cuenta_id todavía).
--   - Los 3 CHECKs *_efectivo_requiere_caja (siguen con el literal 'efectivo').
--   - fn_cerrar_caja (sigue arqueando por medio_pago='efectivo').
--   - El enum de medios de pago (queda FIJO).
--   - caja_movimientos_manuales (NO recibe cuenta_id; en el libro mayor se
--     resuelve a la cuenta efectivo del club, igual que los cobros efectivo).
--
-- =====================================================================
-- POR QUÉ ES SEGURO
-- =====================================================================
-- - ADD COLUMN ... NULL es instantáneo (sin reescritura de tabla, PG11+).
-- - El backfill solo ESCRIBE cuenta_id (una columna nueva); no toca monto,
--   medio_pago, fecha ni nada que ya use el sistema.
-- - El libro mayor filtra WHERE cuenta_id IS NOT NULL en las 6 ramas → un
--   gasto pagado en cuotas (gastos.medio_pago NULL → cuenta_id NULL) NO entra
--   por la rama gastos, solo por gasto_cuotas: doble conteo imposible.
-- - Las vistas son security_invoker=true → respetan la RLS por club de las
--   tablas subyacentes.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ADD COLUMN cuenta_id + índice parcial, en las 6 tablas de plata.
--    NULL: una fila sin medio_pago (pendiente) o con medio sin default queda
--    sin cuenta. ON DELETE RESTRICT: una cuenta con movimientos no se borra
--    (coherente con cuentas: sin DELETE, solo activa=false).
-- ============================================================================

ALTER TABLE reserva_pagos  ADD COLUMN cuenta_id BIGINT REFERENCES cuentas(id) ON DELETE RESTRICT;
ALTER TABLE clase_cobros   ADD COLUMN cuenta_id BIGINT REFERENCES cuentas(id) ON DELETE RESTRICT;
ALTER TABLE ventas         ADD COLUMN cuenta_id BIGINT REFERENCES cuentas(id) ON DELETE RESTRICT;
ALTER TABLE gastos         ADD COLUMN cuenta_id BIGINT REFERENCES cuentas(id) ON DELETE RESTRICT;
ALTER TABLE otros_ingresos ADD COLUMN cuenta_id BIGINT REFERENCES cuentas(id) ON DELETE RESTRICT;
ALTER TABLE gasto_cuotas   ADD COLUMN cuenta_id BIGINT REFERENCES cuentas(id) ON DELETE RESTRICT;

CREATE INDEX idx_reserva_pagos_cuenta  ON reserva_pagos  (cuenta_id) WHERE cuenta_id IS NOT NULL;
CREATE INDEX idx_clase_cobros_cuenta   ON clase_cobros   (cuenta_id) WHERE cuenta_id IS NOT NULL;
CREATE INDEX idx_ventas_cuenta         ON ventas         (cuenta_id) WHERE cuenta_id IS NOT NULL;
CREATE INDEX idx_gastos_cuenta         ON gastos         (cuenta_id) WHERE cuenta_id IS NOT NULL;
CREATE INDEX idx_otros_ingresos_cuenta ON otros_ingresos (cuenta_id) WHERE cuenta_id IS NOT NULL;
CREATE INDEX idx_gasto_cuotas_cuenta   ON gasto_cuotas   (cuenta_id) WHERE cuenta_id IS NOT NULL;

COMMENT ON COLUMN reserva_pagos.cuenta_id IS
  'Tesorería: cuenta donde cayó el dinero (resuelta del medio por defecto, o
   elegida al cobrar en pasos siguientes). NULL = medio sin cuenta mapeada.';
COMMENT ON COLUMN gastos.cuenta_id IS
  'Tesorería: cuenta de la que salió el pago. NULL mientras está pendiente o
   si se paga en cuotas (el movimiento vive en gasto_cuotas.cuenta_id).';

-- ============================================================================
-- 2. BACKFILL — cuenta_id = medio_cuenta_default[club, medio_pago].
--    Solo filas con medio_pago NOT NULL. El JOIN a medio_cuenta_default deja
--    NULL cualquier medio sin default (NUNCA inventa cuenta). Efectivo siempre
--    matchea (seed 0056 garantiza la fila efectivo→Efectivo es_caja_fisica).
--    El AND cuenta_id IS NULL lo hace re-ejecutable sin pisar.
-- ============================================================================

UPDATE reserva_pagos t
   SET cuenta_id = mcd.cuenta_id
  FROM medio_cuenta_default mcd
 WHERE mcd.club_id = t.club_id
   AND mcd.medio_pago = t.medio_pago
   AND t.medio_pago IS NOT NULL
   AND t.cuenta_id IS NULL;

UPDATE clase_cobros t
   SET cuenta_id = mcd.cuenta_id
  FROM medio_cuenta_default mcd
 WHERE mcd.club_id = t.club_id
   AND mcd.medio_pago = t.medio_pago
   AND t.medio_pago IS NOT NULL
   AND t.cuenta_id IS NULL;

UPDATE ventas t
   SET cuenta_id = mcd.cuenta_id
  FROM medio_cuenta_default mcd
 WHERE mcd.club_id = t.club_id
   AND mcd.medio_pago = t.medio_pago
   AND t.medio_pago IS NOT NULL
   AND t.cuenta_id IS NULL;

UPDATE gastos t
   SET cuenta_id = mcd.cuenta_id
  FROM medio_cuenta_default mcd
 WHERE mcd.club_id = t.club_id
   AND mcd.medio_pago = t.medio_pago
   AND t.medio_pago IS NOT NULL
   AND t.cuenta_id IS NULL;

UPDATE otros_ingresos t
   SET cuenta_id = mcd.cuenta_id
  FROM medio_cuenta_default mcd
 WHERE mcd.club_id = t.club_id
   AND mcd.medio_pago = t.medio_pago
   AND t.medio_pago IS NOT NULL
   AND t.cuenta_id IS NULL;

UPDATE gasto_cuotas t
   SET cuenta_id = mcd.cuenta_id
  FROM medio_cuenta_default mcd
 WHERE mcd.club_id = t.club_id
   AND mcd.medio_pago = t.medio_pago
   AND t.medio_pago IS NOT NULL
   AND t.cuenta_id IS NULL;

-- ============================================================================
-- 3. VIEW v_movimientos_cuenta — libro mayor derivado.
--    Normaliza las 7 fuentes a (cuenta_id, club_id, fecha, origen, ref_id,
--    signo, monto). signo: +1 ingreso / -1 egreso; monto siempre positivo
--    (el saldo se calcula con signo*monto). WHERE cuenta_id IS NOT NULL en las
--    6 tablas → solo movimientos con cuenta resuelta (ver header).
--    security_invoker=true → RLS por club de cada tabla subyacente.
-- ============================================================================
CREATE VIEW v_movimientos_cuenta
WITH (security_invoker = true) AS

  -- Cobros de reservas (seña/pago/reembolso). reembolso resta.
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

  -- Cobros de clases (alquiler de cancha al profe). Siempre ingreso.
  SELECT
    cc.cuenta_id, cc.club_id, cc.fecha_hora, 'clase_cobro', cc.id,
    1::smallint, cc.monto
  FROM clase_cobros cc
  WHERE cc.cuenta_id IS NOT NULL

  UNION ALL

  -- Ventas de buffet. Siempre ingreso.
  SELECT
    v.cuenta_id, v.club_id, v.fecha_hora, 'venta', v.id,
    1::smallint, v.monto_total
  FROM ventas v
  WHERE v.cuenta_id IS NOT NULL

  UNION ALL

  -- Gastos pagados DIRECTO (los pagados en cuotas tienen cuenta_id NULL acá
  -- y entran por gasto_cuotas). Egreso. fecha = fecha_pago.
  SELECT
    g.cuenta_id, g.club_id, g.fecha_pago::timestamptz, 'gasto', g.id,
    (-1)::smallint, g.monto
  FROM gastos g
  WHERE g.cuenta_id IS NOT NULL

  UNION ALL

  -- Otros ingresos cobrados. Ingreso. fecha = fecha_cobro.
  SELECT
    oi.cuenta_id, oi.club_id, oi.fecha_cobro::timestamptz, 'otro_ingreso', oi.id,
    1::smallint, oi.monto
  FROM otros_ingresos oi
  WHERE oi.cuenta_id IS NOT NULL

  UNION ALL

  -- Cuotas pagadas de cuentas por pagar. Egreso. fecha = fecha_pago.
  SELECT
    gc.cuenta_id, gc.club_id, gc.fecha_pago::timestamptz, 'gasto_cuota', gc.id,
    (-1)::smallint, gc.monto
  FROM gasto_cuotas gc
  WHERE gc.cuenta_id IS NOT NULL

  UNION ALL

  -- Movimientos manuales de caja (retiros/pagos/ajustes): siempre EFECTIVO,
  -- caen en la cuenta efectivo del club (mismo mapeo que los cobros efectivo).
  -- ajuste_positivo suma; retiro/pago_proveedor/ajuste_negativo restan.
  SELECT
    mcd.cuenta_id, cm.club_id, cm.fecha_hora, 'caja_manual', cm.id,
    (CASE WHEN cm.tipo = 'ajuste_positivo' THEN 1 ELSE -1 END)::smallint,
    cm.monto
  FROM caja_movimientos_manuales cm
  JOIN medio_cuenta_default mcd
    ON mcd.club_id = cm.club_id
   AND mcd.medio_pago = 'efectivo';

COMMENT ON VIEW v_movimientos_cuenta IS
  'Libro mayor derivado de tesorería: UNION de las 6 tablas de plata (filtradas
   a cuenta_id NOT NULL) + caja_movimientos_manuales (resueltos a la cuenta
   efectivo). Normalizado a (cuenta_id, club_id, fecha, origen, ref_id, signo,
   monto). signo*monto = aporte al saldo. security_invoker=true.';

GRANT SELECT ON v_movimientos_cuenta TO authenticated;

-- ============================================================================
-- 4. SWAP del cuerpo de v_cuentas_saldo: saldo = saldo_inicial + Σ movimientos.
--    CREATE OR REPLACE conserva grants/owner y mantiene el MISMO contrato de
--    columnas (c.* + saldo numeric(12,2)) → el frontend de Etapa 1 no cambia.
-- ============================================================================
CREATE OR REPLACE VIEW v_cuentas_saldo
WITH (security_invoker = true) AS
SELECT
  c.*,
  (c.saldo_inicial + COALESCE(m.delta, 0))::numeric(12,2) AS saldo
FROM cuentas c
LEFT JOIN (
  SELECT cuenta_id, SUM(signo * monto) AS delta
  FROM v_movimientos_cuenta
  GROUP BY cuenta_id
) m ON m.cuenta_id = c.id;

COMMENT ON VIEW v_cuentas_saldo IS
  'Saldo por cuenta = saldo_inicial + Σ(signo*monto) de v_movimientos_cuenta.
   security_invoker=true → respeta la RLS de cuentas por club.';

COMMIT;

-- ============================================================================
-- Fin de la migración 0057_tesoreria_cuenta_id_backfill.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- A. Columna agregada en las 6 tablas:
--    SELECT table_name FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='cuenta_id'
--      AND table_name IN ('reserva_pagos','clase_cobros','ventas',
--                         'gastos','otros_ingresos','gasto_cuotas');
--    → 6 filas.
--
-- B. ⭐ PRUEBA DE QUE EL MODELO CUADRA CON LA REALIDAD (efectivo):
--    Para cada tabla, el total de filas EFECTIVO por el literal histórico
--    (medio_pago='efectivo') debe coincidir EXACTO con el total por la cuenta
--    efectivo (cuenta_id = medio_cuenta_default['efectivo']). filas_descuadradas
--    debe ser 0 en TODAS las tablas. (Ver query completa abajo, fuera del
--    archivo, en el mensaje.)
--
-- C. Libro mayor y saldo:
--    SELECT origen, count(*), sum(signo*monto) FROM v_movimientos_cuenta
--    GROUP BY origen;
--    SELECT nombre, saldo_inicial, saldo FROM v_cuentas_saldo ORDER BY orden;
--
-- D. Aislamiento multi-tenant: un usuario de OTRO club no ve estos movimientos
--    ni saldos (security_invoker respeta la RLS de las tablas base).
--
-- E. NADA roto en vivo: cobros, ventas, gastos, cierre de caja siguen igual
--    (esta migración no tocó RPCs, CHECKs ni fn_cerrar_caja).
-- ============================================================================
