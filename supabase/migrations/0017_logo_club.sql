-- ============================================================================
-- 0017_logo_club.sql
-- Identidad de marca por club — Nivel 2, Etapa 2 (logo via Storage)
--
-- Cada club puede subir un logo (PNG o JPG, máx. 2 MB) que se muestra
-- en el topbar al lado del nombre. El logo es contenido público por
-- naturaleza (lo va a usar el club en su marketing) — el rigor
-- multi-tenant va en la ESCRITURA: nadie puede subir/sobrescribir el
-- logo de otro club, ni un vendedor el de su propio club. Solo admin.
--
-- Esta migración hace cuatro cosas:
--
--   1. ADD COLUMN `logo_path` en `clubes`:
--      VARCHAR(255) NULL (default sin logo). CHECK length > 0 cuando
--      no es NULL para defenderse de strings vacíos. Guarda el path
--      interno del Storage (ej. "42/9f8a3c1e-...png"), NO la URL
--      pública — se construye con `getPublicUrl(path)` en el cliente.
--
--   2. GRANT UPDATE column-level ampliado:
--      Suma `logo_path` al GRANT existente sobre clubes
--      (hora_apertura/cierre/duracion_default + nombre + color_primario_hsl).
--      La policy `clubes_update_solo_admin_horarios` (0003) sigue
--      cubriendo el acceso (admin del club).
--
--   3. Bucket `logos-clubes` en `storage.buckets`:
--      Público (lectura libre vía URL pública; no necesita signed
--      URLs). Límites server-side de defense in depth:
--      file_size_limit 2 MB; allowed_mime_types PNG + JPEG (SVG queda
--      fuera por ahora — se puede agregar después con validación de
--      contenido server-side para evitar XSS).
--
--   4. Tres políticas RLS en `storage.objects` (INSERT/UPDATE/DELETE):
--      Restringen escritura a admin del club, sólo en SU carpeta
--      (extraída del path con `storage.foldername(name)[1]`). SELECT
--      no se crea — el bucket es público, el endpoint HTTP de lectura
--      bypassa RLS.
--
-- ESTRUCTURA DEL PATH:
-- ─────────────────────────────────────────────────────────────────────
-- Dentro del bucket `logos-clubes`, los archivos van en:
--     {club_id}/{uuid}.{ext}
-- Ejemplo: "42/9f8a3c1e-7b4a-...png"
--
-- - El primer folder ES el club_id (string). La policy lo extrae con
--   `(storage.foldername(name))[1]` y lo compara con
--   `public.current_club_id()::TEXT`. Aislamiento multi-tenant a nivel
--   filesystem.
-- - UUID por upload (no path fijo `logo.{ext}`): cache-busting natural
--   en CDN edge + cleanup limpio cuando el club cambia de extensión
--   (PNG ↔ JPG). El cliente borra el path anterior best-effort
--   después del UPDATE exitoso.
--
-- NOTA SOBRE LAS HELPERS DESDE storage.objects:
-- ─────────────────────────────────────────────────────────────────────
-- `public.current_club_id()` y `public.current_user_rol()` ya están
-- GRANTed a `authenticated` en 0001/0002. Las policies de
-- storage.objects se evalúan en el contexto del usuario que hace la
-- query, así que las funciones son accesibles. Usamos el prefijo
-- `public.` explícito por las dudas (search_path en storage podría no
-- incluir public en algún escenario edge).
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). NO toca:
--   - Otras políticas de clubes (la `clubes_update_solo_admin_horarios`
--     sigue cubriendo el UPDATE de las 5 columnas accesibles).
--   - storage.buckets ya existentes (uso ON CONFLICT DO NOTHING).
--   - Ningún otro bucket, tabla, función o trigger.
--   - Las helpers públicas current_club_id() / current_user_rol().
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Columna nueva en clubes
--
--    `logo_path` guarda el path INTERNO del bucket (no la URL pública).
--    Ej: "42/9f8a3c1e-7b4a-...png". NULL = sin logo (default,
--    muestra solo el nombre en el topbar, como el comportamiento
--    pre-etapa-2). El cliente construye la URL con:
--      supabase.storage.from('logos-clubes')
--        .getPublicUrl(path).data.publicUrl
--    Beneficio de guardar path en vez de URL: si en el futuro
--    cambiamos de proyecto Supabase, las URLs no se rompen — el path
--    se mantiene válido y el cliente reconstruye la URL nueva.
--
--    CHECK `IS NULL OR length > 0`: defensivo contra strings vacíos
--    (que serían "tengo logo" pero apuntando a nada). Cualquier path
--    no vacío válido.
-- ============================================================================
ALTER TABLE clubes
  ADD COLUMN logo_path VARCHAR(255) NULL
  CHECK (logo_path IS NULL OR length(logo_path) > 0);

COMMENT ON COLUMN clubes.logo_path IS
  'Path interno del bucket `logos-clubes` (Supabase Storage). Formato:
   "{club_id}/{uuid}.{ext}". NULL = sin logo (muestra solo el nombre
   en el topbar). El cliente construye la URL pública con
   supabase.storage.from(''logos-clubes'').getPublicUrl(path). El UUID
   por upload provee cache-busting natural (cada cambio de logo da
   una URL nueva, sin colisión con CDN). El archivo anterior se borra
   best-effort desde el cliente después de UPDATEar este campo
   (cleanup; si falla queda huérfano sin afectar funcionalidad).';


-- ============================================================================
-- 2. GRANT UPDATE column-level — ampliado a logo_path
--
--    Postgres acumula privilegios por columna. Este GRANT NO reemplaza
--    los anteriores; los suma. Acumulado post-0017 sobre `clubes` para
--    `authenticated`:
--      - SELECT en toda la tabla (0001)
--      - UPDATE en (hora_apertura, hora_cierre, duracion_turno_default) (0003)
--      - UPDATE en (nombre, color_primario_hsl) (0016)
--      - UPDATE en (logo_path) (0017 — este)
--    La policy `clubes_update_solo_admin_horarios` (0003) restringe a
--    admin del club sin importar la columna.
-- ============================================================================
GRANT UPDATE (logo_path) ON clubes TO authenticated;


-- ============================================================================
-- 3. Bucket de Storage `logos-clubes`
--
--    public = TRUE → la URL pública no requiere auth/signed URLs.
--                    El logo es contenido público por naturaleza.
--    file_size_limit = 2097152 (2 MB) → Storage rechaza server-side si
--                    el frontend bypassa la validación.
--    allowed_mime_types = PNG + JPEG.
--                    SVG queda fuera por ahora — los logos andan bien
--                    en PNG con transparencia. Si emerge necesidad de
--                    SVG, se agrega con validación de contenido
--                    server-side (Storage no valida XSS dentro del SVG).
--
--    ON CONFLICT (id) DO NOTHING → idempotente si el bucket ya existía
--    (ej. creado manualmente desde el dashboard).
-- ============================================================================
INSERT INTO storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
VALUES (
  'logos-clubes',
  'logos-clubes',
  TRUE,
  2097152,
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- 4. RLS en storage.objects — escritura blindada multi-tenant
--
--    Tres políticas (INSERT/UPDATE/DELETE) con los MISMOS tres
--    invariantes:
--
--      a) bucket_id = 'logos-clubes' — fuera de este bucket la
--         política no aplica (defensa contra acoplamiento con otros
--         buckets futuros).
--
--      b) (storage.foldername(name))[1] = public.current_club_id()::TEXT
--         Aislamiento multi-tenant: el primer folder del path ES el
--         club_id. Si no coincide con el club del usuario logueado,
--         RECHAZA. Imposible escribir en la carpeta de otro club.
--
--      c) public.current_user_rol() = 'admin' — solo el admin del
--         club, no los vendedores.
--
--    SELECT NO se crea porque el bucket es público (el endpoint HTTP
--    de lectura bypassa RLS). Si en algún momento cambiamos a privado,
--    agregamos una policy SELECT que filtre por club_id del path.
--
--    La policy de UPDATE se crea aunque el flujo del frontend use
--    INSERT (upload con upsert: false) — defensiva contra cualquier
--    UPDATE concurrente o vía SQL.
--
--    Cada policy se precede con DROP POLICY IF EXISTS para que la
--    migración sea re-ejecutable: con Storage es común tener que
--    reintentar (crear el bucket a mano si el INSERT por SQL no anda,
--    re-correr policies). Mismo criterio de idempotencia que el resto
--    del codebase usa para CHECKs que se reemplazan (ver 0013/0014/0015).
-- ============================================================================

-- ---------- 4.a. INSERT (upload de logo) ----------
DROP POLICY IF EXISTS "logos_clubes_insert_admin_propio_club"
  ON storage.objects;
CREATE POLICY "logos_clubes_insert_admin_propio_club"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'logos-clubes'
  AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
  AND public.current_user_rol() = 'admin'
);

-- ---------- 4.b. UPDATE (defensiva — el frontend no upsertea) ----------
DROP POLICY IF EXISTS "logos_clubes_update_admin_propio_club"
  ON storage.objects;
CREATE POLICY "logos_clubes_update_admin_propio_club"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'logos-clubes'
  AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
  AND public.current_user_rol() = 'admin'
)
WITH CHECK (
  bucket_id = 'logos-clubes'
  AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
  AND public.current_user_rol() = 'admin'
);

-- ---------- 4.c. DELETE (cleanup del archivo viejo + quitar logo) ----------
DROP POLICY IF EXISTS "logos_clubes_delete_admin_propio_club"
  ON storage.objects;
CREATE POLICY "logos_clubes_delete_admin_propio_club"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'logos-clubes'
  AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
  AND public.current_user_rol() = 'admin'
);


COMMIT;

-- ============================================================================
-- Fin de la migración 0017_logo_club.sql
-- ============================================================================
