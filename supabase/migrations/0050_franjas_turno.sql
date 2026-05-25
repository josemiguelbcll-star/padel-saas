-- ============================================================================
-- 0050_franjas_turno.sql
-- Duraciones de turno POR FRANJA HORARIA — base del rediseño de la grilla
-- de reservas a "grilla dinámica" (Forma B) con duraciones por franja.
--
-- ⚠️ ARCHIVO EN DOS PARTES. NO EJECUTAR HASTA QUE LA PARTE 2 ESTÉ APPENDEADA.
-- ─────────────────────────────────────────────────────────────────────────
--   PARTE 1 (este bloque): DROP de la deprecada franjas_duracion + CREATE
--                          TABLE franjas_turno + CHECKs + índices + RLS + GRANTs.
--   PARTE 2 (se agrega abajo): fn_resolver_duraciones (espejo de
--                          fn_resolver_tarifa) + COMMIT de la transacción.
--   Ambas comparten UNA transacción (un BEGIN acá, un COMMIT al final de
--   la PARTE 2): el schema nunca queda a medias si la PARTE 2 falla.
--
--   BLOQUE 1 del rework: esta migración + resolverDuraciones.ts +
--   useFranjasTurno (frontend). NO toca la grilla operativa todavía
--   (calcularDisponibles se reescribe en el BLOQUE 3).
-- ─────────────────────────────────────────────────────────────────────────
--
-- =====================================================================
-- DECISIONES (confirmadas con el dueño)
-- =====================================================================
-- - Tabla NUEVA, limpia. Espeja el patrón vivo de `tarifas` (franja +
--   día + prioridad) + `cancha_id` opcional. SIN versionado temporal
--   (lineage/vigente_*): las duraciones son estables, no necesitan
--   historial como el precio.
-- - `duraciones_min INTEGER[]`: una franja permite un CONJUNTO de
--   duraciones (ej. {60,90}). Una fila por franja (no filas separadas),
--   igual que `tarifas.dias_semana` es un INTEGER[].
-- - `cancha_id` NULL = aplica a todas las canchas. Hoy la config es
--   GLOBAL (siempre NULL); la columna queda para flexibilidad SaaS
--   futura (una cancha con reglas distintas). En la resolución, una
--   franja cancha-específica gana sobre una global.
-- - Sin franja que aplique a un (día, hora) → la grilla cae al fallback
--   `clubes.duracion_turno_default` (la resolución lo maneja en la
--   PARTE 2 / el cliente). Un club que no configura franjas funciona
--   como hoy.
--
-- =====================================================================
-- DROP de franjas_duracion (0004, deprecada en 0005)
-- =====================================================================
-- `franjas_duracion` quedó deprecada por COMMENT en 0005 y NUNCA fue
-- escrita por código (cero INSERT en migraciones y frontend) ni
-- referenciada por FK desde otra tabla. La dropeamos para no dejar dos
-- tablas casi-iguales y confusas. Si por una carga manual vía Studio
-- tuviera filas, se perderían — es data de descarte (el modelo nuevo es
-- franjas_turno).
--
-- Nota: `dbErrors.ts` (frontend) todavía tiene regex para los nombres de
-- constraint `franjas_duracion_*`. Es inofensivo (esos errores ya no
-- pueden dispararse); se limpia en el bloque frontend.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. DROP de la tabla deprecada franjas_duracion
-- ============================================================================
-- CASCADE no hace falta (nadie la referencia por FK), pero DROP TABLE ya
-- elimina sus policies, índices y GRANTs asociados.
DROP TABLE IF EXISTS franjas_duracion;


-- ============================================================================
-- 1. TABLA: franjas_turno
-- ============================================================================
--    Reglas de duración de turno por franja horaria + días (+ cancha
--    opcional). Cada franja declara QUÉ duraciones se pueden reservar
--    arrancando dentro de ella. La grilla (BLOQUE 3) tilea cada hueco
--    libre ofreciendo estos inicios/duraciones, sin cruzar el borde de
--    la franja.
-- ============================================================================
CREATE TABLE franjas_turno (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  -- NULL = aplica a TODAS las canchas del club. Una franja con cancha
  -- específica gana sobre la global en la resolución (PARTE 2).
  cancha_id BIGINT REFERENCES canchas(id),

  nombre VARCHAR(80) NOT NULL,

  -- Franja horaria. Ambas NULL = aplica a toda hora (mismo patrón que
  -- tarifas). Si una está seteada, ambas deben estarlo con hasta > desde.
  desde_hora TIME,
  hasta_hora TIME,

  -- Días donde aplica. 1=lunes..7=domingo. NULL = todos los días.
  dias_semana INTEGER[],

  -- Conjunto de duraciones permitidas para turnos que arrancan en esta
  -- franja (ej. {60,90}). Una sola fila por franja.
  duraciones_min INTEGER[] NOT NULL,

  -- Desempate cuando dos franjas aplican al mismo (cancha, día, hora).
  prioridad INTEGER NOT NULL DEFAULT 0,

  activa BOOLEAN NOT NULL DEFAULT TRUE,

  -- Coherencia de la franja horaria (idéntico a tarifas_franja_coherente).
  CONSTRAINT franjas_turno_franja_coherente CHECK (
    (desde_hora IS NULL AND hasta_hora IS NULL)
    OR (desde_hora IS NOT NULL AND hasta_hora IS NOT NULL AND hasta_hora > desde_hora)
  ),

  -- Días: NULL (todos) o array no vacío con valores 1..7.
  CONSTRAINT franjas_turno_dias_semana_validos CHECK (
    dias_semana IS NULL
    OR (
      array_length(dias_semana, 1) BETWEEN 1 AND 7
      AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
    )
  ),

  -- Duraciones: 1..6 valores, todos dentro del set permitido del sistema.
  -- cardinality() (no array_length) para que un array vacío {} dé 0 y
  -- sea RECHAZADO (array_length de {} es NULL y burlaría el BETWEEN).
  CONSTRAINT franjas_turno_duraciones_validas CHECK (
    cardinality(duraciones_min) BETWEEN 1 AND 6
    AND duraciones_min <@ ARRAY[60,90,120,150,180,240]::INTEGER[]
  )
);

CREATE INDEX idx_franjas_turno_club ON franjas_turno (club_id);
CREATE INDEX idx_franjas_turno_cancha
  ON franjas_turno (cancha_id) WHERE cancha_id IS NOT NULL;

COMMENT ON TABLE franjas_turno IS
  'Reglas de duración de turno por franja horaria + días (+ cancha
   opcional). Reemplaza a la deprecada franjas_duracion (0004/0005), sin
   versionado temporal. La grilla dinámica (Forma B) ofrece, en cada
   hueco libre, inicios con las duraciones de la franja aplicable, sin
   cruzar su borde. Sin franja → fallback clubes.duracion_turno_default.';

COMMENT ON COLUMN franjas_turno.cancha_id IS
  'NULL = la franja aplica a todas las canchas. Una franja cancha-específica
   gana sobre la global en la resolución. Hoy la config es global (NULL).';

COMMENT ON COLUMN franjas_turno.duraciones_min IS
  'Duraciones (minutos) reservables arrancando en esta franja. Subconjunto
   no vacío de {60,90,120,150,180,240}. Ej: {60,90} = se puede 60 o 90.';

COMMENT ON COLUMN franjas_turno.prioridad IS
  'Cuando dos franjas aplican al mismo (cancha, día, hora), gana la de
   mayor prioridad. Misma semántica que tarifas.prioridad.';


-- ============================================================================
-- 2. RLS y GRANTs — ABM admin-only, SELECT abierto al club
-- ============================================================================
-- Mismo patrón que `canchas`/`tarifas`: el vendedor LEE (la grilla las
-- necesita), solo el admin las crea/edita/borra. DELETE permitido (a
-- diferencia de tarifas): ninguna `reserva` referencia una franja por FK
-- (la reserva guarda su duracion_min snapshot), así que una franja mal
-- cargada se borra limpio.
-- ============================================================================
ALTER TABLE franjas_turno ENABLE ROW LEVEL SECURITY;

CREATE POLICY "franjas_turno_select"
ON franjas_turno FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "franjas_turno_insert_solo_admin"
ON franjas_turno FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "franjas_turno_update_solo_admin"
ON franjas_turno FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "franjas_turno_delete_solo_admin"
ON franjas_turno FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON franjas_turno TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE franjas_turno_id_seq TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ⏸  FIN PARTE 1. La transacción sigue ABIERTA (se appendea PARTE 2 + COMMIT).
-- ════════════════════════════════════════════════════════════════════════


-- ============================================================================
-- PARTE 2 — fn_resolver_duraciones (espejo de fn_resolver_tarifa, 0029)
-- ============================================================================
-- Resuelve QUÉ duraciones se pueden reservar arrancando en un (fecha, hora)
-- de una cancha del club del caller. Espejo SQL de resolverDuraciones.ts
-- (cliente, que es el que alimenta la grilla). Se construye también acá por
-- paridad y para una eventual validación server-side futura (hoy
-- fn_crear_reserva queda permisiva — decisión confirmada).
--
-- ORDEN DE RESOLUCIÓN:
--   1. cancha-específica (cancha_id = p_cancha_id) gana sobre global (NULL)
--   2. prioridad DESC
--   3. id DESC
--   LIMIT 1 → la franja ganadora.
--
-- FALLBACK: si NINGUNA franja aplica, devuelve {duracion_turno_default}
-- (un solo elemento) con hasta=NULL. Así un club SIN franjas configuradas
-- funciona como hoy (la grilla tilea con la duración por defecto del club).
--
-- SIEMPRE devuelve exactamente 1 fila (a diferencia de fn_resolver_tarifa,
-- que devuelve 0 si no hay precio): la duración siempre tiene un valor
-- usable gracias al fallback.
--
-- Devuelve `hasta` (borde de la franja) además de las duraciones porque el
-- algoritmo de la grilla (BLOQUE 3) lo usa como límite: un turno no cruza
-- el borde de su franja. hasta=NULL = la franja (o el fallback) aplica a
-- toda hora → el límite lo pone el fin del hueco / cierre del club.
--
-- SECURITY INVOKER + STABLE: igual que fn_resolver_tarifa. La RLS de
-- franjas_turno filtra por club; el WHERE explícito es defensa en capas.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_resolver_duraciones(
  p_fecha DATE,
  p_hora TIME,
  p_cancha_id BIGINT DEFAULT NULL
)
RETURNS TABLE (duraciones INTEGER[], hasta TIME)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_default INT;
BEGIN
  v_club_id := current_club_id();

  -- Franja aplicable. cancha-específica primero, luego prioridad, luego id.
  RETURN QUERY
  SELECT f.duraciones_min, f.hasta_hora
  FROM franjas_turno f
  WHERE f.club_id = v_club_id
    AND f.activa = TRUE
    -- cancha de la reserva o franja global
    AND (f.cancha_id IS NULL OR f.cancha_id = p_cancha_id)
    -- día de la semana
    AND (
      f.dias_semana IS NULL
      OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(f.dias_semana)
    )
    -- franja horaria
    AND (
      (f.desde_hora IS NULL AND f.hasta_hora IS NULL)
      OR (p_hora >= f.desde_hora AND p_hora < f.hasta_hora)
    )
  ORDER BY (f.cancha_id IS NOT NULL) DESC,   -- cancha-específica gana sobre global
           f.prioridad DESC,
           f.id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Fallback: ninguna franja aplica → duración por defecto del club.
  SELECT duracion_turno_default INTO v_default
  FROM clubes WHERE id = v_club_id;

  RETURN QUERY SELECT ARRAY[v_default]::INTEGER[], NULL::TIME;
END;
$$;

COMMENT ON FUNCTION fn_resolver_duraciones(DATE, TIME, BIGINT) IS
  'Espejo SQL de resolverDuraciones.ts. Resuelve las duraciones permitidas
   para un (fecha, hora, cancha): cancha-específica gana sobre global, luego
   prioridad DESC, id DESC. Si ninguna franja aplica, devuelve
   {clubes.duracion_turno_default} (fallback). SIEMPRE devuelve 1 fila.
   Devuelve también el borde `hasta` de la franja (NULL = toda hora) para
   que la grilla no ofrezca turnos que crucen la franja. SECURITY INVOKER.';

GRANT EXECUTE ON FUNCTION fn_resolver_duraciones(DATE, TIME, BIGINT)
  TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0050_franjas_turno.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Tabla + CHECKs + RLS ----------
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'franjas_turno'::regclass AND contype = 'c';
-- → franja_coherente, dias_semana_validos, duraciones_validas.
-- SELECT polname, cmd FROM pg_policies WHERE tablename = 'franjas_turno';
-- → select (todos), insert/update/delete (admin).

-- ---------- B. franjas_duracion dropeada ----------
-- SELECT to_regclass('public.franjas_duracion');  → NULL (ya no existe).

-- ---------- C. Fallback sin franjas → duracion_turno_default ----------
-- Club SIN franjas configuradas (duracion_turno_default = 90):
--   await window.supabase.rpc('fn_resolver_duraciones', {
--     p_fecha: '2026-05-25', p_hora: '10:00:00', p_cancha_id: 1
--   });
-- → { data: [{ duraciones: [90], hasta: null }], error: null }

-- ---------- D. Caso José Miguel (cargar franjas primero) ----------
-- INSERT franja "Mañana": desde 07:30 hasta 14:30, dias NULL, duraciones {60,90}
-- INSERT franja "Tarde":  desde 14:30 hasta 22:00, dias NULL, duraciones {90}
--   (vía la UI del BLOQUE 2, o INSERT directo como admin)
--
--   rpc fn_resolver_duraciones('2026-05-25','13:30:00',1)
--   → { duraciones: [60,90], hasta: '14:30:00' }   (franja Mañana; el algoritmo
--      del BLOQUE 3 descartará el 90 porque 13:30+90 cruza 14:30)
--   rpc fn_resolver_duraciones('2026-05-25','15:00:00',1)
--   → { duraciones: [90], hasta: '22:00:00' }       (franja Tarde)

-- ---------- E. Cancha-específica gana sobre global ----------
-- Con una franja global {90} y una franja cancha_id=2 {60} mismo horario:
--   rpc fn_resolver_duraciones(fecha, hora, 2) → [60]   (la específica gana)
--   rpc fn_resolver_duraciones(fecha, hora, 1) → [90]   (cae a la global)

-- ---------- F. Aislamiento multi-tenant ----------
-- Como usuario de otro club: SELECT * FROM franjas_turno; → solo las de su club.
-- Como vendedor: INSERT INTO franjas_turno (...) → rechazado por RLS (admin-only).
-- ============================================================================
