-- ============================================================================
-- 0034_tarifas_clases.sql
-- Tabla NUEVA tarifas_clases — tarifas de alquiler de cancha para clases.
-- Separadas de las tarifas de turnos (tabla `tarifas` ya existente, 0029).
--
-- =====================================================================
-- CONTEXTO DE NEGOCIO
-- =====================================================================
-- En este club, el profesor cobra a los alumnos directamente — el club
-- NO recibe ese dinero. El club solo cobra el ALQUILER DE LA CANCHA al
-- profe por usar la cancha para dar la clase. El precio del alquiler de
-- una clase es distinto al precio de un turno suelto (ej. $10.000/60min
-- para clases vs $48.000/90min para turnos).
--
-- Esta migración crea el MODELO + RPCs para que el admin cargue las
-- tarifas_clases. NO modifica fn_cobrar_clase ni clases.precio (eso es
-- parte del replanteo de Clases anotado en CLAUDE.md como 🟠 deuda
-- prioritaria). El módulo aporta el modelo listo para cuando se haga
-- el cableado posterior.
--
-- =====================================================================
-- PATRÓN — IDÉNTICO A 0029 (tarifas de turnos)
-- =====================================================================
-- Misma estructura: lineage_id agrupa versiones de precio de la misma
-- franja a lo largo del tiempo. vigente_desde/hasta define el rango.
-- EXCLUDE server-side garantiza no-solapamiento por linaje. Soporta
-- aumentos programados (fecha futura). NO permite retroactivos.
--
-- Sin DELETE policy — se desactiva (activo=FALSE), no se borra.
-- Sin cancha_id — las tarifas son por club (igual que tarifas de turnos).
--
-- =====================================================================
-- LAS 4 RPCs
-- =====================================================================
-- fn_crear_tarifa_clase           — admin, INSERT con autoref lineage_id
-- fn_cambiar_precio_tarifa_clase  — admin, versiona (cierra + crea atómico)
-- fn_actualizar_metadata_tarifa_clase — admin, UPDATE in-place todas las versiones
-- fn_resolver_tarifa_clase        — INVOKER+STABLE, espejo SQL del client
--
-- Todas SECURITY INVOKER (defensa en capas: RLS sigue filtrando).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: tarifas_clases
-- ============================================================================
CREATE TABLE tarifas_clases (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(80) NOT NULL,
  monto DECIMAL(12,2) NOT NULL CHECK (monto >= 0),
  desde_hora TIME,
  hasta_hora TIME,
  dias_semana INTEGER[],
  prioridad INTEGER NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  lineage_id BIGINT NOT NULL DEFAULT 1
);

COMMENT ON TABLE tarifas_clases IS
  'Tarifas de ALQUILER DE CANCHA para clases. Separadas de la tabla
   `tarifas` (que es para turnos sueltos / turnos fijos). En este club
   el profe cobra a los alumnos directamente; el club solo cobra al
   profe el alquiler de la cancha donde da la clase.';

COMMENT ON COLUMN tarifas_clases.vigente_desde IS
  'Primera fecha en la que esta versión de precio aplica. NOT NULL.
   Como la tabla nace vacía (sin backfill), no hay tarifas pre-0034.';

COMMENT ON COLUMN tarifas_clases.vigente_hasta IS
  'Última fecha en la que esta versión de precio aplica. NULL = vigente
   indefinido (es la versión "abierta" del linaje). Cuando se cambia el
   precio, esta columna se cierra (vigente_hasta = vigente_desde_nueva − 1).';

COMMENT ON COLUMN tarifas_clases.lineage_id IS
  'Agrupa todas las versiones de precio de la MISMA franja de clase a lo
   largo del tiempo. La primera versión apunta a sí misma (lineage_id =
   id). Cambios de monto generan una nueva fila con el mismo lineage_id.
   Sin FK física (sería circular en el INSERT inicial); convención lógica.';

COMMENT ON COLUMN tarifas_clases.prioridad IS
  'Cuando dos franjas aplican al mismo slot, gana la de mayor número.';

COMMENT ON COLUMN tarifas_clases.dias_semana IS
  'Array de días donde aplica. 1=lunes, 7=domingo. NULL = todos los días.';


-- ============================================================================
-- 2. CHECK constraints
-- ============================================================================

-- Si desde_hora o hasta_hora están, ambos deben estar y hasta > desde.
-- (Permitimos que ambos sean NULL para "tarifa única para todo".)
ALTER TABLE tarifas_clases
  ADD CONSTRAINT tarifas_clases_franja_coherente CHECK (
    (desde_hora IS NULL AND hasta_hora IS NULL)
    OR (desde_hora IS NOT NULL AND hasta_hora IS NOT NULL AND hasta_hora > desde_hora)
  );

-- Cada elemento del array debe estar entre 1 y 7.
ALTER TABLE tarifas_clases
  ADD CONSTRAINT tarifas_clases_dias_semana_validos CHECK (
    dias_semana IS NULL
    OR (
      array_length(dias_semana, 1) BETWEEN 1 AND 7
      AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
    )
  );

-- Coherencia de vigencia: si vigente_hasta está seteado, debe ser >=
-- vigente_desde.
ALTER TABLE tarifas_clases
  ADD CONSTRAINT tarifas_clases_vigencia_coherente CHECK (
    vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
  );

-- lineage_id válido (no FK física, validación mínima). El default = 1
-- en la columna permite el INSERT autoreferente: la fn_crear_tarifa_clase
-- inserta con lineage_id=1 (sentinel temporal que cumple > 0) y después
-- UPDATE lineage_id = id propio.
ALTER TABLE tarifas_clases
  ADD CONSTRAINT tarifas_clases_lineage_positivo CHECK (lineage_id > 0);


-- ============================================================================
-- 3. EXCLUDE constraint — invariante "no-solapamiento por linaje"
-- ============================================================================
--    Garantía SERVER-SIDE de que dos versiones del mismo linaje no
--    pueden coexistir vigentes para la misma fecha. Imposible bypassar
--    desde lógica de cualquier RPC. Idéntico al de 0029 (tarifas).
--
--    Requiere btree_gist (ya habilitado desde 0004).
-- ============================================================================
ALTER TABLE tarifas_clases
  ADD CONSTRAINT tarifas_clases_no_overlap_lineage EXCLUDE
  USING gist (
    club_id WITH =,
    lineage_id WITH =,
    daterange(
      vigente_desde,
      COALESCE(vigente_hasta + 1, 'infinity'::date),
      '[)'
    ) WITH &&
  );

COMMENT ON CONSTRAINT tarifas_clases_no_overlap_lineage ON tarifas_clases IS
  'Dos versiones del mismo linaje NO pueden tener rangos de vigencia
   solapados. Garantía atómica server-side: cualquier INSERT/UPDATE
   que viole esto es rechazado por Postgres (23P01 exclusion_violation).
   Las RPCs fn_cambiar_precio_tarifa_clase y similares capturan el error.';


-- ============================================================================
-- 4. Índices
-- ============================================================================

-- Para listar versiones de un linaje en orden cronológico (UI de "ver
-- historial de precios").
CREATE INDEX idx_tarifas_clases_lineage_vigencia
  ON tarifas_clases (club_id, lineage_id, vigente_desde DESC);

-- Para que la resolución de tarifa por fecha sea rápida sin escanear
-- filas inactivas.
CREATE INDEX idx_tarifas_clases_resolucion
  ON tarifas_clases (club_id, vigente_desde)
  WHERE activa = TRUE;


-- ============================================================================
-- 5. RLS + policies
-- ============================================================================
--    Mismo patrón que tarifas (0003+0029):
--      SELECT  — todos los authenticated del club.
--      INSERT  — solo admin del club, con WITH CHECK.
--      UPDATE  — solo admin del club, USING + WITH CHECK.
--      (Sin DELETE policy — se desactiva, no se borra.)
-- ============================================================================
ALTER TABLE tarifas_clases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tarifas_clases_select_propio_club"
ON tarifas_clases FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "tarifas_clases_insert_admin"
ON tarifas_clases FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "tarifas_clases_update_admin"
ON tarifas_clases FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 6. GRANTs + REVOKE DELETE
-- ============================================================================
--    El patrón "deprecar borrado, usar desactivar" desde la 0029. Sin
--    GRANT DELETE; el rol authenticated puede recibir DELETE por default
--    privileges del proyecto (deuda anotada en CLAUDE.md), así que el
--    REVOKE explícito lo blinda. Doble defensa: ni privilege ni policy.
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON tarifas_clases TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE tarifas_clases_id_seq TO authenticated;

REVOKE DELETE ON tarifas_clases FROM authenticated;


-- ============================================================================
-- 7. RPC: fn_crear_tarifa_clase
-- ============================================================================
--    Crea una franja nueva (= linaje nuevo, versión 0). lineage_id se
--    setea = id propio post-INSERT (patrón autoreferente). Idéntico
--    diseño a fn_crear_tarifa de 0029.
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

  -- INSERT con lineage_id=1 sentinel (cumple CHECK > 0) + UPDATE
  -- post-insert para setear lineage_id = id. Atómico (misma transacción).
  INSERT INTO tarifas_clases (
    club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_club_id, TRIM(p_nombre), p_monto, p_desde_hora, p_hasta_hora,
    p_dias_semana, p_prioridad, TRUE,
    v_vigente_desde, NULL, 1
  )
  RETURNING * INTO v_tarifa;

  UPDATE tarifas_clases
  SET lineage_id = v_tarifa.id
  WHERE id = v_tarifa.id
  RETURNING * INTO v_tarifa;

  RETURN v_tarifa;
END;
$$;

COMMENT ON FUNCTION fn_crear_tarifa_clase IS
  'Crea una franja de tarifa de clase nueva (= linaje nuevo, versión 0).
   lineage_id se setea = id propio post-insert. vigente_desde opcional
   (default hoy), permite valor futuro para franjas que arrancan más
   adelante. Espejo de fn_crear_tarifa de 0029.';

GRANT EXECUTE ON FUNCTION fn_crear_tarifa_clase(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
) TO authenticated;


-- ============================================================================
-- 8. RPC: fn_cambiar_precio_tarifa_clase
-- ============================================================================
--    Versiona el precio de un linaje. Cierra la versión vigente y crea
--    una nueva atómicamente. Soporta aumentos programados (fecha futura),
--    rechaza retroactivos. Idéntico a fn_cambiar_precio_tarifa de 0029.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cambiar_precio_tarifa_clase(
  p_lineage_id BIGINT,
  p_monto_nuevo DECIMAL,
  p_vigente_desde DATE
)
RETURNS tarifas_clases
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_actual tarifas_clases;
  v_nueva tarifas_clases;
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

  -- Lock + buscar versión vigente del linaje que cubre la fecha del cambio.
  SELECT * INTO v_actual
  FROM tarifas_clases
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
    RAISE EXCEPTION 'El precio nuevo es igual al actual ($%). No tiene sentido versionar.',
      v_actual.monto;
  END IF;

  IF v_actual.vigente_desde = p_vigente_desde THEN
    RAISE EXCEPTION
      'Ya hay una versión vigente desde el % con monto $%. Para corregirla, cancelá el aumento programado (deuda v2 — hoy se hace por SQL).',
      v_actual.vigente_desde, v_actual.monto;
  END IF;

  -- Cerrar la versión actual: vigente_hasta = p_vigente_desde - 1.
  UPDATE tarifas_clases
  SET vigente_hasta = p_vigente_desde - 1
  WHERE id = v_actual.id;

  -- Crear la nueva versión con mismo lineage + mismo metadata + monto nuevo.
  -- Si el EXCLUDE constraint detecta solapamiento (caso raro: ya hay otra
  -- versión futura programada que se pisa), Postgres rechaza con 23P01 y
  -- la transacción entera rollbackea (el UPDATE del cierre también se anula).
  INSERT INTO tarifas_clases (
    club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_club_id, v_actual.nombre, p_monto_nuevo,
    v_actual.desde_hora, v_actual.hasta_hora,
    v_actual.dias_semana, v_actual.prioridad, v_actual.activa,
    p_vigente_desde, NULL, p_lineage_id
  )
  RETURNING * INTO v_nueva;

  RETURN v_nueva;
END;
$$;

COMMENT ON FUNCTION fn_cambiar_precio_tarifa_clase IS
  'Versiona el precio de un linaje de tarifa de clase. Cierra la versión
   vigente y crea una nueva con el monto nuevo. Atómica. EXCLUDE
   constraint garantiza no-solapamiento server-side. Soporta aumentos
   programados (fecha futura) pero NO retroactivos. Espejo de
   fn_cambiar_precio_tarifa de 0029.';

GRANT EXECUTE ON FUNCTION fn_cambiar_precio_tarifa_clase(BIGINT, DECIMAL, DATE)
  TO authenticated;


-- ============================================================================
-- 9. RPC: fn_actualizar_metadata_tarifa_clase
-- ============================================================================
--    Cambios in-place que afectan TODAS las versiones del linaje
--    (nombre, franja, días, prioridad, activa). NO toca vigencia ni
--    monto. Espejo de fn_actualizar_metadata_tarifa de 0029.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_actualizar_metadata_tarifa_clase(
  p_lineage_id BIGINT,
  p_nombre VARCHAR DEFAULT NULL,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT NULL,
  p_activa BOOLEAN DEFAULT NULL,
  -- Sentinels para diferenciar "no se cambia" vs "se cambia a NULL".
  p_clear_franja_horaria BOOLEAN DEFAULT FALSE,
  p_clear_dias_semana BOOLEAN DEFAULT FALSE
)
RETURNS INT
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
    RAISE EXCEPTION 'Solo el administrador puede actualizar tarifas de clases.';
  END IF;

  UPDATE tarifas_clases
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

COMMENT ON FUNCTION fn_actualizar_metadata_tarifa_clase IS
  'Actualiza metadata (nombre, franja, días, prioridad, activa) en
   TODAS las versiones del linaje de tarifa de clase. NO toca vigencia
   ni monto. Flags p_clear_* diferencian "no cambiar" de "poner en
   NULL". Espejo de fn_actualizar_metadata_tarifa de 0029.';

GRANT EXECUTE ON FUNCTION fn_actualizar_metadata_tarifa_clase(
  BIGINT, VARCHAR, TIME, TIME, INTEGER[], INTEGER, BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;


-- ============================================================================
-- 10. RPC: fn_resolver_tarifa_clase(p_fecha, p_hora)
-- ============================================================================
--    Espejo SQL de resolverTarifa.ts adaptado a tarifas_clases.
--
--    SECURITY INVOKER: corre con permisos del caller (la RLS filtra
--    por club). Defensa en capas (RLS + filtro explícito en el WHERE).
--
--    Cuando se cablee con fn_cobrar_clase (replanteo pendiente), esta
--    RPC va a resolver el precio del alquiler de clase POR FECHA del
--    cobro (respetando aumentos programados, igual que la materialización
--    de turnos fijos).
--
--    Retorna 0 filas si no hay tarifa que aplique (el caller decide
--    qué hacer — el frontend muestra "completá monto manual").
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_resolver_tarifa_clase(
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
  FROM tarifas_clases t
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

COMMENT ON FUNCTION fn_resolver_tarifa_clase IS
  'Espejo SQL de resolverTarifa.ts adaptado a tarifas_clases. SECURITY
   INVOKER — corre con permisos del caller (la RLS filtra por club).
   Usa la VERSIÓN del linaje vigente A LA FECHA del slot (no a la
   fecha actual). Disponible para cuando se cablee con fn_cobrar_clase
   en el replanteo de Clases (anotado en CLAUDE.md). Espejo de
   fn_resolver_tarifa de 0029.';

GRANT EXECUTE ON FUNCTION fn_resolver_tarifa_clase(DATE, TIME) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0034_tarifas_clases.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Estructura + constraints + policies ----------
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='tarifas_clases'
-- ORDER BY ordinal_position;
-- → Debe listar las 12 columnas con sus tipos.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint WHERE conrelid='tarifas_clases'::regclass ORDER BY conname;
-- → Debe incluir: franja_coherente, dias_semana_validos, vigencia_coherente,
--   lineage_positivo, no_overlap_lineage (EXCLUDE), monto >= 0 (CHECK inline),
--   y los FK + PK.
--
-- SELECT polname, polcmd FROM pg_policies WHERE tablename='tarifas_clases';
-- → 3 policies: select_propio_club, insert_admin, update_admin. SIN DELETE.

-- ---------- B. Crear primera tarifa de clase ----------
-- Como admin de Signo:
--   await window.supabase.rpc('fn_crear_tarifa_clase', {
--     p_nombre: 'Clase mañana', p_monto: 10000,
--     p_desde_hora: '08:00:00', p_hasta_hora: '12:00:00',
--     p_dias_semana: [1,2,3,4,5]
--   });
-- → Crea fila. lineage_id = id propio (autoreferente). vigente_desde = hoy.

-- ---------- C. Crear OTRA franja distinta ----------
--   await window.supabase.rpc('fn_crear_tarifa_clase', {
--     p_nombre: 'Clase noche', p_monto: 12000,
--     p_desde_hora: '18:00:00', p_hasta_hora: '23:00:00',
--     p_dias_semana: [1,2,3,4,5]
--   });
-- → Otra fila con su propio lineage_id (distinto a la primera).

-- ---------- D. fn_resolver_tarifa_clase ----------
--   await window.supabase.rpc('fn_resolver_tarifa_clase', {
--     p_fecha: '2026-05-25', p_hora: '10:00:00'  -- lunes mañana
--   });
-- → { data: [{ tarifa_id: <id_mañana>, monto: 10000 }] }
--
--   await window.supabase.rpc('fn_resolver_tarifa_clase', {
--     p_fecha: '2026-05-25', p_hora: '20:00:00'  -- lunes noche
--   });
-- → { data: [{ tarifa_id: <id_noche>, monto: 12000 }] }

-- ---------- E. Cambiar precio con aumento programado ----------
--   await window.supabase.rpc('fn_cambiar_precio_tarifa_clase', {
--     p_lineage_id: <id_mañana>,
--     p_monto_nuevo: 11000,
--     p_vigente_desde: '2026-07-01'
--   });
-- → Cierra v1 (vigente_hasta = 2026-06-30), crea v2 (vigente_desde =
--   2026-07-01, monto 11000).
-- Verificar:
--   SELECT vigente_desde, vigente_hasta, monto FROM tarifas_clases
--     WHERE lineage_id = <id_mañana> ORDER BY vigente_desde;
--   → 2 filas en cascada temporal.

-- ---------- F. fn_resolver_tarifa_clase respeta el aumento ----------
--   await window.supabase.rpc('fn_resolver_tarifa_clase', {
--     p_fecha: '2026-06-30', p_hora: '10:00:00'  -- antes del aumento
--   });
-- → monto = 10000 (versión vieja).
--
--   await window.supabase.rpc('fn_resolver_tarifa_clase', {
--     p_fecha: '2026-07-01', p_hora: '10:00:00'  -- a partir del aumento
--   });
-- → monto = 11000 (versión nueva).

-- ---------- G. Fecha retroactiva rechazada ----------
--   await window.supabase.rpc('fn_cambiar_precio_tarifa_clase', {
--     p_lineage_id: <id_mañana>, p_monto_nuevo: 9000, p_vigente_desde: '2020-01-01'
--   });
-- → ERROR: 'La fecha debe ser hoy o futura...'

-- ---------- H. EXCLUDE bloquea solapamiento manual ----------
-- Como admin, intentar INSERT manual de una versión que solape:
--   INSERT INTO tarifas_clases (
--     club_id, nombre, monto, dias_semana,
--     vigente_desde, vigente_hasta, lineage_id
--   ) VALUES (1, 'Test', 1000, '{1,2,3}',
--             '2026-08-01', '2026-12-31', <id_mañana>);
-- → ERROR: conflicting key value violates exclusion constraint
--   "tarifas_clases_no_overlap_lineage" (porque solapa con v2 que está
--   vigente desde 2026-07-01 sin fecha de cierre).

-- ---------- I. fn_actualizar_metadata renombra todas las versiones ----------
-- Después de E (con 2 versiones de "Clase mañana"):
--   await window.supabase.rpc('fn_actualizar_metadata_tarifa_clase', {
--     p_lineage_id: <id_mañana>, p_nombre: 'Mañana laboral'
--   });
-- → Devuelve 2 (ambas versiones renombradas).
-- → SELECT id, nombre, monto FROM tarifas_clases WHERE lineage_id = <id_mañana>;
--   ambas con nombre = 'Mañana laboral'.

-- ---------- J. REVOKE DELETE efectivo ----------
-- Como admin:
--   await window.supabase.from('tarifas_clases').delete().eq('id', <algún_id>);
-- → permission denied / 0 filas (sin policy DELETE + sin GRANT DELETE).

-- ---------- K. Vendedor (no admin) ----------
-- Como vendedor:
--   await window.supabase.rpc('fn_crear_tarifa_clase', { p_nombre: 'X', p_monto: 1 });
-- → 'Solo el administrador puede crear tarifas de clases.'

-- ---------- L. Cross-tenant ----------
-- Como admin de OTRO club:
--   await window.supabase.rpc('fn_resolver_tarifa_clase', { p_fecha: '...', p_hora: '...' });
-- → 0 filas (filtro current_club_id() en el WHERE).

-- ---------- M. NO ROMPE NADA EXISTENTE ----------
-- Tarifas (turnos) → sin cambios, funciona idéntico.
-- fn_resolver_tarifa (turnos) → idéntico.
-- fn_cobrar_clase → sigue leyendo clases.precio (esta migración NO toca el
--   cobro de clases; ese es el replanteo aparte).
-- ============================================================================
