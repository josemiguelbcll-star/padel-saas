-- ============================================================================
-- 0052_fix_lineage_temporal.sql
-- FIX del bug del lineage_id temporal en la creación de tarifas.
--
-- =====================================================================
-- EL BUG (preexistente desde 0029 / 0034)
-- =====================================================================
-- fn_crear_tarifa y fn_crear_tarifa_clase insertaban con un sentinel
-- temporal `lineage_id = 1` y después hacían UPDATE al id propio. Pero `1`
-- es un lineage_id REAL válido (el de la primera tarifa del club, porque
-- para la versión 0 lineage_id = id, y BIGSERIAL arranca en 1). Una vez
-- que el club posee la tarifa con id=1 (linaje 1) con vigencia abierta,
-- CUALQUIER alta posterior choca en el paso temporal contra el EXCLUDE
-- `tarifas_no_overlap_lineage` (club_id =, lineage_id =, daterange &&):
--   conflicting key value violates exclusion constraint
--   "tarifas_no_overlap_lineage"
-- Se destapó al crear varias tarifas seguidas (la 1ª planta el linaje 1,
-- la 2ª lo pisa). NO lo introdujo la 0051 (que solo agregó duracion_min;
-- el EXCLUDE ni mira esa columna).
--
-- =====================================================================
-- EL FIX (Opción A — nextval)
-- =====================================================================
-- Conocemos el id ANTES del INSERT con nextval() de la secuencia de cada
-- tabla, y lo usamos TAMBIÉN como lineage_id en el MISMO INSERT (id =
-- lineage_id = v_new_id). Se elimina el sentinel temporal y el UPDATE
-- posterior → nunca más colisión. Respeta el CHECK lineage_id > 0 (un id
-- de BIGSERIAL siempre es > 0). NO toca el EXCLUDE ni su semántica.
--
-- Las secuencias (tarifas_id_seq / tarifas_clases_id_seq) ya tienen
-- GRANT USAGE a authenticated (0003 / 0034) y las funciones son SECURITY
-- INVOKER → nextval() corre con permisos del caller. OK.
--
-- Firmas SIN cambios en ambas → CREATE OR REPLACE (conserva el GRANT).
-- Se reproducen ENTERAS para no perder nada (gate, validaciones —incluida
-- la de duración de la 0051 en fn_crear_tarifa—, vigencia, RETURN).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. fn_crear_tarifa (turnos) — nextval en vez de lineage temporal
-- ============================================================================
-- Igual que la versión 0051 (8 params, con p_duracion_min y su validación)
-- salvo el bloque de creación: nextval + INSERT único (sin UPDATE).
-- ============================================================================
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
  v_new_id BIGINT;
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

  -- 0051: validar duración si viene (NULL = cualquier duración).
  IF p_duracion_min IS NOT NULL
     AND p_duracion_min NOT IN (60, 90, 120, 150, 180, 240) THEN
    RAISE EXCEPTION 'Duración inválida. Usá 60, 90, 120, 150, 180 o 240, o dejala vacía (cualquier duración).';
  END IF;

  v_vigente_desde := COALESCE(p_vigente_desde, CURRENT_DATE);

  -- ⭐ FIX 0052: conocemos el id ANTES del INSERT (nextval) y lo usamos
  -- también como lineage_id en el MISMO INSERT (autoref directo). Adiós
  -- al sentinel temporal lineage_id=1 (que chocaba contra el linaje 1
  -- real vía el EXCLUDE) y al UPDATE posterior.
  v_new_id := nextval('tarifas_id_seq');

  INSERT INTO tarifas (
    id, club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id,
    duracion_min
  ) VALUES (
    v_new_id, v_club_id, TRIM(p_nombre), p_monto, p_desde_hora, p_hasta_hora,
    p_dias_semana, p_prioridad, TRUE,
    v_vigente_desde, NULL, v_new_id,     -- lineage_id = id propio
    p_duracion_min
  )
  RETURNING * INTO v_tarifa;

  RETURN v_tarifa;
END;
$$;

COMMENT ON FUNCTION fn_crear_tarifa(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE, INTEGER
) IS
  'Crea una franja de tarifa nueva (= linaje nuevo, versión 0). 0052:
   usa nextval(tarifas_id_seq) para setear id = lineage_id en un único
   INSERT (sin sentinel temporal ni UPDATE → no choca con el EXCLUDE).
   vigente_desde opcional (default hoy). p_duracion_min (0051): NULL =
   cualquier duración. Gate: admin del club.';

GRANT EXECUTE ON FUNCTION fn_crear_tarifa(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE, INTEGER
) TO authenticated;


-- ============================================================================
-- 2. fn_crear_tarifa_clase (clases) — mismo fix sobre tarifas_clases
-- ============================================================================
-- Idéntica a la versión 0034 (7 params, sin duracion_min — esa dimensión
-- es solo de `tarifas`) salvo el bloque de creación: nextval(
-- tarifas_clases_id_seq) + INSERT único (sin UPDATE).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_crear_tarifa_clase(
  p_nombre VARCHAR,
  p_monto DECIMAL,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT 0,
  p_vigente_desde DATE DEFAULT NULL
)
RETURNS tarifas_clases
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_tarifa tarifas_clases;
  v_vigente_desde DATE;
  v_new_id BIGINT;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear tarifas de clases.';
  END IF;

  IF p_nombre IS NULL OR LENGTH(TRIM(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  v_vigente_desde := COALESCE(p_vigente_desde, CURRENT_DATE);

  -- ⭐ FIX 0052: nextval + INSERT único con id = lineage_id (autoref),
  -- sin sentinel temporal ni UPDATE.
  v_new_id := nextval('tarifas_clases_id_seq');

  INSERT INTO tarifas_clases (
    id, club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_new_id, v_club_id, TRIM(p_nombre), p_monto, p_desde_hora, p_hasta_hora,
    p_dias_semana, p_prioridad, TRUE,
    v_vigente_desde, NULL, v_new_id      -- lineage_id = id propio
  )
  RETURNING * INTO v_tarifa;

  RETURN v_tarifa;
END;
$$;

COMMENT ON FUNCTION fn_crear_tarifa_clase(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
) IS
  'Crea una franja de tarifa de clase nueva (= linaje nuevo, versión 0).
   0052: usa nextval(tarifas_clases_id_seq) para setear id = lineage_id
   en un único INSERT (sin sentinel temporal ni UPDATE → no choca con el
   EXCLUDE de linaje). Gate: admin del club.';

GRANT EXECUTE ON FUNCTION fn_crear_tarifa_clase(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0052_fix_lineage_temporal.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Crear 3 tarifas seguidas (lo que fallaba) ----------
-- Como admin, las 3 franjas del caso 2D:
--   SELECT fn_crear_tarifa('Mañana 60', 22000, '07:30','14:30', NULL, 0, NULL, 60);
--   SELECT fn_crear_tarifa('Mañana 90', 32000, '07:30','14:30', NULL, 0, NULL, 90);
--   SELECT fn_crear_tarifa('Punta 90',  42000, '14:30','22:00', NULL, 0, NULL, 90);
-- → las 3 se crean OK (ya no choca el EXCLUDE).
-- → SELECT id, lineage_id, nombre FROM tarifas ORDER BY id DESC LIMIT 3;
--   cada fila con lineage_id = id (autoref, distintos entre sí).

-- ---------- B. Idem clases ----------
--   SELECT fn_crear_tarifa_clase('Mañana', 10000, '08:00','14:00', NULL, 0, NULL);
--   SELECT fn_crear_tarifa_clase('Noche',  12000, '18:00','23:00', NULL, 0, NULL);
-- → ambas OK; lineage_id = id en cada una.

-- ---------- C. El versionado de precio sigue intacto ----------
--   SELECT fn_cambiar_precio_tarifa(<lineage de 'Mañana 90'>, 35000, '2026-06-01');
-- → cierra la versión vigente + crea la nueva con mismo lineage_id,
--   duracion_min=90 preservada (0051). El EXCLUDE garantiza no-solape.

-- ---------- D. Secuencia coherente ----------
-- nextval avanza la secuencia igual que el DEFAULT implícito; no quedan
-- huecos problemáticos ni ids duplicados (id se setea explícito = nextval).
-- ============================================================================
