-- ============================================================================
-- 0051_tarifa_2d_duracion.sql
-- Tarifa 2D: el precio depende de FRANJA HORARIA × DURACIÓN.
-- Opción A — columna duracion_min en tarifas (NULL = cualquier duración).
--
-- ⚠️ ARCHIVO EN VARIAS PARTES. NO EJECUTAR HASTA QUE LAS PARTES 3 Y 4 ESTÉN
-- APPENDEADAS (un solo BEGIN acá, un solo COMMIT al final de la PARTE 4).
-- ─────────────────────────────────────────────────────────────────────────
--   PARTE 1 (este bloque): ALTER tarifas ADD duracion_min + CHECK.
--   PARTE 2 (este bloque): DROP + CREATE fn_resolver_tarifa con +p_duracion.
--   PARTE 3 (se appendea): fn_crear_tarifa / fn_cambiar_precio_tarifa /
--                          fn_actualizar_metadata_tarifa propagan duracion_min.
--   PARTE 4 (se appendea): fn_materializar_turnos_fijos pasa v_tf.duracion_min
--                          a fn_resolver_tarifa + COMMIT.
-- ─────────────────────────────────────────────────────────────────────────
--
-- =====================================================================
-- MODELO (decisión confirmada)
-- =====================================================================
-- `duracion_min` es METADATA de la franja (vive con desde_hora/dias_semana/
-- prioridad), NO se versiona por precio. Por eso convive limpio con el
-- lineage/vigencia de la 0029:
--   - Un linaje = el historial de precio de UNA combinación
--     (franja horaria × día × duración). Ej: "Mañana 60", "Mañana 90" y
--     "Punta 90" son TRES linajes independientes, cada uno con su propio
--     versionado de precio.
--   - `duracion_min` es CONSTANTE dentro de un linaje (la copia
--     fn_cambiar_precio_tarifa al versionar; la edita en bloque
--     fn_actualizar_metadata_tarifa — PARTE 3).
--   - El EXCLUDE `tarifas_no_overlap_lineage` (0029) NO se toca: opera
--     sobre (club_id, lineage_id, daterange) y sigue garantizando que dos
--     versiones del MISMO linaje no se solapen en el tiempo. Linajes
--     distintos no se constriñen entre sí (Mañana-60 y Mañana-90
--     coexisten). El versionado de precios existente queda intacto.
--
-- =====================================================================
-- RETROCOMPATIBILIDAD
-- =====================================================================
-- Sin backfill: las tarifas existentes quedan con duracion_min = NULL
-- (= "aplica a cualquier duración"). El filtro de resolución
-- (`duracion_min IS NULL OR duracion_min = p_duracion`) las deja aplicar
-- siempre. Un club con solo tarifas NULL se comporta EXACTAMENTE como hoy.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PARTE 1 — ALTER tarifas: agregar duracion_min
-- ============================================================================
-- NULL = la tarifa aplica a cualquier duración (retrocompatible). Un valor
-- puntual = la tarifa aplica solo a turnos de esa duración.
-- ============================================================================
ALTER TABLE tarifas
  ADD COLUMN duracion_min INTEGER;

ALTER TABLE tarifas
  ADD CONSTRAINT tarifas_duracion_min_valida CHECK (
    duracion_min IS NULL OR duracion_min IN (60, 90, 120, 150, 180, 240)
  );

COMMENT ON COLUMN tarifas.duracion_min IS
  'Duración (minutos) a la que aplica esta tarifa. NULL = cualquier
   duración (retrocompatible). Un valor puntual = precio específico para
   turnos de esa duración (ej. Mañana 60 = $22.000 vs Mañana 90 = $32.000).
   Es metadata de la franja, constante dentro del linaje (no se versiona
   por precio). En la resolución, una tarifa con duración específica gana
   sobre la NULL.';


-- ============================================================================
-- PARTE 2 — fn_resolver_tarifa: +p_duracion, filtro y ORDER BY 2D
-- ============================================================================
-- Cambios respecto a la 0029:
--   ⭐ +p_duracion INTEGER DEFAULT NULL. DEFAULT NULL para que los callers
--      que NO pasan duración (flujos de clases vía resolverTarifa, y la
--      llamada de 2 args de fn_materializar_turnos_fijos hasta la PARTE 4)
--      sigan funcionando con el comportamiento previo (sin filtro de
--      duración, orden por prioridad/id).
--   ⭐ Filtro: duracion_min NULL aplica a cualquier duración; p_duracion
--      NULL = sin filtro de duración.
--   ⭐ ORDER BY: la tarifa con duración específica GANA sobre la NULL
--      (más específica gana), SOLO cuando hay duración objetivo. Sin
--      duración objetivo el término es FALSE para todas → ordena como
--      antes (prioridad DESC, id DESC).
--
-- Resto IDÉNTICO a 0029: club, activa, vigencia temporal, día, franja
-- horaria. SECURITY INVOKER + STABLE. La RLS filtra por club (defensa en
-- capas con el WHERE explícito).
--
-- La firma cambia (2 → 3 args) → DROP + CREATE (CREATE OR REPLACE crearía
-- un overload nuevo en vez de reemplazar). El DROP no rompe a
-- fn_materializar_turnos_fijos: los cuerpos PL/pgSQL no son dependencia
-- dura, y su llamada de 2 args resuelve contra la nueva función vía el
-- DEFAULT (hasta que la PARTE 4 le pase la duración explícita).
-- ============================================================================
DROP FUNCTION IF EXISTS fn_resolver_tarifa(DATE, TIME);

CREATE OR REPLACE FUNCTION fn_resolver_tarifa(
  p_fecha DATE,
  p_hora TIME,
  p_duracion INTEGER DEFAULT NULL
)
RETURNS TABLE (tarifa_id BIGINT, monto DECIMAL(12,2))
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.monto
  FROM tarifas t
  WHERE t.club_id = current_club_id()    -- defensa en capas (RLS también filtra)
    AND t.activa = TRUE
    -- Vigencia temporal: la fecha del slot cae en el rango de la versión.
    AND t.vigente_desde <= p_fecha
    AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= p_fecha)
    -- Día de la semana.
    AND (
      t.dias_semana IS NULL
      OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(t.dias_semana)
    )
    -- Franja horaria.
    AND (
      (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
      OR (p_hora >= t.desde_hora AND p_hora < t.hasta_hora)
    )
    -- ⭐ NUEVO 0051: filtro de duración. duracion_min NULL aplica a
    -- cualquier duración; p_duracion NULL = sin filtro (comportamiento previo).
    AND (
      p_duracion IS NULL
      OR t.duracion_min IS NULL
      OR t.duracion_min = p_duracion
    )
  ORDER BY
    -- ⭐ NUEVO 0051: la duración específica gana sobre la NULL (más
    -- específica gana), solo cuando hay duración objetivo. Sin duración
    -- objetivo, FALSE para todas → ordena como antes.
    (p_duracion IS NOT NULL AND t.duracion_min IS NOT NULL) DESC,
    t.prioridad DESC,
    t.id DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION fn_resolver_tarifa(DATE, TIME, INTEGER) IS
  'Espejo SQL de resolverTarifa.ts. Resuelve la tarifa para un
   (fecha, hora, duración) del club del caller. Vigencia temporal: usa la
   versión del linaje vigente A LA FECHA del slot. 2D (0051): filtra por
   duración (duracion_min NULL = cualquiera; p_duracion NULL = sin filtro)
   y la duración específica gana sobre la NULL. SECURITY INVOKER — la RLS
   filtra por club. Devuelve 0 filas si no aplica ninguna.';

GRANT EXECUTE ON FUNCTION fn_resolver_tarifa(DATE, TIME, INTEGER) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⏸  FIN PARTES 1+2. La transacción sigue ABIERTA (se appendean PARTE 3 + 4).
-- ════════════════════════════════════════════════════════════════════════


-- ============================================================================
-- PARTE 3 — RPCs de ABM: propagar duracion_min
-- ============================================================================
-- Tres funciones de la 0029, reproducidas ENTERAS para no perder nada del
-- versionado/lineage/vigencia. El único cambio funcional es propagar
-- `duracion_min`:
--   - fn_crear_tarifa: +p_duracion_min (nace con la franja).
--   - fn_cambiar_precio_tarifa: COPIA duracion_min de la versión vigente a
--     la nueva (es metadata, constante en el linaje).
--   - fn_actualizar_metadata_tarifa: +p_duracion_min + p_clear_duracion
--     (patrón clear-flag, porque NULL es un valor con significado).
-- ============================================================================


-- ─── 3.1 fn_crear_tarifa (DROP + CREATE, +p_duracion_min) ──────────────────
-- Cambio respecto a 0029: +p_duracion_min INTEGER DEFAULT NULL, que se
-- inserta en la fila nueva. La firma cambia (7 → 8 args) → DROP + CREATE.
-- Resto IDÉNTICO: gate admin, validaciones, patrón autoreferente
-- (lineage_id = id propio vía INSERT temporal + UPDATE).
DROP FUNCTION IF EXISTS fn_crear_tarifa(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
);

CREATE OR REPLACE FUNCTION fn_crear_tarifa(
  p_nombre VARCHAR,
  p_monto DECIMAL,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT 0,
  p_vigente_desde DATE DEFAULT NULL,
  p_duracion_min INTEGER DEFAULT NULL
)
RETURNS tarifas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_tarifa tarifas;
  v_vigente_desde DATE;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear tarifas.';
  END IF;

  IF p_nombre IS NULL OR LENGTH(TRIM(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  -- ⭐ NUEVO 0051: validar duración si viene (NULL = cualquier duración).
  IF p_duracion_min IS NOT NULL
     AND p_duracion_min NOT IN (60, 90, 120, 150, 180, 240) THEN
    RAISE EXCEPTION 'Duración inválida. Usá 60, 90, 120, 150, 180 o 240, o dejala vacía (cualquier duración).';
  END IF;

  v_vigente_desde := COALESCE(p_vigente_desde, CURRENT_DATE);

  -- INSERT con lineage_id temporal (1) y autoref en el UPDATE de abajo
  -- (el id es BIGSERIAL — no lo conocemos antes del INSERT). Atómico.
  INSERT INTO tarifas (
    club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id,
    duracion_min
  ) VALUES (
    v_club_id, TRIM(p_nombre), p_monto, p_desde_hora, p_hasta_hora,
    p_dias_semana, p_prioridad, TRUE,
    v_vigente_desde, NULL, 1,            -- lineage_id temporal
    p_duracion_min                       -- ⭐ NUEVO 0051
  )
  RETURNING * INTO v_tarifa;

  UPDATE tarifas SET lineage_id = v_tarifa.id
  WHERE id = v_tarifa.id
  RETURNING * INTO v_tarifa;

  RETURN v_tarifa;
END;
$$;

COMMENT ON FUNCTION fn_crear_tarifa(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE, INTEGER
) IS
  'Crea una franja de tarifa nueva (= linaje nuevo, versión 0). lineage_id
   = id propio (autoref). vigente_desde opcional (default hoy). 0051:
   +p_duracion_min (NULL = cualquier duración) — define la dimensión
   duración de la tarifa 2D.';

GRANT EXECUTE ON FUNCTION fn_crear_tarifa(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE, INTEGER
) TO authenticated;


-- ─── 3.2 fn_cambiar_precio_tarifa (CREATE OR REPLACE; copia duracion_min) ──
-- ⚠️ CRÍTICA. La firma NO cambia (p_lineage_id, p_monto_nuevo,
-- p_vigente_desde) → CREATE OR REPLACE (sin DROP). El ÚNICO cambio es que
-- el INSERT de la versión nueva COPIA `v_actual.duracion_min` (igual que ya
-- copia nombre/franja/días/prioridad) — la duración es metadata constante
-- del linaje y debe preservarse al versionar el precio.
--
-- Resto IDÉNTICO a 0029: gate admin, validaciones (monto>0, fecha
-- obligatoria, no retroactiva), SELECT FOR UPDATE de la versión vigente,
-- RAISE si precio igual / si ya hay versión en esa fecha, cierre de la
-- versión actual (vigente_hasta = p_vigente_desde - 1), INSERT de la nueva
-- con mismo lineage_id. El EXCLUDE tarifas_no_overlap_lineage sigue
-- garantizando server-side el no-solapamiento temporal del linaje.
CREATE OR REPLACE FUNCTION fn_cambiar_precio_tarifa(
  p_lineage_id BIGINT,
  p_monto_nuevo DECIMAL,
  p_vigente_desde DATE
)
RETURNS tarifas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_actual tarifas;
  v_nueva tarifas;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar precios.';
  END IF;

  IF p_monto_nuevo IS NULL OR p_monto_nuevo <= 0 THEN
    RAISE EXCEPTION 'El monto nuevo debe ser mayor a 0.';
  END IF;
  IF p_vigente_desde IS NULL THEN
    RAISE EXCEPTION 'La fecha desde la que rige el precio nuevo es obligatoria.';
  END IF;
  IF p_vigente_desde < CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha debe ser hoy o futura (no se permite reescribir historia).';
  END IF;

  -- Versión "abierta" del linaje que cubre la fecha del cambio.
  SELECT * INTO v_actual
  FROM tarifas
  WHERE club_id = v_club_id
    AND lineage_id = p_lineage_id
    AND vigente_desde <= p_vigente_desde
    AND (vigente_hasta IS NULL OR vigente_hasta >= p_vigente_desde)
  ORDER BY vigente_desde DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No hay versión del linaje % vigente en la fecha %. Verificá el linaje y la fecha.',
      p_lineage_id, p_vigente_desde;
  END IF;

  IF v_actual.monto = p_monto_nuevo THEN
    RAISE EXCEPTION 'El precio nuevo es igual al actual ($%). No tiene sentido versionar.', v_actual.monto;
  END IF;

  IF v_actual.vigente_desde = p_vigente_desde THEN
    RAISE EXCEPTION
      'Ya hay una versión vigente desde el % con monto $%. Para corregirla, cancelá el aumento programado (deuda v2 — hoy se hace por SQL).',
      v_actual.vigente_desde, v_actual.monto;
  END IF;

  -- Cerrar la versión actual.
  UPDATE tarifas
  SET vigente_hasta = p_vigente_desde - 1
  WHERE id = v_actual.id;

  -- Crear la nueva versión: mismo lineage + mismo metadata + monto nuevo.
  -- ⭐ NUEVO 0051: copia v_actual.duracion_min (metadata del linaje).
  -- Si el EXCLUDE detecta solapamiento (aumento futuro en conflicto),
  -- Postgres rechaza con 23P01 y la transacción entera rollbackea.
  INSERT INTO tarifas (
    club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id,
    duracion_min
  ) VALUES (
    v_club_id, v_actual.nombre, p_monto_nuevo, v_actual.desde_hora, v_actual.hasta_hora,
    v_actual.dias_semana, v_actual.prioridad, v_actual.activa,
    p_vigente_desde, NULL, p_lineage_id,
    v_actual.duracion_min                -- ⭐ NUEVO 0051: preserva la duración
  )
  RETURNING * INTO v_nueva;

  RETURN v_nueva;
END;
$$;

COMMENT ON FUNCTION fn_cambiar_precio_tarifa(BIGINT, DECIMAL, DATE) IS
  'Versiona el precio de un linaje. Cierra la versión vigente y crea una
   nueva con el monto nuevo. Atómica. EXCLUDE garantiza no-solapamiento
   server-side. Soporta aumentos programados (fecha futura), NO retroactivos.
   0051: la nueva versión COPIA duracion_min de la actual (metadata
   constante del linaje — la duración no cambia al cambiar el precio).';


-- ─── 3.3 fn_actualizar_metadata_tarifa (DROP + CREATE, +duracion_min) ──────
-- Cambio respecto a 0029: +p_duracion_min INTEGER DEFAULT NULL y
-- +p_clear_duracion BOOLEAN DEFAULT FALSE (patrón clear-flag, igual que
-- franja horaria y días, porque NULL es un valor con significado: "cualquier
-- duración"). El UPDATE edita duracion_min en TODAS las versiones del
-- linaje (es metadata "de la misma franja en el tiempo"). La firma cambia
-- (9 → 11 args) → DROP + CREATE.
-- Resto IDÉNTICO a 0029: gate admin, UPDATE de nombre/franja/días/prioridad/
-- activa con sus clear-flags, sobre club + lineage, RETURN del conteo.
DROP FUNCTION IF EXISTS fn_actualizar_metadata_tarifa(
  BIGINT, VARCHAR, TIME, TIME, INTEGER[], INTEGER, BOOLEAN, BOOLEAN, BOOLEAN
);

CREATE OR REPLACE FUNCTION fn_actualizar_metadata_tarifa(
  p_lineage_id BIGINT,
  p_nombre VARCHAR DEFAULT NULL,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT NULL,
  p_activa BOOLEAN DEFAULT NULL,
  -- Sentinels para diferenciar "no se cambia" vs "se cambia a NULL".
  p_clear_franja_horaria BOOLEAN DEFAULT FALSE,
  p_clear_dias_semana BOOLEAN DEFAULT FALSE,
  -- ⭐ NUEVO 0051: duración + su clear-flag.
  p_duracion_min INTEGER DEFAULT NULL,
  p_clear_duracion BOOLEAN DEFAULT FALSE
)
RETURNS INT  -- cantidad de versiones del linaje afectadas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_count INT;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede actualizar tarifas.';
  END IF;

  -- ⭐ NUEVO 0051: validar duración si se va a setear (no clear).
  IF NOT p_clear_duracion
     AND p_duracion_min IS NOT NULL
     AND p_duracion_min NOT IN (60, 90, 120, 150, 180, 240) THEN
    RAISE EXCEPTION 'Duración inválida. Usá 60, 90, 120, 150, 180 o 240, o limpiala (cualquier duración).';
  END IF;

  UPDATE tarifas
  SET nombre = CASE WHEN p_nombre IS NOT NULL THEN TRIM(p_nombre) ELSE nombre END,
      desde_hora = CASE
        WHEN p_clear_franja_horaria THEN NULL
        WHEN p_desde_hora IS NOT NULL THEN p_desde_hora
        ELSE desde_hora
      END,
      hasta_hora = CASE
        WHEN p_clear_franja_horaria THEN NULL
        WHEN p_hasta_hora IS NOT NULL THEN p_hasta_hora
        ELSE hasta_hora
      END,
      dias_semana = CASE
        WHEN p_clear_dias_semana THEN NULL
        WHEN p_dias_semana IS NOT NULL THEN p_dias_semana
        ELSE dias_semana
      END,
      -- ⭐ NUEVO 0051: duración con clear-flag.
      duracion_min = CASE
        WHEN p_clear_duracion THEN NULL
        WHEN p_duracion_min IS NOT NULL THEN p_duracion_min
        ELSE duracion_min
      END,
      prioridad = COALESCE(p_prioridad, prioridad),
      activa = COALESCE(p_activa, activa)
  WHERE club_id = v_club_id AND lineage_id = p_lineage_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'No se encontró ningún linaje con id %.', p_lineage_id;
  END IF;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION fn_actualizar_metadata_tarifa(
  BIGINT, VARCHAR, TIME, TIME, INTEGER[], INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER, BOOLEAN
) IS
  'Actualiza metadata (nombre, franja, días, prioridad, activa, duración)
   en TODAS las versiones del linaje. NO toca vigencia ni monto. Flags
   p_clear_* diferencian "no cambiar" de "poner en NULL" (franja, días y
   —0051— duración). duracion_min NULL = cualquier duración.';

GRANT EXECUTE ON FUNCTION fn_actualizar_metadata_tarifa(
  BIGINT, VARCHAR, TIME, TIME, INTEGER[], INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER, BOOLEAN
) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⏸  FIN PARTE 3. La transacción sigue ABIERTA (se appendea PARTE 4 + COMMIT).
-- ════════════════════════════════════════════════════════════════════════


-- ============================================================================
-- PARTE 4 — fn_materializar_turnos_fijos: resolver tarifa por fecha Y DURACIÓN
-- ============================================================================
-- Reproducida ENTERA desde la 0030. ÚNICO cambio funcional: la llamada a
-- fn_resolver_tarifa pasa ahora `v_tf.duracion_min` (3er arg). Hasta hoy
-- llamaba con 2 args (ignorando la duración) → un club con tarifas 2D
-- materializaría turnos fijos con el precio equivocado (o "sin tarifa" si
-- solo hay tarifas duración-específicas). Ahora resuelve el precio de la
-- duración real del turno fijo.
--
-- Firma SIN cambios (DATE, DATE); igual hago DROP + CREATE + re-GRANT (como
-- se pidió). NO se pierde NADA de lo que ya hace: gate admin/vendedor,
-- validación de rango (≤12 meses), loop por turno fijo activo vigente,
-- intersección de vigencias, cálculo de v_hora_fin, idempotencia (CHECK A +
-- captura de unique_violation), skip de clases solapadas (CHECK B), conteo
-- de slots_sin_tarifa, INSERT directo a reservas con turno_fijo_id +
-- titular, captura de exclusion_violation (choque con reserva suelta) sin
-- pisar, y los 5 contadores.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_materializar_turnos_fijos(DATE, DATE);

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
        -- ⭐ NUEVO 0051: pasamos v_tf.duracion_min como 3er arg para
        -- resolver la tarifa de la DURACIÓN del turno fijo (tarifa 2D).
        -- Antes se llamaba con 2 args (sin duración). El DEFAULT NULL de
        -- fn_resolver_tarifa mantenía compatibilidad, pero para tarifas
        -- 2D hay que pasar la duración real del turno.
        --
        -- Si NO hay tarifa → NO materializamos esta fecha. Se cuenta
        -- en v_sin_tarifa para que el admin sepa que tiene que
        -- configurar tarifa para ese slot. Generar reservas con
        -- monto_total=0 ensuciaría la proyección financiera y
        -- pasaría desapercibido — mejor no materializar y avisar.
        -- ──────────────────────────────────────────────────────────
        SELECT tarifa_id, monto INTO v_tarifa_resuelta
        FROM fn_resolver_tarifa(v_fecha, v_tf.hora_inicio, v_tf.duracion_min);

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

COMMENT ON FUNCTION fn_materializar_turnos_fijos(DATE, DATE) IS
  'Materializa reservas para el rango dado a partir de los turnos
   fijos activos del club. Idempotente (doble defensa: CHECK A en
   código + UNIQUE parcial). Resuelve tarifa por fecha Y DURACIÓN del
   turno fijo (0051: pasa duracion_min a fn_resolver_tarifa — respeta
   tarifas 2D, vigencias y aumentos programados). Captura choques con
   reservas sueltas (EXCLUDE no_overlap_reservas) sin pisarlas. Si no
   hay tarifa vigente que cubra el slot+fecha+duración, NO materializa
   esa fecha y la cuenta en slots_sin_tarifa. Retorna 5 contadores.
   Gate: admin O vendedor.';

GRANT EXECUTE ON FUNCTION fn_materializar_turnos_fijos(DATE, DATE)
  TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0051_tarifa_2d_duracion.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Columna + CHECK ----------
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name='tarifas' AND column_name='duracion_min';   → INTEGER, YES (nullable).
-- SELECT conname FROM pg_constraint WHERE conrelid='tarifas'::regclass
--   AND conname='tarifas_duracion_min_valida';                 → existe.

-- ---------- B. Retrocompat: tarifas existentes (duracion_min NULL) ----------
-- Con un club que solo tiene tarifas NULL:
--   SELECT * FROM fn_resolver_tarifa('2026-05-25','19:00:00');        (2 args)
--   SELECT * FROM fn_resolver_tarifa('2026-05-25','19:00:00', 90);    (3 args)
-- → ambas devuelven la MISMA tarifa que hoy (NULL aplica a cualquier duración).

-- ---------- C. Tarifa 2D: el caso del usuario ----------
-- Crear 3 franjas (como admin):
--   fn_crear_tarifa('Mañana 60', 22000, '07:30','14:30', NULL, 0, NULL, 60);
--   fn_crear_tarifa('Mañana 90', 32000, '07:30','14:30', NULL, 0, NULL, 90);
--   fn_crear_tarifa('Punta 90',  42000, '14:30','22:00', NULL, 0, NULL, 90);
-- Resolver:
--   fn_resolver_tarifa('2026-05-25','09:00:00', 60)  → 22000 (Mañana 60)
--   fn_resolver_tarifa('2026-05-25','09:00:00', 90)  → 32000 (Mañana 90)
--   fn_resolver_tarifa('2026-05-25','15:00:00', 90)  → 42000 (Punta 90)

-- ---------- D. Específica gana sobre NULL ----------
-- Con una "Mañana 90" (specific) + una "Tarifa única" (duracion_min NULL,
-- prioridad alta) que cubren el mismo slot:
--   fn_resolver_tarifa(fecha, '09:00:00', 90) → gana la "Mañana 90" (específica),
--   aunque la NULL tenga mayor prioridad.

-- ---------- E. Cambiar precio preserva la duración ----------
--   fn_cambiar_precio_tarifa(<lineage Mañana 90>, 35000, '2026-06-01');
--   SELECT vigente_desde, monto, duracion_min FROM tarifas
--     WHERE lineage_id=<...> ORDER BY vigente_desde;
-- → 2 filas, ambas duracion_min=90; la nueva monto=35000 desde 2026-06-01.

-- ---------- F. Editar metadata: cambiar/limpiar duración ----------
--   fn_actualizar_metadata_tarifa(p_lineage_id := <...>, p_duracion_min := 120);
--     → todas las versiones del linaje pasan a 120.
--   fn_actualizar_metadata_tarifa(p_lineage_id := <...>, p_clear_duracion := TRUE);
--     → todas las versiones del linaje pasan a NULL (cualquier duración).

-- ---------- G. Materialización de turnos fijos usa la duración ----------
-- Turno fijo de 90 min en franja "Mañana" con tarifas 2D:
--   fn_materializar_turnos_fijos('2026-05-26','2026-06-23');
-- → las reservas materializadas toman monto = tarifa de la duración 90
--   (32000), no la de 60. Si solo hubiera tarifa de 60, contaría en
--   slots_sin_tarifa (no materializa con precio equivocado).
-- ============================================================================
