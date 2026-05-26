-- ============================================================================
-- 0060_tesoreria_transferencias.sql
-- Tesorería — ETAPA 2, PASO 4: transferencias entre cuentas.
--
-- =====================================================================
-- QUÉ HACE (en este orden, una sola transacción)
-- =====================================================================
--   1. CREATE TABLE transferencias (dos patas: cuenta_origen → cuenta_destino)
--      + RLS + GRANTs + índices.
--   2. CREATE FUNCTION fn_transferir — valida, aplica el gate fino y la
--      "bisagra con caja" (si una pata es es_caja_fisica, ata turno_caja_id),
--      inserta la transferencia.
--   3. CREATE OR REPLACE VIEW v_movimientos_cuenta (0057) — +2 patas:
--      origen (signo −) y destino (signo +). Mismas columnas → el contrato de
--      v_cuentas_saldo (que la consume) no cambia.
--   4. CREATE OR REPLACE FUNCTION fn_cerrar_caja (0059) — +1 fuente: las
--      transferencias atadas a la caja que mueven efectivo del cajón.
--
-- =====================================================================
-- EL MODELO
-- =====================================================================
-- Una transferencia mueve plata de una cuenta a otra (depositar la recaudación
-- del cajón al banco, traer cambio, mover banco↔billetera). MEDIO no aplica
-- (no es un cobro ni un pago a terceros): es un movimiento INTERNO entre
-- cuentas del club. Por eso no tiene medio_pago; tiene dos cuentas.
--
-- BISAGRA CON EL ARQUEO (es_caja_fisica):
--   - origen es_caja_fisica  → sale efectivo del cajón  → arqueo −monto.
--   - destino es_caja_fisica → entra efectivo al cajón  → arqueo +monto.
--   - ninguna es_caja_fisica → no toca el cajón → turno_caja_id NULL, sin caja.
--   - ambas es_caja_fisica   → +monto −monto = 0 (solo posible con 2+ cuentas
--     es_caja_fisica; bajo el invariante de una sola, inalcanzable: origen≠destino).
--
-- GATE FINO (igual criterio que anulaciones 0048: la RLS permite la unión,
-- el cuerpo aplica el gate fino):
--   - toca el cajón (alguna pata es_caja_fisica) → operativo → admin O vendedor.
--   - puramente digital (ninguna pata es_caja_fisica) → tesorería → admin only.
--
-- NO valida saldo suficiente en la cuenta origen (coherente con el resto del
-- sistema, que no pre-chequea saldos; el saldo es derivado). GUARDA FUTURA
-- OPCIONAL: rechazar si la cuenta origen no tiene saldo suficiente.
--
-- Inmutable (sin UPDATE/DELETE): corregir = transferencia compensatoria
-- (mismo criterio Filosofía B que ventas/gastos/movimientos de caja).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: transferencias
-- ============================================================================
CREATE TABLE transferencias (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  -- Las dos patas. ON DELETE RESTRICT: una cuenta con transferencias no se
  -- borra (coherente con cuentas: sin DELETE, solo activa=false).
  cuenta_origen_id  BIGINT NOT NULL REFERENCES cuentas(id) ON DELETE RESTRICT,
  cuenta_destino_id BIGINT NOT NULL REFERENCES cuentas(id) ON DELETE RESTRICT,

  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  fecha DATE NOT NULL,                       -- fecha del movimiento (libro mayor)

  concepto VARCHAR(200),                     -- "Depósito recaudación", "Cambio al cajón"
  observaciones TEXT,

  -- Se setea SOLO si una pata es es_caja_fisica (mueve efectivo del cajón) →
  -- el arqueo de ESA caja la considera. NULL si ninguna pata toca el cajón.
  turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT,

  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT transferencias_origen_distinto_destino
    CHECK (cuenta_origen_id <> cuenta_destino_id)
);

CREATE INDEX idx_transferencias_club_fecha ON transferencias (club_id, fecha);
CREATE INDEX idx_transferencias_origen     ON transferencias (cuenta_origen_id);
CREATE INDEX idx_transferencias_destino    ON transferencias (cuenta_destino_id);
CREATE INDEX idx_transferencias_turno_caja ON transferencias (turno_caja_id)
  WHERE turno_caja_id IS NOT NULL;

COMMENT ON TABLE transferencias IS
  'Movimientos internos de plata entre dos cuentas del club (no es cobro ni
   pago a terceros → sin medio_pago). turno_caja_id se setea solo si una pata
   es es_caja_fisica (mueve efectivo del cajón → entra al arqueo). Inmutable:
   corregir = transferencia compensatoria (Filosofía B).';

COMMENT ON COLUMN transferencias.turno_caja_id IS
  'Caja del día atada cuando origen o destino es es_caja_fisica (el efectivo
   sale/entra del cajón). NULL si la transferencia es puramente digital.';

-- ── RLS: SELECT club; INSERT admin O vendedor (gate fino en la RPC). Sin
--    UPDATE/DELETE → inmutable. ──────────────────────────────────────────────
ALTER TABLE transferencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transferencias_select_propio_club"
ON transferencias FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "transferencias_insert_admin_o_vendedor"
ON transferencias FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- Sin policies UPDATE/DELETE → fail-closed (inmutable).

GRANT SELECT, INSERT ON transferencias TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE transferencias_id_seq TO authenticated;


-- ============================================================================
-- 2. fn_transferir
-- ============================================================================
CREATE FUNCTION fn_transferir(
  p_cuenta_origen BIGINT,
  p_cuenta_destino BIGINT,
  p_monto DECIMAL,
  p_fecha DATE,
  p_concepto VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS transferencias
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_rol VARCHAR;
  v_cuenta_origen cuentas;
  v_cuenta_destino cuentas;
  v_origen_es_caja BOOLEAN;
  v_destino_es_caja BOOLEAN;
  v_es_caja BOOLEAN;
  v_turno_caja_id BIGINT := NULL;
  v_concepto VARCHAR;
  v_observaciones TEXT;
  v_transferencia transferencias;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  v_rol := current_user_rol();

  -- ── Validaciones básicas ──────────────────────────────────────────
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de la transferencia debe ser mayor a 0.';
  END IF;
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha de la transferencia es obligatoria.';
  END IF;
  IF p_cuenta_origen IS NULL OR p_cuenta_destino IS NULL THEN
    RAISE EXCEPTION 'Tenés que indicar la cuenta de origen y la de destino.';
  END IF;
  IF p_cuenta_origen = p_cuenta_destino THEN
    RAISE EXCEPTION 'La cuenta de origen y la de destino no pueden ser la misma.';
  END IF;

  v_concepto := NULLIF(TRIM(COALESCE(p_concepto, '')), '');
  IF v_concepto IS NOT NULL AND LENGTH(v_concepto) > 200 THEN
    RAISE EXCEPTION 'El concepto puede tener hasta 200 caracteres.';
  END IF;
  v_observaciones := NULLIF(TRIM(COALESCE(p_observaciones, '')), '');

  -- ── Resolver ambas cuentas (del club + activas) ───────────────────
  SELECT * INTO v_cuenta_origen
  FROM cuentas WHERE id = p_cuenta_origen AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta de origen no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_cuenta_origen.activa THEN
    RAISE EXCEPTION 'La cuenta de origen "%" está inactiva.', v_cuenta_origen.nombre;
  END IF;

  SELECT * INTO v_cuenta_destino
  FROM cuentas WHERE id = p_cuenta_destino AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta de destino no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_cuenta_destino.activa THEN
    RAISE EXCEPTION 'La cuenta de destino "%" está inactiva.', v_cuenta_destino.nombre;
  END IF;

  v_origen_es_caja  := v_cuenta_origen.es_caja_fisica;
  v_destino_es_caja := v_cuenta_destino.es_caja_fisica;
  v_es_caja := (v_origen_es_caja OR v_destino_es_caja);

  -- ── Gate fino ─────────────────────────────────────────────────────
  -- Tocar el cajón (alguna pata es_caja_fisica) es operativo → admin O
  -- vendedor. Mover plata puramente digital (ninguna pata es_caja_fisica) es
  -- tesorería → admin only.
  IF v_es_caja THEN
    IF v_rol NOT IN ('admin','vendedor') THEN
      RAISE EXCEPTION 'No tenés permisos para registrar transferencias.';
    END IF;
  ELSE
    IF v_rol <> 'admin' THEN
      RAISE EXCEPTION
        'Mover dinero entre cuentas que no son caja física requiere administrador.';
    END IF;
  END IF;

  -- ── Bisagra con caja ──────────────────────────────────────────────
  -- Si alguna pata es es_caja_fisica, el efectivo sale/entra del cajón →
  -- exigir caja abierta y atar turno_caja_id (el arqueo la considera). Si
  -- ninguna toca el cajón, turno_caja_id queda NULL (no toca caja).
  -- Caso ambas es_caja_fisica: entra acá igual (una sola caja); el arqueo lo
  -- netea a 0 (+destino −origen). Solo con 2+ cuentas es_caja_fisica.
  IF v_es_caja THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Una transferencia que mueve efectivo del cajón requiere la caja del día abierta.';
    END IF;
  END IF;

  -- ── INSERT ────────────────────────────────────────────────────────
  INSERT INTO transferencias (
    club_id, cuenta_origen_id, cuenta_destino_id, monto, fecha,
    concepto, observaciones, turno_caja_id, usuario_id
  ) VALUES (
    v_club_id, p_cuenta_origen, p_cuenta_destino, p_monto, p_fecha,
    v_concepto, v_observaciones, v_turno_caja_id, v_usuario_id
  )
  RETURNING * INTO v_transferencia;

  RETURN v_transferencia;
END;
$$;

COMMENT ON FUNCTION fn_transferir(BIGINT, BIGINT, DECIMAL, DATE, VARCHAR, TEXT) IS
  'Registra una transferencia entre dos cuentas del club. Gate fino: admin O
   vendedor si una pata es es_caja_fisica (operativo), admin only si es
   puramente digital. Bisagra con caja: si una pata es es_caja_fisica, exige
   caja abierta y ata turno_caja_id (entra al arqueo). NO valida saldo en
   origen (guarda futura opcional). Inmutable.';

GRANT EXECUTE ON FUNCTION fn_transferir(BIGINT, BIGINT, DECIMAL, DATE, VARCHAR, TEXT)
  TO authenticated;


-- ============================================================================
-- 3. CREATE OR REPLACE VIEW v_movimientos_cuenta (0057) + 2 patas
-- ============================================================================
-- Mismas columnas (cuenta_id, club_id, fecha, origen, ref_id, signo, monto) →
-- el contrato de v_cuentas_saldo (que consume esta vista) NO cambia, así que
-- CREATE OR REPLACE es válido sin tocar v_cuentas_saldo.
-- Las 7 ramas previas quedan IDÉNTICAS; se agregan las 2 de transferencias.
-- ============================================================================
CREATE OR REPLACE VIEW v_movimientos_cuenta
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

  -- Cobros de clases. Siempre ingreso.
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

  -- Gastos pagados DIRECTO. Egreso. fecha = fecha_pago.
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

  -- Movimientos manuales de caja (efectivo → cuenta efectivo del club).
  SELECT
    mcd.cuenta_id, cm.club_id, cm.fecha_hora, 'caja_manual', cm.id,
    (CASE WHEN cm.tipo = 'ajuste_positivo' THEN 1 ELSE -1 END)::smallint,
    cm.monto
  FROM caja_movimientos_manuales cm
  JOIN medio_cuenta_default mcd
    ON mcd.club_id = cm.club_id
   AND mcd.medio_pago = 'efectivo'

  UNION ALL

  -- ⭐ NUEVO 0060 — Transferencia: pata ORIGEN (egreso de la cuenta origen).
  SELECT
    tr.cuenta_origen_id, tr.club_id, tr.fecha::timestamptz, 'transferencia_origen', tr.id,
    (-1)::smallint, tr.monto
  FROM transferencias tr

  UNION ALL

  -- ⭐ NUEVO 0060 — Transferencia: pata DESTINO (ingreso a la cuenta destino).
  SELECT
    tr.cuenta_destino_id, tr.club_id, tr.fecha::timestamptz, 'transferencia_destino', tr.id,
    1::smallint, tr.monto
  FROM transferencias tr;

COMMENT ON VIEW v_movimientos_cuenta IS
  'Libro mayor derivado de tesorería: UNION de las 6 tablas de plata (cuenta_id
   NOT NULL) + caja_movimientos_manuales (→ cuenta efectivo) + transferencias
   (0060, dos patas: origen signo − y destino signo +). Normalizado a
   (cuenta_id, club_id, fecha, origen, ref_id, signo, monto). signo*monto =
   aporte al saldo. security_invoker=true.';

GRANT SELECT ON v_movimientos_cuenta TO authenticated;


-- ============================================================================
-- 4. CREATE OR REPLACE FUNCTION fn_cerrar_caja (0059) + fuente transferencias
-- ============================================================================
-- Cuerpo IDÉNTICO a 0059 (arqueo por es_caja_fisica) + UNA fuente nueva:
--   v_transferencias_neto = Σ sobre transferencias de ESTA caja de
--     (+monto si destino es_caja_fisica) + (−monto si origen es_caja_fisica).
-- Sumada al esperado. Una caja SIN transferencias → 0 → esperado idéntico a 0059.
-- Signatura IDÉNTICA → cero cambio para el frontend.
-- ============================================================================
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
  v_club_id BIGINT;
  v_turno turnos_caja;
  v_entradas_cobros DECIMAL(12,2);
  v_movimientos_neto DECIMAL(12,2);
  v_otros_ingresos_efectivo DECIMAL(12,2);
  v_gastos_efectivo DECIMAL(12,2);
  v_cuotas_efectivo DECIMAL(12,2);
  v_transferencias_neto DECIMAL(12,2);      -- ⭐ NUEVO 0060
  v_esperado DECIMAL(12,2);
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cerrar la caja.';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio y no puede ser negativo.';
  END IF;

  v_club_id := current_club_id();

  -- Lock para evitar cierres concurrentes.
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

  -- ── Movimientos manuales (neto) — sin cambio ─────────────────────
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'ajuste_positivo' THEN monto ELSE -monto END
  ), 0)
  INTO v_movimientos_neto
  FROM caja_movimientos_manuales
  WHERE turno_caja_id = p_turno_caja_id;

  -- ── Otros ingresos al cajón (SUMAN) ──────────────────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_otros_ingresos_efectivo
  FROM otros_ingresos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Gastos pagados directo del cajón (RESTAN) ────────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_gastos_efectivo
  FROM gastos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Cuotas de gastos pagadas del cajón (RESTAN) ──────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_cuotas_efectivo
  FROM gasto_cuotas
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE);

  -- ── ⭐ NUEVO 0060 — Transferencias que mueven efectivo del cajón ──
  -- +monto si el destino es el cajón (entra efectivo); −monto si el origen
  -- es el cajón (sale efectivo). Una transferencia entre dos caja física
  -- (raro, 2+ cuentas) se netea a 0. Solo entran las atadas a ESTA caja
  -- (turno_caja_id), que fn_transferir setea cuando una pata es es_caja_fisica.
  SELECT COALESCE(SUM(
    (CASE WHEN cuenta_destino_id IN (SELECT id FROM cuentas
          WHERE club_id = v_club_id AND es_caja_fisica = TRUE) THEN monto ELSE 0 END)
    -
    (CASE WHEN cuenta_origen_id  IN (SELECT id FROM cuentas
          WHERE club_id = v_club_id AND es_caja_fisica = TRUE) THEN monto ELSE 0 END)
  ), 0)
  INTO v_transferencias_neto
  FROM transferencias
  WHERE turno_caja_id = p_turno_caja_id;

  -- ESPERADO: apertura + cobros + movimientos + otros_ingresos
  --           − gastos − cuotas + transferencias netas (⭐ NUEVO 0060).
  v_esperado := v_turno.monto_apertura
              + v_entradas_cobros
              + v_movimientos_neto
              + v_otros_ingresos_efectivo
              - v_gastos_efectivo
              - v_cuotas_efectivo
              + v_transferencias_neto;       -- ⭐ NUEVO 0060

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
  'Cierra una caja abierta con arqueo. Esperado: apertura + cobros que entran
   al cajón (es_caja_fisica, reembolsos restando) + movimientos manuales netos
   + otros_ingresos − gastos − cuotas + transferencias que mueven efectivo del
   cajón (0060: +destino caja física, −origen caja física). Bajo el invariante
   (efectivo ⟺ única cuenta es_caja_fisica) y sin transferencias, el resultado
   es idéntico a 0059. Gate: admin O vendedor. Lock FOR UPDATE.';

COMMIT;

-- ============================================================================
-- Fin de la migración 0060_tesoreria_transferencias.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- A. Tabla + RLS:
--    SELECT polname, cmd FROM pg_policies WHERE tablename='transferencias';
--    → select_propio_club (SELECT), insert_admin_o_vendedor (INSERT). Sin UPDATE/DELETE.
--
-- B. fn_transferir — gate + bisagra:
--    - banco→MP (ninguna caja física) como vendedor → RAISE admin only.
--    - cajón→banco (origen caja física) sin caja abierta → RAISE 'No hay caja abierta...'.
--    - cajón→banco con caja abierta → OK, turno_caja_id seteado.
--    - origen=destino → RAISE.
--
-- C. v_movimientos_cuenta refleja las 2 patas:
--    SELECT origen, cuenta_id, signo, monto FROM v_movimientos_cuenta
--    WHERE origen LIKE 'transferencia_%' ORDER BY ref_id;
--    → por cada transferencia: una fila origen (signo −) y una destino (signo +).
--    El saldo (v_cuentas_saldo) de origen baja y el de destino sube por monto.
--
-- D. ⭐ ARQUEO — caja SIN transferencias → esperado idéntico a 0059
--    (la fuente nueva suma 0). Ver query (a) en el mensaje.
--
-- E. ⭐ ARQUEO — caja CON transferencia de efectivo refleja el movimiento
--    (origen cajón → resta del esperado; destino cajón → suma). Ver query (b).
-- ============================================================================
