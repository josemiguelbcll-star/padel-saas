-- ============================================================================
-- 0030_turnos_fijos.sql
-- Módulo de Turnos Fijos (reservas recurrentes con clientes habituales).
--
-- =====================================================================
-- CONCEPTO
-- =====================================================================
-- Un turno fijo es un acuerdo recurrente: cancha X, día Y de la semana,
-- hora Z, cliente C, todas las semanas. El sistema MATERIALIZA reservas
-- concretas a partir de cada turno fijo, semana a semana.
--
-- Modelo:
--   - turnos_fijos: la definición de la recurrencia + cliente +
--     vigencia opcional.
--   - reservas.turno_fijo_id (FK nullable, ON DELETE SET NULL): link
--     entre la reserva concreta y el turno fijo del que nació.
--
-- =====================================================================
-- IDEMPOTENCIA — DOBLE DEFENSA
-- =====================================================================
-- 1. CHECK A en código (fn_materializar_turnos_fijos): antes del INSERT
--    consulta si ya hay reserva con (turno_fijo_id, fecha).
-- 2. UNIQUE INDEX PARCIAL en reservas (turno_fijo_id, fecha)
--    WHERE turno_fijo_id IS NOT NULL: si por race condition entre dos
--    materializaciones concurrentes el CHECK A pasa pero el INSERT
--    chocaría, el índice rechaza.
--
-- Re-ejecutar fn_materializar con el mismo rango NUNCA duplica.
--
-- =====================================================================
-- MANEJO DE CHOQUES
-- =====================================================================
-- - Choque con RESERVA SUELTA existente: el EXCLUDE no_overlap_reservas
--   de la 0004 dispara automáticamente. Lo capturamos con
--   EXCEPTION WHEN exclusion_violation, contamos el conflicto y
--   CONTINUE. La reserva existente NO se toca.
-- - Choque con CLASE activa: pre-check antes del INSERT (mismo pattern
--   que fn_crear_reserva). Si solapa, saltea y cuenta.
--
-- =====================================================================
-- TARIFA POR FECHA
-- =====================================================================
-- fn_materializar_turnos_fijos llama a fn_resolver_tarifa(fecha, hora)
-- de la 0029 — POR CADA FECHA del loop. La reserva del 17/07 usa la
-- versión de tarifa vigente el 17/07 (respeta aumentos programados).
--
-- Si no hay tarifa vigente para esa fecha (caso raro), la reserva nace
-- con monto_total=0 y tarifa_id=NULL. El admin la ve en la grilla y
-- la edita manualmente.
--
-- =====================================================================
-- RPCs
-- =====================================================================
-- - fn_crear_turno_fijo (admin)
-- - fn_actualizar_turno_fijo (admin) — cambia titular / fecha_hasta /
--   observaciones. NO cambia cancha/día/hora/duración (eso es "mover
--   horario" = desactivar viejo + crear nuevo).
-- - fn_cancelar_turno_fijo (admin) — activo=FALSE, opcionalmente
--   cancela también las reservas pendientes futuras.
-- - fn_materializar_turnos_fijos (admin O vendedor) — genera reservas
--   para el rango dado. Idempotente.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: turnos_fijos
-- ============================================================================
CREATE TABLE turnos_fijos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  cancha_id BIGINT NOT NULL REFERENCES canchas(id),

  -- Titular: jugador registrado O nombre libre, uno de los dos.
  jugador_id BIGINT REFERENCES jugadores(id),
  nombre_libre VARCHAR(120),

  -- Recurrencia semanal: día (ISO 1=lunes..7=domingo) + hora + duración.
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  hora_inicio TIME NOT NULL,
  duracion_min INTEGER NOT NULL
    CHECK (duracion_min IN (60, 90, 120, 150, 180, 240)),

  -- Vigencia.
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE,                   -- NULL = indefinido

  -- Estado.
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  observaciones TEXT,
  usuario_alta_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Titular obligatorio: jugador_id O nombre_libre (no ambos NULL).
  CONSTRAINT turnos_fijos_titular_obligatorio CHECK (
    jugador_id IS NOT NULL
    OR (nombre_libre IS NOT NULL AND LENGTH(TRIM(nombre_libre)) > 0)
  ),

  CONSTRAINT turnos_fijos_fechas_coherentes CHECK (
    fecha_hasta IS NULL OR fecha_hasta >= fecha_desde
  )
);

COMMENT ON TABLE turnos_fijos IS
  'Reservas recurrentes (semanales) con clientes habituales. La grilla
   diaria se llena con reservas materializadas vía fn_materializar_turnos_fijos
   — el turno fijo es la definición, las reservas materializadas son
   las instancias concretas (cobrables, cancelables individualmente).';

COMMENT ON COLUMN turnos_fijos.jugador_id IS
  'Cliente registrado. NULL solo si se usa nombre_libre (CHECK obliga
   uno de los dos).';

COMMENT ON COLUMN turnos_fijos.nombre_libre IS
  'Alternativa a jugador_id: nombre del cliente sin ficha. Útil para
   clientes ocasionales que no requieren registro completo.';

COMMENT ON COLUMN turnos_fijos.fecha_hasta IS
  'Última fecha en que el turno fijo se materializa. NULL = indefinido
   (se materializa hasta que se cancele o desactive).';


-- ============================================================================
-- 2. Índices y constraint UNIQUE parcial (invariante "un slot único")
-- ============================================================================

-- Invariante: NO puede haber dos turnos fijos activos en el mismo slot
-- (cancha + día + hora). Un slot puede tener UN solo cliente recurrente.
CREATE UNIQUE INDEX turnos_fijos_no_overlap_activos
  ON turnos_fijos (club_id, cancha_id, dia_semana, hora_inicio)
  WHERE activo = TRUE;

CREATE INDEX idx_turnos_fijos_club_activo
  ON turnos_fijos (club_id) WHERE activo = TRUE;

CREATE INDEX idx_turnos_fijos_jugador
  ON turnos_fijos (jugador_id) WHERE jugador_id IS NOT NULL;


-- ============================================================================
-- 3. RLS y GRANTs de turnos_fijos
-- ============================================================================
ALTER TABLE turnos_fijos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "turnos_fijos_select_propio_club"
ON turnos_fijos FOR SELECT TO authenticated
USING (club_id = current_club_id());

-- ABM solo admin (decisión comercial: pactar un fijo es contrato).
CREATE POLICY "turnos_fijos_insert_admin"
ON turnos_fijos FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "turnos_fijos_update_admin"
ON turnos_fijos FOR UPDATE TO authenticated
USING (club_id = current_club_id() AND current_user_rol() = 'admin')
WITH CHECK (club_id = current_club_id() AND current_user_rol() = 'admin');

-- Sin DELETE policy: cancelar = activo=FALSE, los registros se preservan.

GRANT SELECT, INSERT, UPDATE ON turnos_fijos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE turnos_fijos_id_seq TO authenticated;


-- ============================================================================
-- 4. ALTER reservas — turno_fijo_id (link a turno fijo materializado)
-- ============================================================================
ALTER TABLE reservas
  ADD COLUMN turno_fijo_id BIGINT REFERENCES turnos_fijos(id) ON DELETE SET NULL;

COMMENT ON COLUMN reservas.turno_fijo_id IS
  'Link al turno fijo del que nació esta reserva (materialización).
   NULL = reserva suelta (creada manualmente desde la grilla).
   ON DELETE SET NULL: si se borra físicamente el turno fijo (caso raro
   — normalmente se desactiva), la reserva histórica se preserva.';

-- Idempotencia server-side: UNIQUE PARCIAL sobre (turno_fijo_id, fecha)
-- garantiza que un turno fijo NUNCA materializa dos veces la misma
-- fecha. Defensa última si el CHECK A en código fallara (race condition).
CREATE UNIQUE INDEX reservas_turno_fijo_fecha_unico
  ON reservas (turno_fijo_id, fecha)
  WHERE turno_fijo_id IS NOT NULL;


-- ============================================================================
-- 5. RPC: fn_crear_turno_fijo
-- ============================================================================
--    Crea un turno fijo nuevo. Validaciones en orden (falla rápido):
--      1. Sesión + rol admin.
--      2. Cancha existe y pertenece al club.
--      3. Si jugador_id viene: existe y pertenece al club.
--      4. Titular obligatorio (CHECK ya lo cubre; mensaje claro).
--      5. dia_semana 1-7, duracion_min válida (CHECK).
--      6. fecha_hasta >= fecha_desde si no es null (CHECK).
--      7. NO choca con clase activa en mismo cancha/día/horario.
--      8. NO choca con otro turno fijo activo en mismo slot (UNIQUE
--         parcial → unique_violation capturado).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_crear_turno_fijo(
  p_cancha_id BIGINT,
  p_jugador_id BIGINT,
  p_nombre_libre VARCHAR,
  p_dia_semana INTEGER,
  p_hora_inicio TIME,
  p_duracion_min INTEGER,
  p_fecha_desde DATE,
  p_fecha_hasta DATE DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS turnos_fijos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_turno turnos_fijos;
  v_hora_fin TIME;
  v_fecha_chequeo_tarifa DATE;
  v_dia_nombre TEXT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear turnos fijos.';
  END IF;

  -- Validar cancha del club.
  IF NOT EXISTS (
    SELECT 1 FROM canchas WHERE id = p_cancha_id AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION 'La cancha no existe o no pertenece a tu club.';
  END IF;

  -- Validar jugador del club (si viene).
  IF p_jugador_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM jugadores WHERE id = p_jugador_id AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'El jugador no existe o no pertenece a tu club.';
    END IF;
  END IF;

  -- Titular obligatorio (mensaje claro antes del CHECK).
  IF p_jugador_id IS NULL
     AND (p_nombre_libre IS NULL OR LENGTH(TRIM(p_nombre_libre)) = 0) THEN
    RAISE EXCEPTION 'Tenés que indicar un jugador registrado o un nombre.';
  END IF;

  v_hora_fin := p_hora_inicio + (p_duracion_min || ' minutes')::interval;

  -- Choque con clase activa: si una clase del club tiene este día en
  -- dias_semana[] y su rango horario solapa con [hora_inicio, hora_fin),
  -- el turno fijo no puede convivir.
  IF EXISTS (
    SELECT 1
    FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND p_dia_semana = ANY(c.dias_semana)
      AND tsrange(
        ('1970-01-01'::date + c.hora_inicio)::timestamp,
        ('1970-01-01'::date + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION
      'Ese horario se solapa con una clase activa en esa cancha.';
  END IF;

  -- ──────────────────────────────────────────────────────────────────
  -- Validación de tarifa existente: tiene que haber AL MENOS UNA tarifa
  -- activa que cubra (dia_semana, hora_inicio) en la fecha desde la que
  -- empieza el turno fijo. Sin esto, la materialización generaría
  -- reservas sin tarifa (huecos en la proyección financiera) y el
  -- problema pasaría desapercibido hasta el cierre.
  --
  -- Usamos GREATEST(fecha_desde, hoy) como fecha de chequeo:
  --   - fecha_desde pasada → chequea con hoy.
  --   - fecha_desde futura → chequea para esa fecha (cubre aumentos
  --     programados que ya estén configurados).
  -- ──────────────────────────────────────────────────────────────────
  v_fecha_chequeo_tarifa := GREATEST(p_fecha_desde, CURRENT_DATE);

  IF NOT EXISTS (
    SELECT 1 FROM tarifas t
    WHERE t.club_id = v_club_id
      AND t.activa = TRUE
      AND t.vigente_desde <= v_fecha_chequeo_tarifa
      AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= v_fecha_chequeo_tarifa)
      AND (t.dias_semana IS NULL OR p_dia_semana = ANY(t.dias_semana))
      AND (
        (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
        OR (p_hora_inicio >= t.desde_hora AND p_hora_inicio < t.hasta_hora)
      )
  ) THEN
    v_dia_nombre := CASE p_dia_semana
      WHEN 1 THEN 'lunes'
      WHEN 2 THEN 'martes'
      WHEN 3 THEN 'miércoles'
      WHEN 4 THEN 'jueves'
      WHEN 5 THEN 'viernes'
      WHEN 6 THEN 'sábados'
      WHEN 7 THEN 'domingos'
    END;
    RAISE EXCEPTION
      'No hay ninguna tarifa configurada para los % a las %. Configurá la tarifa en Configuración → Tarifas antes de crear el turno fijo.',
      v_dia_nombre, to_char(p_hora_inicio, 'HH24:MI');
  END IF;

  -- INSERT. Si hay otro turno fijo activo en el mismo slot, el UNIQUE
  -- parcial dispara unique_violation; capturamos con mensaje claro.
  BEGIN
    INSERT INTO turnos_fijos (
      club_id, cancha_id, jugador_id, nombre_libre,
      dia_semana, hora_inicio, duracion_min,
      fecha_desde, fecha_hasta,
      observaciones, usuario_alta_id
    ) VALUES (
      v_club_id, p_cancha_id, p_jugador_id,
      CASE WHEN p_nombre_libre IS NULL THEN NULL ELSE TRIM(p_nombre_libre) END,
      p_dia_semana, p_hora_inicio, p_duracion_min,
      p_fecha_desde, p_fecha_hasta,
      p_observaciones, v_usuario_id
    )
    RETURNING * INTO v_turno;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'Ya hay otro turno fijo activo en esa cancha los días % a las %. Desactivá el existente o elegí otro slot.',
        p_dia_semana, p_hora_inicio;
  END;

  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION fn_crear_turno_fijo IS
  'Crea un turno fijo. Valida cancha/jugador/titular/clase. UNIQUE parcial
   garantiza que no haya dos turnos fijos activos en el mismo slot
   (cancha+día+hora). Gate: admin.';

GRANT EXECUTE ON FUNCTION fn_crear_turno_fijo(
  BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT
) TO authenticated;


-- ============================================================================
-- 6. RPC: fn_actualizar_turno_fijo
-- ============================================================================
--    Cambia: jugador_id, nombre_libre, fecha_hasta, observaciones.
--    NO cambia: cancha, dia_semana, hora_inicio, duracion_min.
--    Para "mover horario" → desactivar viejo + crear nuevo.
--
--    Reservas ya materializadas mantienen sus snapshots (jugador_id,
--    monto_total). Cambios afectan solo materializaciones futuras.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_actualizar_turno_fijo(
  p_turno_fijo_id BIGINT,
  p_jugador_id BIGINT DEFAULT NULL,
  p_nombre_libre VARCHAR DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  -- Flags para diferenciar "no cambiar" vs "limpiar a NULL".
  p_clear_jugador BOOLEAN DEFAULT FALSE,
  p_clear_nombre_libre BOOLEAN DEFAULT FALSE,
  p_clear_fecha_hasta BOOLEAN DEFAULT FALSE,
  p_clear_observaciones BOOLEAN DEFAULT FALSE
)
RETURNS turnos_fijos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_fijos;
  v_nuevo_jugador BIGINT;
  v_nuevo_nombre VARCHAR;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede actualizar turnos fijos.';
  END IF;

  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  -- Validar jugador nuevo si viene (no clear).
  IF p_jugador_id IS NOT NULL AND NOT p_clear_jugador THEN
    IF NOT EXISTS (
      SELECT 1 FROM jugadores WHERE id = p_jugador_id AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'El jugador no existe o no pertenece a tu club.';
    END IF;
  END IF;

  -- Resolver titular nuevo (después de aplicar clears).
  v_nuevo_jugador := CASE
    WHEN p_clear_jugador THEN NULL
    WHEN p_jugador_id IS NOT NULL THEN p_jugador_id
    ELSE v_turno.jugador_id
  END;
  v_nuevo_nombre := CASE
    WHEN p_clear_nombre_libre THEN NULL
    WHEN p_nombre_libre IS NOT NULL THEN TRIM(p_nombre_libre)
    ELSE v_turno.nombre_libre
  END;

  -- Validar que al menos uno de los dos quede (CHECK también lo cubriría,
  -- pero damos mensaje claro).
  IF v_nuevo_jugador IS NULL
     AND (v_nuevo_nombre IS NULL OR LENGTH(TRIM(v_nuevo_nombre)) = 0) THEN
    RAISE EXCEPTION 'Tenés que indicar un jugador registrado o un nombre.';
  END IF;

  UPDATE turnos_fijos
  SET jugador_id = v_nuevo_jugador,
      nombre_libre = v_nuevo_nombre,
      fecha_hasta = CASE
        WHEN p_clear_fecha_hasta THEN NULL
        WHEN p_fecha_hasta IS NOT NULL THEN p_fecha_hasta
        ELSE fecha_hasta
      END,
      observaciones = CASE
        WHEN p_clear_observaciones THEN NULL
        WHEN p_observaciones IS NOT NULL THEN p_observaciones
        ELSE observaciones
      END
  WHERE id = p_turno_fijo_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION fn_actualizar_turno_fijo IS
  'Actualiza titular / fecha_hasta / observaciones de un turno fijo.
   NO cambia cancha/día/hora/duración (eso es "mover horario" =
   desactivar viejo + crear nuevo). Reservas ya materializadas
   mantienen sus snapshots; cambios afectan solo materializaciones
   futuras.';

GRANT EXECUTE ON FUNCTION fn_actualizar_turno_fijo(
  BIGINT, BIGINT, VARCHAR, DATE, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;


-- ============================================================================
-- 7. RPC: fn_cancelar_turno_fijo
-- ============================================================================
--    Desactiva el turno fijo. Si p_cancelar_pendientes = TRUE,
--    además cancela todas las reservas pendientes futuras asociadas.
--
--    Casos:
--      - p_cancelar_pendientes = FALSE: solo activo=FALSE. Las reservas
--        materializadas (futuras y pasadas) se mantienen como están.
--        Útil cuando el cliente avisa "termino la próxima semana" y
--        querés que las próximas ya en agenda se respeten.
--      - p_cancelar_pendientes = TRUE: activo=FALSE + cancela las
--        pendientes futuras (estado='pendiente' AND fecha >= hoy).
--        NO toca pagadas/señadas/jugadas/canceladas (historia).
--        Útil cuando el cliente "avisa hoy que no viene más".
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cancelar_turno_fijo(
  p_turno_fijo_id BIGINT,
  p_cancelar_pendientes BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  reservas_canceladas INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_fijos;
  v_canceladas INT := 0;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cancelar turnos fijos.';
  END IF;

  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  IF NOT v_turno.activo THEN
    RAISE EXCEPTION 'El turno fijo ya está desactivado.';
  END IF;

  -- 1. Cancelar reservas pendientes futuras (si se pidió).
  IF p_cancelar_pendientes THEN
    UPDATE reservas
    SET estado = 'cancelada'
    WHERE turno_fijo_id = p_turno_fijo_id
      AND club_id = v_club_id
      AND fecha >= CURRENT_DATE
      AND estado = 'pendiente';
    GET DIAGNOSTICS v_canceladas = ROW_COUNT;
  END IF;

  -- 2. Desactivar turno fijo.
  UPDATE turnos_fijos
  SET activo = FALSE
  WHERE id = p_turno_fijo_id;

  RETURN QUERY SELECT v_canceladas;
END;
$$;

COMMENT ON FUNCTION fn_cancelar_turno_fijo IS
  'Desactiva un turno fijo (activo=FALSE). Si p_cancelar_pendientes=TRUE,
   también cancela las reservas pendientes futuras del turno (no toca
   pagadas/señadas/jugadas/canceladas). Retorna cantidad de reservas
   afectadas.';

GRANT EXECUTE ON FUNCTION fn_cancelar_turno_fijo(BIGINT, BOOLEAN)
  TO authenticated;


-- ============================================================================
-- 8. RPC: fn_materializar_turnos_fijos — la pieza crítica
-- ============================================================================
--    Genera reservas concretas para el rango [p_fecha_desde, p_fecha_hasta]
--    a partir de los turnos fijos activos del club.
--
--    POR CADA FECHA DEL LOOP: resuelve tarifa con fn_resolver_tarifa
--    (que ya considera vigencia temporal). Una reserva del 17/07 usa
--    la versión de tarifa vigente el 17/07.
--
--    Idempotencia: doble defensa (CHECK A en código + UNIQUE parcial).
--    Choques: capturados sin pisar reservas existentes (reservas sueltas
--    o clases).
--
--    Retorna 5 contadores:
--      - reservas_creadas
--      - slots_ocupados_por_reserva_suelta (conflicto con reserva NO turno fijo)
--      - slots_ocupados_por_clase
--      - slots_sin_tarifa (no hay tarifa vigente que cubra esa fecha+hora;
--                          el turno fijo no se materializa para esa fecha
--                          y el admin tiene que configurar la tarifa)
--      - slots_ya_materializados (idempotencia: ya había reserva del turno)
--
--    Gate: admin O vendedor (operación rutinaria, no decisión comercial).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_materializar_turnos_fijos(
  p_fecha_desde DATE,
  p_fecha_hasta DATE
)
RETURNS TABLE (
  reservas_creadas INT,
  slots_ocupados_por_reserva_suelta INT,
  slots_ocupados_por_clase INT,
  slots_sin_tarifa INT,
  slots_ya_materializados INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_tf turnos_fijos;
  v_fecha DATE;
  v_fecha_min DATE;
  v_fecha_max DATE;
  v_hora_fin TIME;
  v_tarifa_resuelta RECORD;
  v_monto DECIMAL(12,2);
  v_tarifa_id BIGINT;
  v_reserva_id BIGINT;
  v_creadas INT := 0;
  v_choques_suelta INT := 0;
  v_choques_clase INT := 0;
  v_sin_tarifa INT := 0;
  v_ya_hechas INT := 0;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para materializar turnos fijos.';
  END IF;

  -- Validar rango.
  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'Las fechas desde y hasta son obligatorias.';
  END IF;
  IF p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'La fecha desde no puede ser posterior a la fecha hasta.';
  END IF;
  -- Guard: no más de 12 meses (366 días) para evitar abuso.
  IF (p_fecha_hasta - p_fecha_desde) > 366 THEN
    RAISE EXCEPTION 'El rango no puede ser mayor a 12 meses.';
  END IF;

  -- =================================================================
  -- Loop por turno fijo activo del club con vigencia en el rango.
  -- =================================================================
  FOR v_tf IN
    SELECT *
    FROM turnos_fijos
    WHERE club_id = v_club_id
      AND activo = TRUE
      AND fecha_desde <= p_fecha_hasta
      AND (fecha_hasta IS NULL OR fecha_hasta >= p_fecha_desde)
  LOOP
    -- Limitar el sub-rango a la intersección de [p_fecha_desde, p_fecha_hasta]
    -- con la vigencia del turno fijo.
    v_fecha_min := GREATEST(p_fecha_desde, v_tf.fecha_desde);
    v_fecha_max := LEAST(
      p_fecha_hasta,
      COALESCE(v_tf.fecha_hasta, p_fecha_hasta)
    );

    v_hora_fin := v_tf.hora_inicio
                  + (v_tf.duracion_min || ' minutes')::interval;

    -- Iterar fecha por fecha.
    v_fecha := v_fecha_min;
    WHILE v_fecha <= v_fecha_max LOOP
      -- Solo procesar si la fecha cae en el dia_semana del turno fijo.
      IF EXTRACT(ISODOW FROM v_fecha)::INT = v_tf.dia_semana THEN

        -- ──────────────────────────────────────────────────────────
        -- CHECK A — idempotencia: ¿ya materializado para esta fecha?
        -- ──────────────────────────────────────────────────────────
        IF EXISTS (
          SELECT 1 FROM reservas
          WHERE turno_fijo_id = v_tf.id AND fecha = v_fecha
        ) THEN
          v_ya_hechas := v_ya_hechas + 1;
          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        -- ──────────────────────────────────────────────────────────
        -- CHECK B — ¿clase activa solapando este slot esta fecha?
        -- Mismo pattern que fn_crear_reserva (tsrange + dias_semana).
        -- ──────────────────────────────────────────────────────────
        IF EXISTS (
          SELECT 1
          FROM clases c
          WHERE c.club_id = v_club_id
            AND c.cancha_id = v_tf.cancha_id
            AND c.activa = TRUE
            AND v_tf.dia_semana = ANY(c.dias_semana)
            AND tsrange(
              (v_fecha + c.hora_inicio)::timestamp,
              (v_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
            ) && tsrange(
              (v_fecha + v_tf.hora_inicio)::timestamp,
              (v_fecha + v_hora_fin)::timestamp
            )
        ) THEN
          v_choques_clase := v_choques_clase + 1;
          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        -- ──────────────────────────────────────────────────────────
        -- Resolver tarifa vigente A LA FECHA de la reserva.
        -- fn_resolver_tarifa retorna 0 filas si no hay tarifa que
        -- aplique para esa fecha+hora.
        --
        -- Si NO hay tarifa → NO materializamos esta fecha. Se cuenta
        -- en v_sin_tarifa para que el admin sepa que tiene que
        -- configurar tarifa para ese slot. Generar reservas con
        -- monto_total=0 ensuciaría la proyección financiera y
        -- pasaría desapercibido — mejor no materializar y avisar.
        -- ──────────────────────────────────────────────────────────
        SELECT tarifa_id, monto INTO v_tarifa_resuelta
        FROM fn_resolver_tarifa(v_fecha, v_tf.hora_inicio);

        IF v_tarifa_resuelta.tarifa_id IS NULL THEN
          v_sin_tarifa := v_sin_tarifa + 1;
          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        v_tarifa_id := v_tarifa_resuelta.tarifa_id;
        v_monto := v_tarifa_resuelta.monto;

        -- ──────────────────────────────────────────────────────────
        -- INSERT con manejo del EXCLUDE no_overlap_reservas.
        -- Si dispara (reserva suelta o cualquier otra reserva
        -- existente solapando ese slot), saltamos sin pisar.
        --
        -- Sub-bloque BEGIN/EXCEPTION/END: las excepciones acá NO
        -- rollbackean el bloque exterior — solo el savepoint
        -- implícito de este sub-bloque.
        -- ──────────────────────────────────────────────────────────
        BEGIN
          INSERT INTO reservas (
            club_id, cancha_id, jugador_id, fecha,
            hora_inicio, hora_fin, duracion_min,
            tarifa_id, monto_total,
            monto_sena, monto_pagado,
            estado, usuario_alta_id,
            turno_fijo_id
          ) VALUES (
            v_club_id, v_tf.cancha_id, v_tf.jugador_id, v_fecha,
            v_tf.hora_inicio, v_hora_fin, v_tf.duracion_min,
            v_tarifa_id, v_monto,
            0, 0,
            'pendiente', v_usuario_id,
            v_tf.id
          )
          RETURNING id INTO v_reserva_id;

          -- Si hay jugador_id, insertarlo como titular.
          IF v_tf.jugador_id IS NOT NULL THEN
            INSERT INTO reserva_jugadores (
              club_id, reserva_id, jugador_id, es_titular
            ) VALUES (
              v_club_id, v_reserva_id, v_tf.jugador_id, TRUE
            );
          END IF;

          v_creadas := v_creadas + 1;

        EXCEPTION
          -- 23P01: EXCLUDE no_overlap_reservas → otra reserva (suelta
          -- o de otro turno fijo) ocupa el slot.
          WHEN exclusion_violation THEN
            v_choques_suelta := v_choques_suelta + 1;
          -- 23505: UNIQUE reservas_turno_fijo_fecha_unico — race
          -- condition entre dos materializaciones concurrentes.
          -- Lo contamos como ya_hechas (la otra materialización ganó).
          WHEN unique_violation THEN
            v_ya_hechas := v_ya_hechas + 1;
        END;
      END IF;

      v_fecha := v_fecha + 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_creadas, v_choques_suelta, v_choques_clase, v_sin_tarifa, v_ya_hechas;
END;
$$;

COMMENT ON FUNCTION fn_materializar_turnos_fijos IS
  'Materializa reservas para el rango dado a partir de los turnos
   fijos activos del club. Idempotente (doble defensa: CHECK A en
   código + UNIQUE parcial). Resuelve tarifa por fecha (respeta
   vigencias y aumentos programados). Captura choques con reservas
   sueltas (EXCLUDE no_overlap_reservas) sin pisarlas. Si no hay
   tarifa vigente que cubra el slot+fecha, NO materializa esa fecha
   y la cuenta en slots_sin_tarifa. Retorna 5 contadores. Gate:
   admin O vendedor.';

GRANT EXECUTE ON FUNCTION fn_materializar_turnos_fijos(DATE, DATE)
  TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0030_turnos_fijos.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Tabla y constraints creados ----------
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema='public' AND table_name='turnos_fijos';
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint WHERE conrelid='turnos_fijos'::regclass ORDER BY conname;
-- → turnos_fijos_titular_obligatorio, turnos_fijos_fechas_coherentes,
--   + los CHECK inline (dia_semana, duracion_min) + FKs.

-- ---------- B. Columna turno_fijo_id en reservas + UNIQUE parcial ----------
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='reservas' AND column_name='turno_fijo_id';
-- → BIGINT nullable.
--
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename='reservas' AND indexname='reservas_turno_fijo_fecha_unico';
-- → UNIQUE WHERE turno_fijo_id IS NOT NULL.

-- ---------- C. Crear turno fijo ----------
-- Como admin de Signo, elegir una cancha y un jugador (o usar nombre_libre):
--   await window.supabase.rpc('fn_crear_turno_fijo', {
--     p_cancha_id: <id>, p_jugador_id: <id o null>, p_nombre_libre: null,
--     p_dia_semana: 3, p_hora_inicio: '19:00', p_duracion_min: 90,
--     p_fecha_desde: '2026-05-22'
--   });
-- → Retorna la fila creada.

-- ---------- D. UNIQUE parcial (un slot único) ----------
-- Intentar crear OTRO turno fijo en el mismo cancha+día+hora:
-- → 'Ya hay otro turno fijo activo en esa cancha los días X a las HH:MM...'

-- ---------- E. Choque con clase activa ----------
-- Crear un turno fijo en cancha+día+hora donde hay clase activa:
-- → 'Ese horario se solapa con una clase activa en esa cancha.'

-- ---------- F. Materializar próximas 4 semanas ----------
--   await window.supabase.rpc('fn_materializar_turnos_fijos', {
--     p_fecha_desde: '2026-05-22', p_fecha_hasta: '2026-06-19'
--   });
-- → { data: [{ reservas_creadas: 4, slots_ocupados_por_reserva_suelta: 0,
--     slots_ocupados_por_clase: 0, slots_sin_tarifa: 0,
--     slots_ya_materializados: 0 }], error: null }
--   (4 miércoles en 4 semanas).

-- ---------- G. Idempotencia: re-materializar mismo rango ----------
-- Ejecutar la misma RPC otra vez:
-- → { reservas_creadas: 0, slots_ocupados_por_reserva_suelta: 0,
--     slots_ocupados_por_clase: 0, slots_sin_tarifa: 0,
--     slots_ya_materializados: 4 }
--   (las 4 fechas ya estaban hechas, ninguna se duplica).

-- ---------- H. Choque con reserva suelta ----------
-- Crear MANUALMENTE una reserva suelta en cancha+fecha+hora del turno fijo
-- (futura, ej. miércoles 03/07/2026). Después materializar incluyendo esa fecha:
-- → reservas_creadas decrece en 1, slots_ocupados_por_reserva_suelta = 1.
--   La reserva suelta NO se toca.

-- ---------- I bis. Crear turno fijo SIN tarifa configurada → RECHAZA ----------
-- Si no hay tarifa que cubra el día+hora del turno, fn_crear_turno_fijo
-- rechaza:
--   await window.supabase.rpc('fn_crear_turno_fijo', {
--     p_cancha_id: <id>, p_jugador_id: <id>, p_nombre_libre: null,
--     p_dia_semana: 7, p_hora_inicio: '03:00', p_duracion_min: 90,
--     p_fecha_desde: '2026-05-22'
--   });
-- → 'No hay ninguna tarifa configurada para los domingos a las 03:00.
--    Configurá la tarifa en Configuración → Tarifas antes de crear el
--    turno fijo.'

-- ---------- I. Tarifa por fecha (LA CRÍTICA) ----------
-- Si hay aumento programado de tarifa (de la 0029), las reservas
-- materializadas para fechas posteriores al aumento deben tener
-- monto_total con el monto NUEVO.
--   SELECT id, fecha, monto_total, turno_fijo_id FROM reservas
--   WHERE turno_fijo_id = <id> ORDER BY fecha;
-- → Cada fecha tiene el monto correspondiente a la tarifa vigente
--   en esa fecha (no a la fecha de materialización).

-- ---------- J. Cancelar turno fijo SIN pendientes ----------
--   await window.supabase.rpc('fn_cancelar_turno_fijo', {
--     p_turno_fijo_id: <id>, p_cancelar_pendientes: false
--   });
-- → { reservas_canceladas: 0 }. activo pasa a FALSE. Las reservas
--   futuras pendientes se mantienen.

-- ---------- K. Cancelar turno fijo CON pendientes ----------
-- Crear otro turno fijo, materializar, y después:
--   await window.supabase.rpc('fn_cancelar_turno_fijo', {
--     p_turno_fijo_id: <id>, p_cancelar_pendientes: true
--   });
-- → { reservas_canceladas: <N> }. Las reservas pendientes futuras
--   pasan a estado='cancelada'. Las pagadas/jugadas se preservan.

-- ---------- L. Cancelar reserva materializada individual ----------
-- En la grilla, cancelar UNA reserva materializada (estado='cancelada').
-- El turno fijo sigue activo, la próxima semana se materializa normal.
-- ============================================================================
