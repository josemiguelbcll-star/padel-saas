-- ==============================================================================
-- MIGRACIÓN 0114: Fix ciudad default y vista v_clubes_publicos
-- ==============================================================================

-- 1. Actualizar clubes existentes sin ciudad o provincia
UPDATE public.clubes
SET ciudad = 'Salta',
    provincia = 'Salta'
WHERE ciudad IS NULL OR TRIM(ciudad) = '';

-- 2. Asegurar defaults y perfil_publico_activo = true
ALTER TABLE public.clubes
  ALTER COLUMN ciudad SET DEFAULT 'Salta',
  ALTER COLUMN provincia SET DEFAULT 'Salta',
  ALTER COLUMN perfil_publico_activo SET DEFAULT TRUE;

UPDATE public.clubes
SET perfil_publico_activo = TRUE
WHERE perfil_publico_activo IS FALSE OR perfil_publico_activo IS NULL;

-- 3. Recrear v_clubes_publicos con COALESCE de ciudad y filtro de canchas activas
DROP VIEW IF EXISTS public.v_clubes_publicos;

CREATE VIEW public.v_clubes_publicos
  WITH (security_invoker = false)
AS
SELECT
  c.id,
  c.nombre,
  c.slug,
  c.descripcion,
  c.direccion,
  COALESCE(NULLIF(TRIM(c.ciudad), ''), 'Salta') AS ciudad,
  COALESCE(NULLIF(TRIM(c.provincia), ''), 'Salta') AS provincia,
  c.telefono,
  c.email,
  c.hora_apertura,
  c.hora_cierre,
  c.logo_path,
  c.color_primario_hsl,
  c.lat,
  c.lng,
  c.instagram,
  c.website,
  -- Foto de portada (subquery escalar — NULL si no hay fotos)
  (
    SELECT f.url
    FROM public.club_fotos f
    WHERE f.club_id = c.id AND f.es_portada = TRUE
    LIMIT 1
  ) AS portada_url,
  -- Campos públicos de seña derivados de config
  COALESCE((c.config->'deposito'->>'obligatorio')::boolean, false) AS sena_obligatoria,
  c.config->'deposito'->>'tipo' AS sena_tipo,
  (c.config->'deposito'->>'valor')::numeric AS sena_valor,
  c.config->'deposito'->>'transferencia_alias' AS sena_alias,
  COALESCE((c.config->'mercadopago'->>'conectado')::boolean, false) AS mercadopago_habilitado
FROM public.clubes c
WHERE c.perfil_publico_activo = TRUE
  AND c.estado IN ('trial', 'activo')
  AND c.activo = TRUE
  AND EXISTS (
    SELECT 1 FROM public.canchas can
    WHERE can.club_id = c.id AND can.activa = TRUE
  );

COMMENT ON VIEW public.v_clubes_publicos IS 
  'Vista pública de clubes con al menos una cancha activa, default de ciudad Salta y configuración de seña pública.';

GRANT SELECT ON public.v_clubes_publicos TO anon;
GRANT SELECT ON public.v_clubes_publicos TO authenticated;
