-- ============================================================================
-- 0016_marca_club.sql
-- Identidad de marca por club — Nivel 2, Etapa 1 (color + nombre)
--
-- Cada club puede personalizar su color de marca (que se aplica al
-- token CSS --primary y se propaga al focus ring vía --ring). La etapa
-- 2 sumará upload de logo via Storage; esta etapa 1 es sólo color +
-- nombre.
--
-- Esta migración hace dos cosas:
--
--   1. ADD COLUMN `color_primario_hsl` en `clubes`:
--      VARCHAR(50) NOT NULL DEFAULT '221 83% 53%' (el valor actual del
--      token --primary en globals.css — los clubes existentes no notan
--      cambio hasta que un admin elija otro color). CHECK simple de
--      longitud > 0 (no validamos regex HSL — la paleta curada del
--      frontend en `src/lib/clubBrand.ts` garantiza el formato).
--
--   2. GRANT UPDATE column-level ampliado:
--      Hoy el GRANT está limitado a `(hora_apertura, hora_cierre,
--      duracion_turno_default)` (0003). Lo ampliamos a `(nombre,
--      color_primario_hsl)` para que el admin pueda editar la marca
--      desde la nueva pantalla "Configuración → Marca".
--
-- RLS:
--   La política `clubes_update_solo_admin_horarios` (creada en la 0003)
--   ya cubre el caso: filtra UPDATE a `id = current_club_id() AND
--   current_user_rol() = 'admin'`, sin restringir a columnas
--   específicas. Como RLS es permisiva por default (OR entre
--   políticas), agregar otra política sería redundante. Defense in
--   depth se mantiene: la policy define quién/dónde; el GRANT
--   column-level define qué columnas son tocables.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). NO toca:
--   - La política RLS `clubes_update_solo_admin_horarios` (intacta).
--   - El GRANT existente sobre las 3 columnas de horarios (se SUMA, no
--     se reemplaza — Postgres acumula privilegios por columna).
--   - Ninguna otra tabla, función, política o trigger.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Columna nueva en clubes
--
--    Formato del valor: HSL triple sin wrap `hsl()`, convención shadcn.
--    Ejemplo: '221 83% 53%' (azul shadcn default). Se inyecta directo
--    en CSS con:
--      document.documentElement.style.setProperty(
--        '--primary', club.color_primario_hsl
--      );
--    El token --ring está linkeado en globals.css como
--    `--ring: var(--primary)`, así que cambiar --primary lo propaga al
--    focus ring automáticamente.
--
--    DEFAULT '221 83% 53%' = valor actual de --primary en globals.css.
--    Los clubes existentes lo reciben automáticamente vía DEFAULT del
--    ADD COLUMN — UI idéntica a la actual hasta que un admin elija
--    otro color desde la pantalla Marca.
--
--    CHECK length > 0: defensivo contra strings vacíos. No validamos
--    regex del formato HSL — la paleta curada del frontend
--    (src/lib/clubBrand.ts) garantiza que sólo se persistan valores
--    válidos. Si alguien INSERTA/UPDATEa via SQL un valor inválido
--    como 'rojo', el navegador lo ignora y queda en el default del
--    CSS — falla silenciosa pero no rompe la UI.
-- ============================================================================
ALTER TABLE clubes
  ADD COLUMN color_primario_hsl VARCHAR(50) NOT NULL DEFAULT '221 83% 53%'
  CHECK (length(color_primario_hsl) > 0);

COMMENT ON COLUMN clubes.color_primario_hsl IS
  'Color de marca del club, en formato HSL triple sin wrap (convención
   shadcn). Ej: ''221 83% 53%''. Se inyecta al iniciar sesión sobre el
   token CSS --primary del :root — el --ring se propaga gratis vía
   var(--primary). Default = ''221 83% 53%'' (el valor actual del
   token en globals.css). La paleta curada del frontend
   (src/lib/clubBrand.ts) garantiza el formato; valores fuera del
   catálogo persisten igual (si emerge un free-picker en el futuro,
   este campo lo soporta sin migración).';


-- ============================================================================
-- 2. GRANT UPDATE column-level — ampliado
--
--    El GRANT existente (0003) cubre sólo
--    (hora_apertura, hora_cierre, duracion_turno_default). Lo sumamos
--    `nombre` y `color_primario_hsl` para que la pantalla Marca pueda
--    editarlos. Postgres acumula privilegios por columna — esto NO
--    reemplaza el GRANT viejo, lo extiende.
--
--    La política RLS `clubes_update_solo_admin_horarios` (0003) sigue
--    restringiendo el UPDATE a admin del club, sin importar la columna.
--    Defense in depth: GRANT = qué columnas; RLS = quién/dónde.
-- ============================================================================
GRANT UPDATE (nombre, color_primario_hsl) ON clubes TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0016_marca_club.sql
-- ============================================================================
