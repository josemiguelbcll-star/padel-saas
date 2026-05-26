-- ============================================================================
-- 0061_fn_flujo_caja.sql
-- Tesorería — ETAPA 3 (Flujo de Caja), PASO 1: el motor de datos del flujo REAL.
--
-- =====================================================================
-- QUÉ HACE
-- =====================================================================
-- fn_flujo_caja(p_desde, p_hasta, p_granularidad, p_cuenta_id) — RPC de SOLO
-- LECTURA (SECURITY INVOKER) que devuelve, por período, el flujo de caja
-- PERCIBIDO derivado del libro mayor v_movimientos_cuenta (0057+0060):
--   (periodo, ingresos, egresos, neto, saldo_apertura, saldo_cierre)
--
-- p_granularidad ∈ ('day','week','month'); semana ISO (lunes), por date_trunc.
-- p_cuenta_id NULL = AGREGADO de todas las cuentas del club (en el agregado las
--   transferencias internas se anulan solas: pata origen − + pata destino +).
--   Con un id = flujo de ESA cuenta (ahí las transferencias sí se ven).
--
-- =====================================================================
-- SALDO DE APERTURA = FUENTE ÚNICA (coincide con v_cuentas_saldo)
-- =====================================================================
-- saldo_apertura del primer período = Σ cuentas.saldo_inicial
--   + Σ (signo·monto) de v_movimientos_cuenta con día_local < inicio_ventana.
-- Es la MISMA fórmula que v_cuentas_saldo (saldo_inicial + Σ ledger), cortada
-- a la fecha. saldo_cierre por período = apertura + running SUM(neto). El
-- saldo_cierre del último período == el saldo total de v_cuentas_saldo a esa
-- fecha (prueba de cuadre — ver al pie).
--
-- =====================================================================
-- ZONA HORARIA DEL BUCKETING (decisión)
-- =====================================================================
-- v_movimientos_cuenta.fecha mezcla instantes (fecha_hora de cobros/ventas/
-- caja_manual) y fechas de calendario (gasto/otro_ingreso/cuota/transferencia,
-- DATE casteada a medianoche). Para agrupar por DÍA CALENDARIO ARGENTINO sin
-- correr los cobros nocturnos al día siguiente (UTC), el "día local" se deriva
-- por origen: los instantes con AT TIME ZONE 'America/Argentina/Buenos_Aires';
-- las fechas-calendario tal cual (::date). TZ AR fija en v1 (puede volverse
-- setting por club después).
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- Solo el flujo REAL (percibido). El flujo PROYECTADO (compromisos futuros:
-- cuotas por vencer, recurrentes, proyección de alquileres) se arma en el
-- frontend y se superpone (siguiente etapa). NO toca ninguna tabla ni otra
-- función — es lectura pura sobre el ledger ya derivado.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_flujo_caja(
  p_desde DATE,
  p_hasta DATE,
  p_granularidad TEXT,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
  periodo DATE,
  ingresos NUMERIC,
  egresos NUMERIC,
  neto NUMERIC,
  saldo_apertura NUMERIC,
  saldo_cierre NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_tz CONSTANT TEXT := 'America/Argentina/Buenos_Aires';
  v_step INTERVAL;
  v_desde_efectivo DATE;     -- inicio del primer período (alineado a date_trunc)
  v_hasta_excl DATE;         -- inicio del período SIGUIENTE al último (cota sup. excl.)
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'Indicá el rango de fechas (desde y hasta).';
  END IF;
  IF p_hasta < p_desde THEN
    RAISE EXCEPTION 'La fecha "hasta" no puede ser anterior a "desde".';
  END IF;
  IF p_granularidad IS NULL OR p_granularidad NOT IN ('day','week','month') THEN
    RAISE EXCEPTION 'Granularidad inválida (esperado: day, week o month).';
  END IF;

  v_step := CASE p_granularidad
    WHEN 'day'   THEN INTERVAL '1 day'
    WHEN 'week'  THEN INTERVAL '1 week'
    WHEN 'month' THEN INTERVAL '1 month'
  END;

  -- Alineación a períodos naturales (date_trunc: semana = lunes ISO).
  v_desde_efectivo := date_trunc(p_granularidad, p_desde::timestamp)::date;
  v_hasta_excl     := (date_trunc(p_granularidad, p_hasta::timestamp) + v_step)::date;

  RETURN QUERY
  WITH mov AS (
    -- Día local AR por origen (ver header). signo/monto del ledger.
    SELECT
      CASE
        WHEN m.origen IN ('reserva_pago','clase_cobro','venta','caja_manual')
          THEN (m.fecha AT TIME ZONE v_tz)::date
        ELSE m.fecha::date
      END                                   AS dia,
      m.signo,
      m.monto
    FROM v_movimientos_cuenta m
    WHERE m.club_id = v_club_id
      AND (p_cuenta_id IS NULL OR m.cuenta_id = p_cuenta_id)
  ),
  apertura AS (
    -- saldo_inicial de las cuentas en alcance + Σ movimientos ANTERIORES a la
    -- ventana. = v_cuentas_saldo cortado a v_desde_efectivo.
    SELECT
      (SELECT COALESCE(SUM(c.saldo_inicial), 0)
         FROM cuentas c
        WHERE c.club_id = v_club_id
          AND (p_cuenta_id IS NULL OR c.id = p_cuenta_id))
      + COALESCE(SUM(CASE WHEN mov.dia < v_desde_efectivo
                          THEN mov.signo * mov.monto ELSE 0 END), 0) AS saldo0
    FROM mov
  ),
  bucket AS (
    -- Ingresos/egresos por período (solo lo que cae DENTRO de la ventana).
    SELECT
      date_trunc(p_granularidad, mov.dia::timestamp)::date AS periodo,
      SUM(CASE WHEN mov.signo =  1 THEN mov.monto ELSE 0 END) AS ingresos,
      SUM(CASE WHEN mov.signo = -1 THEN mov.monto ELSE 0 END) AS egresos
    FROM mov
    WHERE mov.dia >= v_desde_efectivo
      AND mov.dia <  v_hasta_excl
    GROUP BY 1
  ),
  serie AS (
    -- Todos los períodos del rango, aunque no tengan movimientos (curva continua).
    SELECT gs::date AS periodo
    FROM generate_series(
      v_desde_efectivo::timestamp,
      date_trunc(p_granularidad, p_hasta::timestamp),
      v_step
    ) gs
  ),
  combinado AS (
    SELECT
      s.periodo,
      COALESCE(b.ingresos, 0) AS ingresos,
      COALESCE(b.egresos, 0)  AS egresos,
      COALESCE(b.ingresos, 0) - COALESCE(b.egresos, 0) AS neto
    FROM serie s
    LEFT JOIN bucket b ON b.periodo = s.periodo
  )
  SELECT
    c.periodo,
    c.ingresos,
    c.egresos,
    c.neto,
    -- apertura del período = saldo0 + Σ netos de los períodos ANTERIORES.
    (a.saldo0 + COALESCE(
        SUM(c.neto) OVER (ORDER BY c.periodo ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),
      0))                                                          AS saldo_apertura,
    -- cierre del período = saldo0 + Σ netos HASTA este período (running).
    (a.saldo0 +
        SUM(c.neto) OVER (ORDER BY c.periodo ROWS UNBOUNDED PRECEDING)) AS saldo_cierre
  FROM combinado c
  CROSS JOIN apertura a
  ORDER BY c.periodo;
END;
$$;

COMMENT ON FUNCTION fn_flujo_caja(DATE, DATE, TEXT, BIGINT) IS
  'Flujo de caja PERCIBIDO por período (day/week/month, semana ISO) derivado de
   v_movimientos_cuenta. Devuelve (periodo, ingresos, egresos, neto,
   saldo_apertura, saldo_cierre). saldo_apertura del 1er período = saldo_inicial
   de las cuentas + Σ movimientos previos (= v_cuentas_saldo a esa fecha, fuente
   única). p_cuenta_id NULL = agregado del club (transferencias internas se
   anulan); con id = esa cuenta. Día local AR por origen (cobros nocturnos no se
   corren de día). SECURITY INVOKER → RLS por club. Solo lectura.';

GRANT EXECUTE ON FUNCTION fn_flujo_caja(DATE, DATE, TEXT, BIGINT) TO authenticated;

COMMIT;

-- ============================================================================
-- Fin de la migración 0061_fn_flujo_caja.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- A. Firma:
--    SELECT pg_get_function_arguments(oid), pg_get_function_result(oid)
--    FROM pg_proc WHERE proname = 'fn_flujo_caja';
--
-- B. ⭐ PRUEBA DE CUADRE (la clave): el saldo_cierre del ÚLTIMO período == el
--    saldo total de v_cuentas_saldo a esa fecha (el saldo ya conocido). Ver
--    query completa en el mensaje. diff debe ser 0.
--
-- C. Continuidad: en cada fila, saldo_cierre = saldo_apertura + neto; y el
--    saldo_cierre de un período == saldo_apertura del siguiente.
--    SELECT periodo, neto, saldo_apertura, saldo_cierre,
--           saldo_apertura + neto AS chk
--    FROM fn_flujo_caja('2026-01-01','2026-12-31','month');  -- chk == saldo_cierre
--
-- D. Agregado vs por-cuenta: el agregado (p_cuenta_id NULL) NO debe mostrar las
--    transferencias internas (se anulan); por-cuenta sí.
--    Σ saldo_cierre_ultimo de cada cuenta == saldo_cierre_ultimo del agregado.
-- ============================================================================
