-- ============================================================================
-- 0022_caja_modelo.sql
-- Módulo de Caja — Bloque 1 (modelo de datos + RPCs auxiliares).
--
-- =====================================================================
-- ⚠ REGLA DE ORO DEL EFECTIVO (la dejo arriba porque atraviesa TODA
-- la migración y la 0023 que viene después):
-- =====================================================================
--
-- Cuando se cobra CUALQUIER cosa (reserva, buffet, clase, consumo de
-- turno) y el medio_pago es 'efectivo', ese dinero entra
-- AUTOMÁTICAMENTE a la caja abierta — porque el cliente entregó
-- efectivo físico que va al cajón. El cobro queda atado a la caja vía
-- FK `turno_caja_id`.
--
-- Si el medio_pago es 'transferencia', 'mp', 'tarjeta' u 'otro', NO
-- toca la caja: no hay efectivo físico que registrar. El cobro queda
-- con `turno_caja_id = NULL`.
--
-- Si NO hay caja abierta y el medio es 'efectivo' → la RPC de cobro
-- RAISE con mensaje claro. Razón: el efectivo NUNCA puede quedar sin
-- caja (auditabilidad). El vendedor cambia el medio o pide al
-- operador del mostrador que abra la caja.
--
-- ESTA MIGRACIÓN (0022) crea el modelo + las 3 RPCs operativas
-- (abrir, cerrar, registrar movimiento manual). NO toca las RPCs de
-- cobro existentes — eso va en la 0023.
--
-- =====================================================================
-- QUIÉN OPERA LA CAJA:
-- =====================================================================
-- TANTO admin como vendedor pueden abrir, cerrar, registrar
-- movimientos y ver el arqueo. El vendedor es quien está en el
-- mostrador manejando el efectivo; el admin también puede si está
-- presente.
--
-- Lo que SIGUE siendo solo admin (en módulos posteriores):
--   - Reportes de rentabilidad / EERR globales.
--   - Configuración del club.
--
-- La línea: "vendedor opera la caja del día, NO ve reportes
-- financieros globales".
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ALTER clubes — modalidad de caja del club
-- ============================================================================
--    'por_dia':       una sola caja abierta por club. Modalidad típica
--                     (Signo Padel arranca acá).
--    'por_vendedor':  una caja abierta por (club, vendedor). Cada
--                     vendedor maneja su propio cajón.
--
--    El cambio entre modalidades NO migra cajas existentes — afecta
--    solo las cajas que se ABREN a partir del cambio (la modalidad se
--    snapshot-ea en `turnos_caja.modalidad` al abrir).
--
--    Hoy NO hay UI para cambiar este setting; se hace por SQL desde
--    Studio. Cuando se exponga, requerirá GRANT column-level + policy.
-- ============================================================================
ALTER TABLE clubes
  ADD COLUMN modalidad_caja VARCHAR(20) NOT NULL DEFAULT 'por_dia'
  CHECK (modalidad_caja IN ('por_dia','por_vendedor'));

COMMENT ON COLUMN clubes.modalidad_caja IS
  'Modalidad de caja del club: por_dia (una caja única) o por_vendedor
   (una por vendedor). Default por_dia. Cambio sólo por SQL hoy.';


-- ============================================================================
-- 2. TABLA: turnos_caja
--    Una fila por cada "jornada de caja" — abierta cuando alguien
--    arranca el día y cerrada cuando se hace el arqueo.
--
--    fecha_jornada = DATE de la APERTURA (en hora local de Argentina).
--    Razón: una caja abierta el 21 a las 7:00 y cerrada el 22 a las
--    2:00 AM ES la caja del 21. La fecha del cierre puede ser otra
--    (eso vive en cerrada_en).
--
--    El cierre es ATÓMICO: o están TODOS los campos de cierre, o
--    ninguno (CHECK turnos_caja_cierre_atomico).
--
--    Coherencia modalidad ↔ vendedor_id:
--      - por_dia      → vendedor_id IS NULL.
--      - por_vendedor → vendedor_id NOT NULL (cada vendedor su caja).
-- ============================================================================
CREATE TABLE turnos_caja (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  -- Apertura
  fecha_jornada DATE NOT NULL,
  monto_apertura DECIMAL(12,2) NOT NULL CHECK (monto_apertura >= 0),
  usuario_apertura UUID NOT NULL REFERENCES usuarios(id),
  abierta_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Modalidad SNAPSHOT al abrir (si el club cambia setting después,
  -- esta caja mantiene la modalidad con la que se abrió).
  modalidad VARCHAR(20) NOT NULL CHECK (modalidad IN ('por_dia','por_vendedor')),
  vendedor_id UUID REFERENCES usuarios(id),

  -- Cierre (NULL mientras está abierta)
  cerrada_en TIMESTAMPTZ,
  usuario_cierre UUID REFERENCES usuarios(id),
  efectivo_esperado DECIMAL(12,2),
  efectivo_contado DECIMAL(12,2),
  diferencia DECIMAL(12,2),     -- contado - esperado (+: sobra; -: falta)
  observaciones_cierre TEXT,

  -- Coherencia modalidad ↔ vendedor_id.
  CONSTRAINT turnos_caja_modalidad_vendedor_coherente CHECK (
    (modalidad = 'por_dia'      AND vendedor_id IS NULL)
    OR
    (modalidad = 'por_vendedor' AND vendedor_id IS NOT NULL)
  ),

  -- Cierre atómico: todos los campos juntos o ninguno.
  CONSTRAINT turnos_caja_cierre_atomico CHECK (
    (cerrada_en IS NULL AND usuario_cierre IS NULL
                        AND efectivo_esperado IS NULL
                        AND efectivo_contado IS NULL
                        AND diferencia IS NULL)
    OR
    (cerrada_en IS NOT NULL AND usuario_cierre IS NOT NULL
                            AND efectivo_esperado IS NOT NULL
                            AND efectivo_contado IS NOT NULL
                            AND diferencia IS NOT NULL)
  )
);

-- ─── INVARIANTES "una caja abierta por club" ───────────────────────────
-- Índices parciales únicos: imposible bypassar desde el cliente.
-- Si dos requests intentan abrir caja en simultáneo, Postgres rechaza
-- la segunda con unique_violation; la RPC fn_abrir_caja la captura.

CREATE UNIQUE INDEX uq_turno_caja_abierta_por_dia
  ON turnos_caja (club_id)
  WHERE cerrada_en IS NULL AND modalidad = 'por_dia';

CREATE UNIQUE INDEX uq_turno_caja_abierta_por_vendedor
  ON turnos_caja (club_id, vendedor_id)
  WHERE cerrada_en IS NULL AND modalidad = 'por_vendedor';

-- Para listado de cajas históricas + reportes:
CREATE INDEX idx_turnos_caja_club_jornada
  ON turnos_caja (club_id, fecha_jornada DESC);

COMMENT ON TABLE turnos_caja IS
  'Jornadas de caja del club (apertura → cierre con arqueo). En modalidad
   por_dia hay una sola caja abierta por club; en por_vendedor, una por
   (club, vendedor). Los cobros en efectivo se atan vía
   reserva_pagos/ventas/clase_cobros.turno_caja_id en la 0023.';

COMMENT ON COLUMN turnos_caja.fecha_jornada IS
  'Día calendario de APERTURA en hora local. Una caja abierta el 21 a
   las 7:00 y cerrada el 22 a las 2:00 es la caja del 21.';

COMMENT ON COLUMN turnos_caja.modalidad IS
  'Snapshot de clubes.modalidad_caja al momento de abrir. La caja
   mantiene su modalidad aunque el club cambie el setting después.';

COMMENT ON COLUMN turnos_caja.diferencia IS
  'contado - esperado. Positivo = sobra. Negativo = falta. Cero = cuadró.';


-- ============================================================================
-- 3. TABLA: caja_movimientos_manuales
--
--    Salidas y ajustes registrados a mano sobre una caja abierta:
--      - 'retiro':          el operador retira efectivo (sale).
--      - 'pago_proveedor':  paga al proveedor en efectivo (sale).
--      - 'ajuste_negativo': aparece un faltante durante operación (sale).
--      - 'ajuste_positivo': aparece un sobrante durante operación (entra).
--
--    El monto SIEMPRE positivo; el signo (suma/resta al esperado) lo
--    determina `tipo` — definido en fn_cerrar_caja.
--
--    INMUTABLES desde la app: no hay UPDATE/DELETE (ni GRANT ni
--    policy). Si se registra mal, hay que corregir con un movimiento
--    compensatorio. Auditabilidad por encima de la conveniencia.
-- ============================================================================
CREATE TABLE caja_movimientos_manuales (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  turno_caja_id BIGINT NOT NULL REFERENCES turnos_caja(id) ON DELETE RESTRICT,

  tipo VARCHAR(20) NOT NULL CHECK (tipo IN (
    'retiro',
    'pago_proveedor',
    'ajuste_positivo',
    'ajuste_negativo'
  )),
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  concepto VARCHAR(200) NOT NULL,
  observaciones TEXT,

  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_caja_mov_man_turno ON caja_movimientos_manuales(turno_caja_id);

COMMENT ON TABLE caja_movimientos_manuales IS
  'Salidas/ajustes manuales sobre una caja abierta. Inmutables — corregir
   = registrar movimiento compensatorio (auditabilidad).';

COMMENT ON COLUMN caja_movimientos_manuales.monto IS
  'Siempre positivo. El signo (suma o resta al esperado) lo define `tipo`
   en fn_cerrar_caja (retiro/pago_proveedor/ajuste_negativo restan;
   ajuste_positivo suma).';


-- ============================================================================
-- 4. ALTER cobros — FK turno_caja_id
--
--    NULL aceptable porque:
--      - Cobros NO en efectivo no atan a caja (transferencia/mp/tarjeta).
--      - Cobros legacy anteriores a esta migración quedan NULL (no
--        había cajas; son históricos pre-caja).
--
--    ON DELETE RESTRICT previene borrar una caja con cobros atados —
--    auditabilidad.
--
--    Esta migración solo agrega la columna. La 0023 modifica las 4
--    RPCs de cobro para SETEAR el FK cuando medio_pago='efectivo'.
-- ============================================================================
ALTER TABLE reserva_pagos
  ADD COLUMN turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT;

ALTER TABLE ventas
  ADD COLUMN turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT;

ALTER TABLE clase_cobros
  ADD COLUMN turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT;

COMMENT ON COLUMN reserva_pagos.turno_caja_id IS
  'Caja a la que entró este cobro. NOT NULL cuando medio_pago=efectivo
   (se setea en fn_cobrar_persona_turno/fn_cobrar_reserva — 0023).
   NULL cuando medio_pago != efectivo o cobro pre-0022.';

COMMENT ON COLUMN ventas.turno_caja_id IS
  'Caja a la que entró la venta. NOT NULL cuando medio_pago=efectivo
   (se setea en fn_cerrar_venta — 0023). NULL en el resto.';

COMMENT ON COLUMN clase_cobros.turno_caja_id IS
  'Caja a la que entró el cobro. NOT NULL cuando medio_pago=efectivo
   (se setea en fn_cobrar_clase — 0023). NULL en el resto.';


-- ============================================================================
-- 5. Helper: current_club_caja_abierta()
--
--    Devuelve el id de la caja abierta del club según modalidad:
--      - por_dia:      la única caja abierta del club.
--      - por_vendedor: la caja abierta del vendedor auth.uid() en
--                      este club.
--    Retorna NULL si no hay caja abierta para el caller.
--
--    SECURITY DEFINER + STABLE + search_path = public — mismo hardening
--    que current_club_id() y current_user_rol().
--
--    Se invoca desde:
--      - fn_registrar_movimiento_caja_manual (esta migración).
--      - Las 4 RPCs de cobro modificadas en la 0023.
-- ============================================================================
CREATE OR REPLACE FUNCTION current_club_caja_abierta()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_modalidad VARCHAR;
  v_caja_id BIGINT;
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT modalidad_caja INTO v_modalidad
  FROM clubes WHERE id = v_club_id;

  IF v_modalidad = 'por_dia' THEN
    SELECT id INTO v_caja_id
    FROM turnos_caja
    WHERE club_id = v_club_id AND cerrada_en IS NULL;
  ELSIF v_modalidad = 'por_vendedor' THEN
    SELECT id INTO v_caja_id
    FROM turnos_caja
    WHERE club_id = v_club_id
      AND cerrada_en IS NULL
      AND vendedor_id = auth.uid();
  END IF;

  RETURN v_caja_id;
END;
$$;

COMMENT ON FUNCTION current_club_caja_abierta() IS
  'Caja abierta del club para el caller (según modalidad). NULL si no
   hay caja abierta. SECURITY DEFINER porque consulta clubes y
   turnos_caja sin depender de la RLS del caller.';

GRANT EXECUTE ON FUNCTION current_club_caja_abierta() TO authenticated;


-- ============================================================================
-- 6. RPC: fn_abrir_caja(p_monto_apertura)
--
--    Abre la caja del día. La modalidad y el vendedor_id se derivan
--    del setting del club y de auth.uid() — NO se pasan como input
--    (un usuario no puede abrir caja "a nombre de otro vendedor").
--
--    Gate de rol: admin O vendedor. Ambos operan caja (corrección
--    del plan: el vendedor está en el mostrador).
--
--    fecha_jornada = día calendario de APERTURA en hora local
--    Argentina. (Si en el futuro hay clubes en otra zona, agregamos
--    clubes.timezone.)
--
--    Invariante "una caja abierta": si ya hay caja abierta para el
--    mismo (club, modalidad) o (club, modalidad, vendedor), el índice
--    único parcial dispara unique_violation; lo capturamos y damos
--    mensaje claro.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_abrir_caja(p_monto_apertura DECIMAL)
RETURNS turnos_caja
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_modalidad VARCHAR;
  v_vendedor_id UUID;
  v_turno turnos_caja;
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Sin club asignado.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para abrir la caja.';
  END IF;

  IF p_monto_apertura IS NULL OR p_monto_apertura < 0 THEN
    RAISE EXCEPTION 'El monto de apertura es obligatorio y no puede ser negativo.';
  END IF;

  SELECT modalidad_caja INTO v_modalidad
  FROM clubes WHERE id = v_club_id;

  IF v_modalidad = 'por_vendedor' THEN
    v_vendedor_id := auth.uid();
  ELSE
    v_vendedor_id := NULL;
  END IF;

  BEGIN
    INSERT INTO turnos_caja (
      club_id, fecha_jornada, monto_apertura, usuario_apertura,
      modalidad, vendedor_id
    ) VALUES (
      v_club_id,
      (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE,
      p_monto_apertura,
      auth.uid(),
      v_modalidad,
      v_vendedor_id
    )
    RETURNING * INTO v_turno;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya hay una caja abierta. Cerrá la actual antes de abrir una nueva.';
  END;

  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION fn_abrir_caja(DECIMAL) IS
  'Abre la caja del día. Modalidad y vendedor_id se derivan del setting
   del club y de auth.uid(). Gate: admin O vendedor (el vendedor opera
   el mostrador). Captura unique_violation del índice parcial si ya hay
   caja abierta.';

GRANT EXECUTE ON FUNCTION fn_abrir_caja(DECIMAL) TO authenticated;


-- ============================================================================
-- 7. RPC: fn_cerrar_caja(p_turno_caja_id, p_efectivo_contado, p_observaciones)
--
--    Cierre con arqueo atómico:
--      esperado = monto_apertura
--               + Σ cobros en efectivo de esta caja
--                 (con tipo='reembolso' de reserva_pagos restando)
--               + Σ ajustes_positivos
--               − Σ (retiros + pagos_proveedor + ajustes_negativos)
--      diferencia = contado − esperado
--
--    REGLA DE ORO (recordatorio):
--      Las entradas se calculan filtrando por
--      `turno_caja_id = p_turno_caja_id AND medio_pago = 'efectivo'`.
--      Los cobros no-efectivo NO entran al arqueo — porque no hay
--      efectivo físico en el cajón para ellos.
--
--    Gate: admin O vendedor del club (corrección 1 del plan).
--    Lock con FOR UPDATE para evitar cierres concurrentes.
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
  v_turno turnos_caja;
  v_entradas_cobros DECIMAL(12,2);
  v_movimientos_neto DECIMAL(12,2);
  v_esperado DECIMAL(12,2);
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cerrar la caja.';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio y no puede ser negativo.';
  END IF;

  -- Lock para evitar cierres concurrentes.
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
  -- Filtramos por turno_caja_id Y medio_pago='efectivo' (doble
  -- defensa: en teoría turno_caja_id sólo se setea para efectivo,
  -- pero filtrar por medio_pago hace explícito el invariante).
  --
  -- reserva_pagos.tipo='reembolso' resta (devolvimos efectivo).
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
  -- ajuste_positivo suma; el resto (retiro, pago_proveedor,
  -- ajuste_negativo) resta.
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'ajuste_positivo' THEN monto ELSE -monto END
  ), 0)
  INTO v_movimientos_neto
  FROM caja_movimientos_manuales
  WHERE turno_caja_id = p_turno_caja_id;

  v_esperado := v_turno.monto_apertura + v_entradas_cobros + v_movimientos_neto;

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
  'Cierra una caja abierta con arqueo. Calcula esperado server-side
   (apertura + cobros efectivo + ajustes positivos − salidas) y guarda
   diferencia = contado − esperado. Gate: admin O vendedor del club.';

GRANT EXECUTE ON FUNCTION fn_cerrar_caja(BIGINT, DECIMAL, TEXT) TO authenticated;


-- ============================================================================
-- 8. RPC: fn_registrar_movimiento_caja_manual
--
--    Registra una salida/ajuste sobre la caja abierta del caller.
--    La caja se resuelve automáticamente con current_club_caja_abierta()
--    — el caller no la pasa como input. Si no hay caja abierta, RAISE.
--
--    Gate: admin O vendedor.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_registrar_movimiento_caja_manual(
  p_tipo VARCHAR,
  p_monto DECIMAL,
  p_concepto VARCHAR,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS caja_movimientos_manuales
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_caja_id BIGINT;
  v_mov caja_movimientos_manuales;
  v_concepto_trim VARCHAR;
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para registrar movimientos en la caja.';
  END IF;
  IF p_tipo NOT IN ('retiro','pago_proveedor','ajuste_positivo','ajuste_negativo') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del movimiento debe ser mayor a cero.';
  END IF;

  v_concepto_trim := TRIM(COALESCE(p_concepto, ''));
  IF LENGTH(v_concepto_trim) = 0 THEN
    RAISE EXCEPTION 'El concepto es obligatorio.';
  END IF;
  IF LENGTH(v_concepto_trim) > 200 THEN
    RAISE EXCEPTION 'El concepto puede tener hasta 200 caracteres.';
  END IF;

  v_caja_id := current_club_caja_abierta();
  IF v_caja_id IS NULL THEN
    RAISE EXCEPTION
      'No hay caja abierta. Abrí la caja del día antes de registrar movimientos.';
  END IF;

  INSERT INTO caja_movimientos_manuales (
    club_id, turno_caja_id, tipo, monto, concepto, observaciones, usuario_id
  ) VALUES (
    current_club_id(), v_caja_id, p_tipo, p_monto,
    v_concepto_trim, p_observaciones, auth.uid()
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;

COMMENT ON FUNCTION fn_registrar_movimiento_caja_manual(VARCHAR, DECIMAL, VARCHAR, TEXT) IS
  'Registra un movimiento manual (retiro / pago_proveedor / ajuste_+/−)
   sobre la caja abierta del caller. Gate: admin O vendedor. Si no hay
   caja abierta, RAISE.';

GRANT EXECUTE ON FUNCTION fn_registrar_movimiento_caja_manual(VARCHAR, DECIMAL, VARCHAR, TEXT)
  TO authenticated;


-- ============================================================================
-- 9. RLS y GRANTs
-- ============================================================================

-- ── turnos_caja ────────────────────────────────────────────────────────
ALTER TABLE turnos_caja ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario activo del club ve sus cajas (admin y
-- vendedor) — necesario para la pantalla /caja y el cálculo en vivo.
CREATE POLICY "turnos_caja_select_propio_club"
ON turnos_caja FOR SELECT TO authenticated
USING (club_id = current_club_id());

-- INSERT: admin O vendedor del propio club. El INSERT lo hace
-- fn_abrir_caja (SECURITY INVOKER) — esta policy es la barrera.
CREATE POLICY "turnos_caja_insert_admin_o_vendedor"
ON turnos_caja FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- UPDATE: admin O vendedor del propio club. Lo usa fn_cerrar_caja
-- para escribir los campos de cierre.
CREATE POLICY "turnos_caja_update_admin_o_vendedor"
ON turnos_caja FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- DELETE: ninguna policy → fail-closed. Las cajas no se borran.

GRANT SELECT, INSERT, UPDATE ON turnos_caja TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE turnos_caja_id_seq TO authenticated;


-- ── caja_movimientos_manuales ─────────────────────────────────────────
ALTER TABLE caja_movimientos_manuales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caja_mov_man_select_propio_club"
ON caja_movimientos_manuales FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "caja_mov_man_insert_admin_o_vendedor"
ON caja_movimientos_manuales FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- Sin policies UPDATE/DELETE → INMUTABLE. Corregir = movimiento
-- compensatorio (auditabilidad).

GRANT SELECT, INSERT ON caja_movimientos_manuales TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE caja_movimientos_manuales_id_seq TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0022_caja_modelo.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Tablas creadas + columnas agregadas ----------
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('turnos_caja','caja_movimientos_manuales');
-- -- Debería listar las 2.
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='clubes'
--   AND column_name='modalidad_caja';
-- -- Debería listar modalidad_caja.
--
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_schema='public' AND column_name='turno_caja_id'
--   AND table_name IN ('reserva_pagos','ventas','clase_cobros');
-- -- Debería listar las 3.

-- ---------- B. Índices parciales únicos ----------
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'turnos_caja';
-- -- Debería incluir uq_turno_caja_abierta_por_dia y
-- -- uq_turno_caja_abierta_por_vendedor con WHERE clauses.

-- ---------- C. Helper devuelve NULL sin caja abierta ----------
-- Logueate como cache@beatpadel.com.ar (admin de club) y en la consola:
--   await window.supabase.rpc('current_club_caja_abierta');
-- → { data: null, error: null }
-- (No hay caja abierta todavía → null. SIN error.)

-- ---------- D. fn_abrir_caja ----------
-- Como cache@ en la consola:
--   await window.supabase.rpc('fn_abrir_caja', { p_monto_apertura: 5000 });
-- → { data: { id, club_id, fecha_jornada, monto_apertura: 5000, ... }, error: null }
--
-- Verificar invariante: intentar abrir SEGUNDA caja inmediato:
--   await window.supabase.rpc('fn_abrir_caja', { p_monto_apertura: 1000 });
-- → { data: null, error: { message: 'Ya hay una caja abierta...' } }

-- ---------- E. Helper devuelve el id tras abrir ----------
-- await window.supabase.rpc('current_club_caja_abierta');
-- → { data: <id de la caja>, error: null }

-- ---------- F. fn_registrar_movimiento_caja_manual ----------
-- await window.supabase.rpc('fn_registrar_movimiento_caja_manual', {
--   p_tipo: 'retiro', p_monto: 500, p_concepto: 'Prueba'
-- });
-- → { data: { id, turno_caja_id, tipo: 'retiro', ... }, error: null }
--
-- Tipo inválido:
-- await window.supabase.rpc('fn_registrar_movimiento_caja_manual', {
--   p_tipo: 'inventado', p_monto: 100, p_concepto: 'X'
-- });
-- → 'Tipo de movimiento inválido.'

-- ---------- G. fn_cerrar_caja ----------
-- await window.supabase.rpc('fn_cerrar_caja', {
--   p_turno_caja_id: <id>, p_efectivo_contado: 4500, p_observaciones: 'Prueba'
-- });
-- → { data: { ..., cerrada_en, efectivo_esperado: 4500, diferencia: 0 }, error: null }
-- (apertura 5000 − retiro 500 = esperado 4500; contado 4500 → diferencia 0.)
--
-- Intentar cerrar la misma caja de nuevo:
-- → 'Esta caja ya está cerrada.'

-- ---------- H. Aislamiento multi-tenant ----------
-- Como un usuario de OTRO club:
-- await window.supabase.from('turnos_caja').select('*');
-- → solo las cajas de SU club. Las del primer club no aparecen.
--
-- await window.supabase.rpc('fn_cerrar_caja', {
--   p_turno_caja_id: <id de la caja del OTRO club>, p_efectivo_contado: 0
-- });
-- → 'Caja no encontrada.' (porque el WHERE filtra por current_club_id())
-- ============================================================================
