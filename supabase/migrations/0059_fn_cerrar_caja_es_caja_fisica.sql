-- ============================================================================
-- 0059_tesoreria_cerrar_caja_es_caja_fisica.sql
-- Tesorería — ETAPA 2, PASO 3: generalizar el arqueo de fn_cerrar_caja del
-- literal medio_pago='efectivo' a cuentas.es_caja_fisica.
--
-- =====================================================================
-- QUÉ HACE
-- =====================================================================
-- CREATE OR REPLACE de fn_cerrar_caja con el cuerpo COMPLETO de la 0047 y un
-- ÚNICO cambio de criterio: en las fuentes que tienen columna cuenta_id
-- (agregada en 0057), el filtro «efectivo» pasa de
--     AND medio_pago = 'efectivo'
-- a
--     AND cuenta_id IN (SELECT id FROM cuentas
--                       WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
-- manteniendo SIEMPRE el AND turno_caja_id = p_turno_caja_id de cada fuente.
--
-- Fuentes afectadas (las 6 con cuenta_id): reserva_pagos, ventas, clase_cobros,
-- otros_ingresos, gastos, gasto_cuotas.
-- Fuente NO afectada: caja_movimientos_manuales — no tiene medio_pago ni
-- cuenta_id (son movimientos del cajón por naturaleza); su filtro sigue siendo
-- solo turno_caja_id. No hay literal 'efectivo' que traducir ahí.
--
-- Signatura IDÉNTICA (3 params, RETURNS turnos_caja) → cero cambio para el
-- frontend. CREATE OR REPLACE (sin DROP) conserva grants.
--
-- =====================================================================
-- POR QUÉ (cierra la regla de oro reconciliada)
-- =====================================================================
-- "Lo que está en el cajón" deja de depender del literal 'efectivo' y pasa a
-- depender de cuentas.es_caja_fisica (comportamiento, no taxonomía). Es el
-- último eslabón de la Etapa 2: 0057 ató cuenta_id a las filas, 0058 hizo que
-- las RPCs lo escriban (regla de oro generalizada en el alta), y acá el ARQUEO
-- lee por es_caja_fisica.
--
-- =====================================================================
-- EQUIVALENCIA EXACTA — bajo el INVARIANTE
-- =====================================================================
-- INVARIANTE (lo garantizan el seed 0056 + el backfill 0057 + las RPCs 0058):
--   (I) El club tiene exactamente UNA cuenta es_caja_fisica (la "Efectivo"
--       sembrada), y el medio 'efectivo' mapea a ella.
--   (II) Ningún medio NO-efectivo está mapeado a una cuenta es_caja_fisica.
--
-- Las fuentes del arqueo SIEMPRE filtran primero por turno_caja_id =
-- p_turno_caja_id. Para esas filas (las atadas a ESTA caja), bajo el
-- invariante vale la equivalencia fila-a-fila:
--     medio_pago = 'efectivo'  ⟺  cuenta_id ∈ {cuentas es_caja_fisica}
--
--   (→) Toda fila efectivo de la caja quedó con cuenta_id = la cuenta Efectivo
--       (es_caja_fisica): el backfill 0057 la seteó (medio efectivo → default
--       Efectivo) y las RPCs 0058 la setean igual. Por (I).
--   (←) Toda fila con cuenta es_caja_fisica y turno_caja_id seteado es
--       efectivo: una fila se ata a caja (turno_caja_id) SOLO cuando su cuenta
--       es es_caja_fisica (regla de oro, hoy = efectivo); y por (II) ninguna
--       cuenta es_caja_fisica se alcanza con un medio distinto de efectivo.
--
-- ⇒ El conjunto de filas sumadas es IDÉNTICO antes y después, en las 6
--   fuentes. caja_movimientos_manuales no cambia. ⇒ v_esperado idéntico.
--
-- DÓNDE DIVERGE (intencional, NO bajo el invariante):
--   Si un admin rompe (II) — mapea un medio no-efectivo a la cuenta Efectivo,
--   o marca una 2ª cuenta es_caja_fisica que recibe otro medio — entonces un
--   pago no-efectivo cuya cuenta es es_caja_fisica SÍ entra al arqueo nuevo
--   (la 0058 ya le habría atado turno_caja_id por la regla generalizada) y NO
--   entraba al viejo (medio≠'efectivo'). Esa divergencia es el comportamiento
--   GENERALIZADO buscado (esa plata entra físicamente al cajón → debe arquearse),
--   no un bug. Pero deja de ser "equivalente al literal". Por eso la equivalencia
--   se demuestra y se verifica BAJO el invariante por defecto.
--
-- Ninguna fuente traduce 'efectivo'→es_caja_fisica de un modo "sucio": las 6
-- usan exactamente el mismo reemplazo; gastos y otros_ingresos conservan su
-- AND activo = TRUE; gasto_cuotas sigue sin filtro activo (no tiene la columna).
--
-- =====================================================================
-- NO-DUPLICACIÓN (idéntica a 0047, no cambia)
-- =====================================================================
-- Un gasto pagado directo vive en `gastos` (medio/cuenta seteados, sin cuota);
-- uno en cuotas vive en `gasto_cuotas` (gastos.medio_pago y gastos.cuenta_id
-- NULL). Nunca en las dos ramas. El cambio de filtro no altera esto.
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
  v_club_id BIGINT;                         -- ⭐ NUEVO 0059 (para el subquery es_caja_fisica)
  v_turno turnos_caja;
  v_entradas_cobros DECIMAL(12,2);
  v_movimientos_neto DECIMAL(12,2);
  v_otros_ingresos_efectivo DECIMAL(12,2);
  v_gastos_efectivo DECIMAL(12,2);
  v_cuotas_efectivo DECIMAL(12,2);
  v_esperado DECIMAL(12,2);
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cerrar la caja.';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio y no puede ser negativo.';
  END IF;

  v_club_id := current_club_id();          -- ⭐ NUEVO 0059

  -- Lock para evitar cierres concurrentes (sin cambios — ahora vía v_club_id).
  SELECT * INTO v_turno
  FROM turnos_caja
  WHERE id = p_turno_caja_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada.';
  END IF;
  IF v_turno.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta caja ya está cerrada.';
  END IF;

  -- ── Entradas de cobros que entran al cajón (es_caja_fisica) ──────
  -- ⭐ 0059: medio_pago='efectivo' → cuenta_id ∈ cuentas es_caja_fisica del
  -- club. turno_caja_id se mantiene. reserva_pagos.tipo='reembolso' resta.
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'reembolso' THEN -monto ELSE monto END
  ), 0)
  INTO v_entradas_cobros
  FROM (
    SELECT monto, tipo
      FROM reserva_pagos
      WHERE turno_caja_id = p_turno_caja_id
        AND cuenta_id IN (SELECT id FROM cuentas
                          WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    UNION ALL
    SELECT monto_total AS monto, 'pago' AS tipo
      FROM ventas
      WHERE turno_caja_id = p_turno_caja_id
        AND cuenta_id IN (SELECT id FROM cuentas
                          WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    UNION ALL
    SELECT monto, 'pago' AS tipo
      FROM clase_cobros
      WHERE turno_caja_id = p_turno_caja_id
        AND cuenta_id IN (SELECT id FROM cuentas
                          WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
  ) entradas;

  -- ── Movimientos manuales (neto) ──────────────────────────────────
  -- SIN CAMBIO: caja_movimientos_manuales no tiene medio_pago ni cuenta_id
  -- (son movimientos del cajón por naturaleza). ajuste_positivo suma; el
  -- resto (retiro, pago_proveedor, ajuste_negativo) resta.
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'ajuste_positivo' THEN monto ELSE -monto END
  ), 0)
  INTO v_movimientos_neto
  FROM caja_movimientos_manuales
  WHERE turno_caja_id = p_turno_caja_id;

  -- ── Otros ingresos al cajón (SUMAN) ──────────────────────────────
  -- ⭐ 0059: filtro por es_caja_fisica. Conserva AND activo = TRUE.
  SELECT COALESCE(SUM(monto), 0)
  INTO v_otros_ingresos_efectivo
  FROM otros_ingresos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Gastos pagados directo del cajón (RESTAN) ────────────────────
  -- ⭐ 0059: filtro por es_caja_fisica. Conserva AND activo = TRUE. Los gastos
  -- a plazo / de OC nacen pendientes (cuenta_id NULL) y NO entran acá — su
  -- efectivo se descuenta por la rama de cuotas de abajo.
  SELECT COALESCE(SUM(monto), 0)
  INTO v_gastos_efectivo
  FROM gastos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Cuotas de gastos pagadas del cajón (RESTAN) ──────────────────
  -- ⭐ 0059: filtro por es_caja_fisica (idem 0047 pero por cuenta). SIN guarda
  -- activo (gasto_cuotas no tiene esa columna; ver 0047). NO duplica con
  -- v_gastos_efectivo: un gasto con cuotas tiene gastos.cuenta_id NULL.
  SELECT COALESCE(SUM(monto), 0)
  INTO v_cuotas_efectivo
  FROM gasto_cuotas
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE);

  -- ESPERADO: apertura + cobros + movimientos neto + otros_ingresos
  --           − gastos − cuotas. IDÉNTICO a 0047 (solo cambió el criterio
  --           de "qué entra al cajón": de 'efectivo' a es_caja_fisica).
  v_esperado := v_turno.monto_apertura
              + v_entradas_cobros
              + v_movimientos_neto
              + v_otros_ingresos_efectivo
              - v_gastos_efectivo
              - v_cuotas_efectivo;

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
  'Cierra una caja abierta con arqueo. Calcula esperado server-side: apertura
   + cobros que entran al cajón (con reembolsos restando) + movimientos
   manuales netos + otros_ingresos − gastos − cuotas de gastos. 0059: "qué
   entra al cajón" se determina por cuentas.es_caja_fisica (antes: literal
   medio_pago=''efectivo''); bajo el invariante (efectivo ⟺ única cuenta
   es_caja_fisica) el resultado es idéntico. caja_movimientos_manuales no
   cambia (sin medio/cuenta). Guarda diferencia = contado − esperado. Gate:
   admin O vendedor. Lock FOR UPDATE.';

COMMIT;

-- ============================================================================
-- Fin de la migración 0059_fn_cerrar_caja_es_caja_fisica.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- A. Signatura intacta (3 params, RETURNS turnos_caja):
--    SELECT pg_get_function_arguments(oid), pg_get_function_result(oid)
--    FROM pg_proc WHERE proname = 'fn_cerrar_caja';
--
-- B. Equivalencia sobre una caja REAL (la query de abajo, en el mensaje):
--    para un turno_caja_id dado, compara el esperado viejo (medio='efectivo')
--    vs el nuevo (es_caja_fisica). diff debe ser 0 en cada fuente y en el total.
--
-- C. Cierre real cuadra: cerrar una caja con cobros/gastos/cuotas en efectivo
--    y verificar que diferencia = 0 (igual que con la 0047).
--
-- D. Invariante: SELECT id, nombre, es_caja_fisica FROM cuentas WHERE club_id=X;
--    → exactamente una es_caja_fisica=TRUE. Y SELECT * FROM medio_cuenta_default
--    WHERE club_id=X; → ningún medio ≠ 'efectivo' apunta a esa cuenta.
-- ============================================================================
