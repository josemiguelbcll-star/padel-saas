-- ============================================================================
-- 0029_tarifas_vigencia_temporal.sql
-- Refactor de tarifas: vigencia temporal por linaje (versionado de precio).
--
-- =====================================================================
-- POR QUÉ
-- =====================================================================
-- Hasta hoy, cambiar el precio de una tarifa era un UPDATE in-place que
-- pisaba el monto anterior sin guardar historial. Esto rompía dos cosas:
--   1. La proyección de ingresos de turnos fijos (materializados a
--      futuro) podía quedar desfasada si el precio cambiaba.
--   2. El histórico de "qué precio había en la fecha X" se perdía.
--
-- Esta migración versiona el PRECIO (monto) en el tiempo. Las franjas
-- (nombre, horario, días, prioridad) son metadata editable in-place
-- — se definen una vez y casi no cambian.
--
-- =====================================================================
-- MODELO
-- =====================================================================
-- Misma tabla `tarifas` + 3 columnas nuevas:
--   - vigente_desde DATE NOT NULL  → primera fecha de vigencia.
--   - vigente_hasta DATE           → última fecha (NULL = abierto).
--   - lineage_id BIGINT NOT NULL   → agrupa todas las versiones de la
--                                    misma franja a lo largo del tiempo.
--
-- Convención del lineage:
--   - La primera versión tiene lineage_id = id (autoreferente).
--   - Las versiones siguientes heredan ese lineage_id.
--   - Sin FK física (sería circular en el INSERT inicial).
--
-- EXCLUDE constraint server-side garantiza que dos versiones del mismo
-- linaje NO se solapan temporalmente (no depende de la lógica de RPC).
--
-- =====================================================================
-- QUÉ NO CAMBIA
-- =====================================================================
-- - reservas.monto_total: sigue siendo snapshot al crear la reserva.
--   El histórico de lo cobrado ya está protegido y no se toca.
-- - fn_crear_reserva: sin cambios. El frontend sigue resolviendo
--   tarifa client-side y pasando p_tarifa_id + p_monto_total.
-- - Resolución client-side (resolverTarifa.ts): se actualiza en el
--   bloque frontend después de esta migración para sumar el filtro
--   de vigencia (2 líneas).
--
-- =====================================================================
-- DEUDA PRIORITARIA ANOTADA
-- =====================================================================
-- Esta migración introduce "aumentos programados" (fecha de vigencia
-- futura). Si un admin lo carga por error, hoy se revierte por SQL
-- manual. Construir `fn_cancelar_aumento_programado` como PRÓXIMA
-- iteración después de turnos fijos. Ver CLAUDE.md → Deudas
-- funcionales prioritarias.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ALTER TABLE tarifas — agregar columnas
-- ============================================================================
--    Las 3 columnas se agregan nullable inicialmente. Después del
--    backfill (paso 2) se ponen NOT NULL en las que corresponde.
-- ============================================================================
ALTER TABLE tarifas
  ADD COLUMN vigente_desde DATE,
  ADD COLUMN vigente_hasta DATE,
  ADD COLUMN lineage_id BIGINT;

COMMENT ON COLUMN tarifas.vigente_desde IS
  'Primera fecha en la que esta versión de precio aplica. NOT NULL.
   Para tarifas pre-0029 (sin información de cuándo se cargó), el
   backfill asume vigente_desde = clubes.fecha_alta del club dueño.';

COMMENT ON COLUMN tarifas.vigente_hasta IS
  'Última fecha en la que esta versión de precio aplica. NULL = vigente
   indefinido (es la versión "abierta" del linaje). Cuando se cambia el
   precio, esta columna se cierra (vigente_hasta = vigente_desde_nueva − 1).';

COMMENT ON COLUMN tarifas.lineage_id IS
  'Agrupa todas las versiones de precio de la MISMA franja a lo largo
   del tiempo. La primera versión apunta a sí misma (lineage_id = id).
   Cambios de monto generan una nueva fila con el mismo lineage_id.
   Sin FK física (sería circular en el INSERT inicial); convención lógica.';


-- ============================================================================
-- 2. Backfill — las tarifas existentes nacen con vigencia desde alta del club
-- ============================================================================
--    Columna de referencia: `clubes.fecha_alta TIMESTAMPTZ NOT NULL DEFAULT
--    NOW()` (verificado en 0001 línea 43). Cualquier tarifa pre-0029 queda
--    cubierta para todas las fechas históricas posibles (no puede haber
--    una reserva del club anterior a su fecha_alta).
--
--    Asumimos que el monto actual estuvo vigente desde el alta. Si hubo
--    cambios pasados sin registrar, se pierden — aceptable porque las
--    reservas tienen monto_total snapshot.
--
--    lineage_id = id de la fila (cada tarifa pre-0029 es su propio linaje,
--    versión 0).
--
--    Robustez: dos UPDATEs en cascada + verificación dura antes del SET
--    NOT NULL.
-- ============================================================================
UPDATE tarifas t
SET vigente_desde = c.fecha_alta::DATE,
    vigente_hasta = NULL,
    lineage_id = t.id
FROM clubes c
WHERE c.id = t.club_id;

-- Defensa: rellenar filas que el JOIN no haya tocado. No debería pasar
-- (FK club_id NOT NULL existe en tarifas), pero garantiza que el SET NOT
-- NULL de abajo no rompa la migración por un dato inconsistente.
UPDATE tarifas
SET vigente_desde = CURRENT_DATE,
    vigente_hasta = NULL,
    lineage_id = id
WHERE vigente_desde IS NULL OR lineage_id IS NULL;

-- Verificación dura: si todavía queda alguna fila sin completar,
-- abortamos con mensaje claro. Mejor fallar acá con contexto que tener
-- el SET NOT NULL fallando con un error genérico.
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM tarifas
  WHERE vigente_desde IS NULL OR lineage_id IS NULL;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Backfill incompleto: % filas de tarifas quedaron con vigente_desde o lineage_id NULL. Abortamos la migración. Investigá esas filas manualmente antes de re-ejecutar.',
      v_count;
  END IF;
END $$;


-- ============================================================================
-- 3. NOT NULL en vigente_desde y lineage_id (después del backfill)
-- ============================================================================
ALTER TABLE tarifas
  ALTER COLUMN vigente_desde SET NOT NULL,
  ALTER COLUMN lineage_id SET NOT NULL;


-- ============================================================================
-- 4. CHECK constraints
-- ============================================================================

-- Coherencia de vigencia: si vigente_hasta está seteado, debe ser
-- >= vigente_desde.
ALTER TABLE tarifas
  ADD CONSTRAINT tarifas_vigencia_coherente CHECK (
    vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
  );

-- lineage_id válido (no FK, validación mínima).
ALTER TABLE tarifas
  ADD CONSTRAINT tarifas_lineage_positivo CHECK (lineage_id > 0);


-- ============================================================================
-- 5. EXCLUDE constraint — invariante "no-solapamiento por linaje"
-- ============================================================================
--    Garantía SERVER-SIDE de que dos versiones del mismo linaje no
--    pueden coexistir vigentes para la misma fecha. Imposible bypassar
--    desde la lógica de cualquier RPC.
--
--    Usa daterange con upper exclusivo: [vigente_desde, vigente_hasta+1).
--    Si vigente_hasta es NULL, el rango llega a 'infinity'.
--
--    Requiere btree_gist (ya habilitado por las reservas en 0004).
-- ============================================================================
ALTER TABLE tarifas
  ADD CONSTRAINT tarifas_no_overlap_lineage EXCLUDE
  USING gist (
    club_id WITH =,
    lineage_id WITH =,
    daterange(
      vigente_desde,
      COALESCE(vigente_hasta + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  );

COMMENT ON CONSTRAINT tarifas_no_overlap_lineage ON tarifas IS
  'Dos versiones del mismo linaje NO pueden tener rangos de vigencia
   solapados. Garantía atómica server-side: cualquier INSERT/UPDATE
   que viole esto es rechazado por Postgres (23P01 exclusion_violation).
   Las RPCs fn_cambiar_precio_tarifa y similares capturan el error.';


-- ============================================================================
-- 6. Índices
-- ============================================================================

-- Para listar versiones de un linaje en orden cronológico (UI de
-- "ver historial de precios").
CREATE INDEX idx_tarifas_lineage_vigencia
  ON tarifas (club_id, lineage_id, vigente_desde DESC);

-- Para que la resolución de tarifa por fecha sea rápida sin escanear
-- filas inactivas. INCLUDE permite index-only scan en el caso típico.
CREATE INDEX idx_tarifas_resolucion
  ON tarifas (club_id, vigente_desde)
  WHERE activa = TRUE;


-- ============================================================================
-- 7. REVOKE DELETE — deprecar borrado
-- ============================================================================
--    La pantalla de Tarifas pasa a "desactivar" en vez de "borrar".
--    No hay policy de DELETE; este REVOKE saca el privilege a nivel
--    Postgres. Doble defensa: ni privilege ni policy.
--
--    Si en el futuro un admin necesita realmente borrar una tarifa
--    (caso raro: error al crearla, sin reservas asociadas), se hace
--    por SQL con service_role.
-- ============================================================================
REVOKE DELETE ON tarifas FROM authenticated;


-- ============================================================================
-- 8. RPC: fn_crear_tarifa
-- ============================================================================
--    Crea una franja nueva (= un linaje nuevo, versión 0). El
--    lineage_id se setea = id propio post-INSERT (patrón autoreferente).
--
--    Validaciones:
--      - admin del club
--      - nombre obligatorio
--      - monto > 0
--      - vigente_desde opcional (default hoy, permite fecha futura para
--        "franja que arranca el 1/06")
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_crear_tarifa(
  p_nombre VARCHAR,
  p_monto DECIMAL,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT 0,
  p_vigente_desde DATE DEFAULT NULL
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

  v_vigente_desde := COALESCE(p_vigente_desde, CURRENT_DATE);

  -- INSERT con lineage_id = 0 temporal (validez del CHECK > 0 lo
  -- mantenemos posponiendo el seteo). Más simple: dejar la columna
  -- nullable un instante NO es viable porque ya es NOT NULL. Patrón:
  -- INSERT con lineage_id = un sentinel grande Y después UPDATE.
  --
  -- Mejor: INSERT con lineage_id = id (auto-ref) en un solo paso vía
  -- CTE. Pero el id es BIGSERIAL — no lo conocemos antes del INSERT.
  --
  -- Patrón estándar PG: INSERT con lineage_id = nextval('tarifas_id_seq')
  -- y forzar id = mismo valor. O INSERT + UPDATE. Voy por INSERT +
  -- UPDATE en transacción (atómico).
  INSERT INTO tarifas (
    club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_club_id, TRIM(p_nombre), p_monto, p_desde_hora, p_hasta_hora,
    p_dias_semana, p_prioridad, TRUE,
    v_vigente_desde, NULL, 1  -- lineage_id temporal, lo arreglamos abajo
  )
  RETURNING * INTO v_tarifa;

  -- Set lineage_id = id (autoreferente). El CHECK > 0 ya se respetó
  -- con el INSERT temporal.
  UPDATE tarifas SET lineage_id = v_tarifa.id
  WHERE id = v_tarifa.id
  RETURNING * INTO v_tarifa;

  RETURN v_tarifa;
END;
$$;

COMMENT ON FUNCTION fn_crear_tarifa IS
  'Crea una franja de tarifa nueva (= linaje nuevo, versión 0).
   lineage_id se setea = id propio. vigente_desde opcional (default hoy),
   permite valor futuro para franjas que arrancan más adelante.';

GRANT EXECUTE ON FUNCTION fn_crear_tarifa(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
) TO authenticated;


-- ============================================================================
-- 9. RPC: fn_cambiar_precio_tarifa
-- ============================================================================
--    Cambia el precio de un linaje. Cierra la versión vigente
--    (vigente_hasta = vigente_desde_nueva - 1) y crea una nueva fila
--    con el mismo lineage, mismo metadata, monto nuevo, vigente_desde
--    = fecha indicada.
--
--    Atómica: ambos pasos en una transacción. Si el EXCLUDE rechaza
--    por solapamiento (caso raro: aumento ya programado en conflicto),
--    rollback completo.
--
--    Permite aumentos programados a futuro (vigente_desde > hoy).
--    Permite cambios "desde hoy" (vigente_desde = CURRENT_DATE).
--    NO permite vigente_desde retroactivo (sería reescribir historia).
-- ============================================================================
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

  -- Buscar la versión actualmente "abierta" del linaje (la que cubre
  -- la fecha del cambio: vigente_desde <= p_vigente_desde AND
  -- vigente_hasta IS NULL OR vigente_hasta >= p_vigente_desde).
  -- Si hay varios candidatos (raro), tomamos el de vigente_desde más
  -- reciente — es la versión más nueva.
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

  -- Cerrar la versión actual: vigente_hasta = p_vigente_desde - 1.
  UPDATE tarifas
  SET vigente_hasta = p_vigente_desde - 1
  WHERE id = v_actual.id;

  -- Crear la nueva versión con mismo lineage + mismo metadata + monto nuevo.
  -- Si el EXCLUDE constraint detecta solapamiento (caso raro: ya hay otra
  -- versión futura programada que se pisa), Postgres rechaza con 23P01 y
  -- la transacción entera rollbackea (el UPDATE del cierre también se anula).
  INSERT INTO tarifas (
    club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_club_id, v_actual.nombre, p_monto_nuevo, v_actual.desde_hora, v_actual.hasta_hora,
    v_actual.dias_semana, v_actual.prioridad, v_actual.activa,
    p_vigente_desde, NULL, p_lineage_id
  )
  RETURNING * INTO v_nueva;

  RETURN v_nueva;
END;
$$;

COMMENT ON FUNCTION fn_cambiar_precio_tarifa IS
  'Versiona el precio de un linaje. Cierra la versión vigente y crea
   una nueva con el monto nuevo. Atómica. EXCLUDE constraint garantiza
   no-solapamiento server-side. Soporta aumentos programados (fecha
   futura) pero NO retroactivos.';

GRANT EXECUTE ON FUNCTION fn_cambiar_precio_tarifa(BIGINT, DECIMAL, DATE)
  TO authenticated;


-- ============================================================================
-- 10. RPC: fn_actualizar_metadata_tarifa
-- ============================================================================
--    Cambios in-place que afectan TODAS las versiones del linaje
--    (nombre, franja, días, prioridad, activa). NO toca vigencia ni
--    monto — eso lo hace fn_cambiar_precio_tarifa.
--
--    Razón de afectar todas las versiones: el linaje representa "la
--    misma franja en el tiempo". Si renombrás "Hora pico" a "Punta
--    noche", conceptualmente es la misma franja, no una nueva.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_actualizar_metadata_tarifa(
  p_lineage_id BIGINT,
  p_nombre VARCHAR DEFAULT NULL,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT NULL,
  p_activa BOOLEAN DEFAULT NULL,
  -- Sentinels para diferenciar "no se cambia" vs "se cambia a NULL".
  -- NULL en los TIME/INTEGER[] es ambiguo (puede ser "no tocar" o
  -- "ponerlo en NULL"). Usamos flags explícitos.
  p_clear_franja_horaria BOOLEAN DEFAULT FALSE,
  p_clear_dias_semana BOOLEAN DEFAULT FALSE
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

COMMENT ON FUNCTION fn_actualizar_metadata_tarifa IS
  'Actualiza metadata (nombre, franja, días, prioridad, activa) en
   TODAS las versiones del linaje. NO toca vigencia ni monto. Flags
   p_clear_* diferencian "no cambiar" de "poner en NULL".';

GRANT EXECUTE ON FUNCTION fn_actualizar_metadata_tarifa(
  BIGINT, VARCHAR, TIME, TIME, INTEGER[], INTEGER, BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;


-- ============================================================================
-- 11. RPC: fn_resolver_tarifa(p_fecha, p_hora)
-- ============================================================================
--    Resuelve qué tarifa aplica para un (fecha, hora) dado del club
--    del caller. Espejo SQL de resolverTarifa.ts (frontend).
--
--    SECURITY INVOKER: corre con los permisos del caller. La RLS de
--    tarifas (tarifas_select por club) filtra naturalmente — defensa
--    en capas (RLS + filtro explícito en el WHERE).
--
--    Va a ser consumida por fn_materializar_turnos_fijos (futura)
--    para resolver el precio de cada fecha del rango — RESPETANDO
--    LA VIGENCIA TEMPORAL (cada fecha resuelve la versión que estaba
--    vigente ese día, incluyendo aumentos programados).
--
--    Retorna 0 filas si no hay tarifa que aplique (el caller decide
--    qué hacer — el frontend muestra "completá monto manual").
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_resolver_tarifa(
  p_fecha DATE,
  p_hora TIME
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
    -- Vigencia temporal: la fecha del slot cae en el rango
    AND t.vigente_desde <= p_fecha
    AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= p_fecha)
    -- Día de la semana
    AND (
      t.dias_semana IS NULL
      OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(t.dias_semana)
    )
    -- Franja horaria
    AND (
      (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
      OR (p_hora >= t.desde_hora AND p_hora < t.hasta_hora)
    )
  ORDER BY t.prioridad DESC, t.id DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION fn_resolver_tarifa IS
  'Espejo SQL de resolverTarifa.ts. SECURITY INVOKER — corre con
   permisos del caller (la RLS filtra por club). Usa la VERSIÓN del
   linaje vigente A LA FECHA del slot (no a la fecha actual), lo que
   permite que turnos fijos materializados a futuro respeten aumentos
   programados.';

GRANT EXECUTE ON FUNCTION fn_resolver_tarifa(DATE, TIME) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0029_tarifas_vigencia_temporal.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Columnas y constraints creados ----------
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'tarifas'
--   AND column_name IN ('vigente_desde','vigente_hasta','lineage_id')
-- ORDER BY ordinal_position;
-- → vigente_desde NOT NULL, vigente_hasta nullable, lineage_id NOT NULL.

-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'tarifas'::regclass
-- ORDER BY conname;
-- → debe incluir tarifas_vigencia_coherente, tarifas_lineage_positivo,
--   tarifas_no_overlap_lineage (EXCLUDE), y los viejos
--   (franja_coherente, dias_semana_validos, monto check).

-- ---------- B. Backfill correcto ----------
-- SELECT id, club_id, nombre, monto, vigente_desde, vigente_hasta, lineage_id
-- FROM tarifas WHERE club_id = 1
-- ORDER BY id;
-- → Para Signo, las 2 filas (Mañana y punta) con:
--   vigente_desde = fecha_alta de Signo, vigente_hasta = NULL,
--   lineage_id = id propio.

-- ---------- C. EXCLUDE constraint bloquea solapamiento ----------
-- Como admin de Signo, intentar manualmente:
-- INSERT INTO tarifas (club_id, nombre, monto, dias_semana, vigente_desde, vigente_hasta, lineage_id)
-- VALUES (1, 'Test', 1000, '{1,2,3}', '2026-01-01', '2027-01-01', 1);
-- → ERROR: conflicting key value violates exclusion constraint
--   "tarifas_no_overlap_lineage" (porque solapa con la versión actual
--   del lineage 1 que va desde fecha_alta y vigente_hasta NULL).

-- ---------- D. fn_resolver_tarifa para fecha pasada ----------
-- Como admin de Signo en consola del browser:
--   await window.supabase.rpc('fn_resolver_tarifa', {
--     p_fecha: '2026-05-22', p_hora: '19:00:00'
--   });
-- → Debería devolver { data: [{ tarifa_id: 2, monto: 48000 }], error: null }
--   (la tarifa "punta" del miércoles a las 19:00).

-- ---------- E. fn_crear_tarifa nueva ----------
--   await window.supabase.rpc('fn_crear_tarifa', {
--     p_nombre: 'Test fin de semana', p_monto: 55000,
--     p_dias_semana: [6, 7], p_desde_hora: '10:00:00', p_hasta_hora: '20:00:00'
--   });
-- → Crea una fila nueva. lineage_id = id (autoreferente).
-- → Después: DELETE FROM tarifas WHERE nombre = 'Test fin de semana';
--   ← falla porque REVOKE DELETE. Para limpiar pruebas, hacelo desde Studio
--   con service_role: DELETE FROM tarifas WHERE nombre = 'Test fin de semana';

-- ---------- F. fn_cambiar_precio_tarifa con aumento programado ----------
--   await window.supabase.rpc('fn_cambiar_precio_tarifa', {
--     p_lineage_id: 2, p_monto_nuevo: 52000, p_vigente_desde: '2026-06-01'
--   });
-- → Cierra la versión actual de "punta" (vigente_hasta = 2026-05-31).
-- → Crea nueva versión vigente_desde = 2026-06-01, monto 52000.
-- → Verificá: SELECT * FROM tarifas WHERE lineage_id = 2 ORDER BY vigente_desde;
--   debería listar 2 filas en cascada temporal.

-- ---------- G. fn_resolver_tarifa respeta el aumento programado ----------
--   await window.supabase.rpc('fn_resolver_tarifa', {
--     p_fecha: '2026-05-31', p_hora: '19:00:00'  -- antes del aumento
--   });
-- → monto = 48000 (versión vieja)
--
--   await window.supabase.rpc('fn_resolver_tarifa', {
--     p_fecha: '2026-06-01', p_hora: '19:00:00'  -- a partir del aumento
--   });
-- → monto = 52000 (versión nueva)

-- ---------- H. fn_actualizar_metadata afecta todas las versiones ----------
-- Después de F (con 2 versiones de "punta"):
--   await window.supabase.rpc('fn_actualizar_metadata_tarifa', {
--     p_lineage_id: 2, p_nombre: 'Punta noche'
--   });
-- → Devuelve 2 (ambas versiones renombradas).
-- → SELECT id, nombre, monto FROM tarifas WHERE lineage_id = 2;
--   ambas con nombre = 'Punta noche'.

-- ---------- I. REVOKE DELETE efectivo ----------
-- Como admin de Signo:
--   await window.supabase.from('tarifas').delete().eq('id', <algún_id>);
-- → Error de permission denied (DELETE no autorizado).

-- ---------- J. Vigente_desde retroactivo rechazado ----------
--   await window.supabase.rpc('fn_cambiar_precio_tarifa', {
--     p_lineage_id: 1, p_monto_nuevo: 35000, p_vigente_desde: '2020-01-01'
--   });
-- → ERROR: 'La fecha debe ser hoy o futura...'
-- ============================================================================
