-- ============================================================================
-- 0067_club_perfil_publico.sql
-- Perfil público del club para jugadores (B2C)
--
-- Permite que cada club exponga una página pública en /club/:slug con:
-- su descripción, ubicación, fotos e información de contacto. Los
-- jugadores pueden encontrar el club desde el marketplace de MatchGo.
--
-- Cambios:
--   1. Columnas nuevas en `clubes` (perfil público).
--   2. Tabla `club_fotos` con RLS admin-only.
--   3. Bucket de Storage `fotos-clubes`.
--   4. Vistas públicas con security_invoker=false (bypass RLS) para acceso
--      anon seguro con exposición de columnas controlada.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Columnas nuevas en clubes
-- ============================================================================
ALTER TABLE clubes
  ADD COLUMN descripcion        TEXT             NULL,
  ADD COLUMN lat                DOUBLE PRECISION NULL,
  ADD COLUMN lng                DOUBLE PRECISION NULL,
  ADD COLUMN instagram          TEXT             NULL,
  ADD COLUMN website            TEXT             NULL,
  ADD COLUMN perfil_publico_activo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN clubes.descripcion         IS 'Texto libre del club para su perfil público (quiénes somos, qué ofrecemos).';
COMMENT ON COLUMN clubes.lat                 IS 'Latitud GPS del club. Se usa para el mapa embebido del perfil público.';
COMMENT ON COLUMN clubes.lng                 IS 'Longitud GPS del club. Se usa para el mapa embebido del perfil público.';
COMMENT ON COLUMN clubes.instagram           IS 'Handle de Instagram del club (sin @). Ej: ''clubpadel_norte''.';
COMMENT ON COLUMN clubes.website             IS 'URL del sitio web del club. Ej: ''https://clubpadel.com.ar''.';
COMMENT ON COLUMN clubes.perfil_publico_activo IS 'Si TRUE, el club aparece en el marketplace de MatchGo y su perfil /club/:slug es accesible.';

-- GRANT UPDATE: la policy `clubes_update_solo_admin_horarios` (0003)
-- sigue cubriendo la restricción de rol. Solo ampliamos los privilegios
-- de columna que `authenticated` puede intentar modificar.
GRANT UPDATE (descripcion, lat, lng, instagram, website, perfil_publico_activo)
  ON clubes TO authenticated;


-- ============================================================================
-- 2. Tabla club_fotos
--
-- Galería de fotos del club para el perfil público. Cada fila es una
-- foto subida al bucket `fotos-clubes`. La URL almacenada es la URL
-- pública completa de Supabase Storage (construida en el cliente).
--
-- `es_portada = TRUE` identifica la foto que se muestra como hero en
-- el perfil. Si no hay ninguna con es_portada=TRUE, el cliente usa la
-- primera foto según `orden`.
-- ============================================================================
CREATE TABLE club_fotos (
  id         BIGSERIAL PRIMARY KEY,
  club_id    BIGINT NOT NULL REFERENCES clubes(id) ON DELETE CASCADE,
  url        TEXT NOT NULL CHECK (length(url) > 0),
  caption    TEXT NULL,
  orden      SMALLINT NOT NULL DEFAULT 0,
  es_portada BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE club_fotos IS
  'Galería de fotos del perfil público del club. url = URL pública de
   Supabase Storage. es_portada = foto hero del perfil.';

ALTER TABLE club_fotos ENABLE ROW LEVEL SECURITY;

-- Los usuarios autenticados del club ven sus propias fotos.
CREATE POLICY "club_fotos_select_own"
  ON club_fotos FOR SELECT TO authenticated
  USING (club_id = current_club_id());

-- Solo admin puede cargar fotos.
CREATE POLICY "club_fotos_insert_admin"
  ON club_fotos FOR INSERT TO authenticated
  WITH CHECK (
    club_id = current_club_id()
    AND current_user_rol() = 'admin'
  );

CREATE POLICY "club_fotos_update_admin"
  ON club_fotos FOR UPDATE TO authenticated
  USING (
    club_id = current_club_id()
    AND current_user_rol() = 'admin'
  )
  WITH CHECK (
    club_id = current_club_id()
    AND current_user_rol() = 'admin'
  );

CREATE POLICY "club_fotos_delete_admin"
  ON club_fotos FOR DELETE TO authenticated
  USING (
    club_id = current_club_id()
    AND current_user_rol() = 'admin'
  );


-- ============================================================================
-- 3. Bucket de Storage `fotos-clubes`
--
-- Público (lectura libre). Ruta de archivos: {club_id}/{uuid}.{ext}.
-- Límite 5 MB por foto. Tipos permitidos: JPEG, PNG, WebP.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fotos-clubes', 'fotos-clubes', TRUE, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Escritura restringida a admin del propio club (mismo patrón que 0017).
DROP POLICY IF EXISTS "fotos_clubes_insert_admin" ON storage.objects;
CREATE POLICY "fotos_clubes_insert_admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fotos-clubes'
    AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
    AND public.current_user_rol() = 'admin'
  );

DROP POLICY IF EXISTS "fotos_clubes_update_admin" ON storage.objects;
CREATE POLICY "fotos_clubes_update_admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fotos-clubes'
    AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
    AND public.current_user_rol() = 'admin'
  )
  WITH CHECK (
    bucket_id = 'fotos-clubes'
    AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
    AND public.current_user_rol() = 'admin'
  );

DROP POLICY IF EXISTS "fotos_clubes_delete_admin" ON storage.objects;
CREATE POLICY "fotos_clubes_delete_admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'fotos-clubes'
    AND (storage.foldername(name))[1] = public.current_club_id()::TEXT
    AND public.current_user_rol() = 'admin'
  );


-- ============================================================================
-- 4. Vistas públicas (security_invoker = false = SECURITY DEFINER)
--
-- Con security_invoker=false la vista se ejecuta con los privilegios de
-- su dueño (el rol que corre la migración, que tiene BYPASSRLS). Esto
-- permite que el rol `anon` consulte datos filtrados sin necesidad de
-- políticas RLS en las tablas base. El filtro WHERE reemplaza a la RLS.
--
-- Solo se exponen columnas seguras (sin condicion_fiscal, plan_id, etc.).
-- ============================================================================

-- v_clubes_publicos: un club por slug para el perfil /club/:slug
CREATE VIEW v_clubes_publicos
  WITH (security_invoker = false)
AS
SELECT
  c.id,
  c.nombre,
  c.slug,
  c.descripcion,
  c.direccion,
  c.ciudad,
  c.provincia,
  c.telefono,
  c.email,
  c.hora_apertura,
  c.hora_cierre,
  c.logo_path,
  c.color_primario_hsl,
  c.lat,
  c.lng,
  c.instagram,
  c.website
FROM clubes c
WHERE c.perfil_publico_activo = TRUE
  AND c.estado IN ('trial', 'activo')
  AND c.activo = TRUE;

COMMENT ON VIEW v_clubes_publicos IS
  'Vista pública de clubes con perfil activo. Solo columnas seguras (sin
   datos fiscales, plan, etc.). Accesible por anon vía GRANT SELECT.';

GRANT SELECT ON v_clubes_publicos TO anon;
GRANT SELECT ON v_clubes_publicos TO authenticated;


-- v_canchas_publicas: canchas activas de clubes con perfil público
CREATE VIEW v_canchas_publicas
  WITH (security_invoker = false)
AS
SELECT
  ca.id,
  ca.club_id,
  ca.nombre,
  ca.tipo,
  ca.cubierta,
  ca.orden
FROM canchas ca
JOIN clubes c ON ca.club_id = c.id
WHERE ca.activa = TRUE
  AND c.perfil_publico_activo = TRUE
  AND c.estado IN ('trial', 'activo')
  AND c.activo = TRUE;

GRANT SELECT ON v_canchas_publicas TO anon;
GRANT SELECT ON v_canchas_publicas TO authenticated;


-- v_fotos_clubes_publicas: fotos de clubes con perfil público
CREATE VIEW v_fotos_clubes_publicas
  WITH (security_invoker = false)
AS
SELECT
  f.id,
  f.club_id,
  f.url,
  f.caption,
  f.orden,
  f.es_portada
FROM club_fotos f
JOIN clubes c ON f.club_id = c.id
WHERE c.perfil_publico_activo = TRUE
  AND c.estado IN ('trial', 'activo')
  AND c.activo = TRUE;

GRANT SELECT ON v_fotos_clubes_publicas TO anon;
GRANT SELECT ON v_fotos_clubes_publicas TO authenticated;


COMMIT;
