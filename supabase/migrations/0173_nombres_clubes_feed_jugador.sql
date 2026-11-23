-- 0173 — Nombres de club visibles en el feed del jugador
-- El jugador no puede leer public.clubes (RLS: solo current_club_id()).
-- El embed clubes(nombre) queda vacío y la UI muestra "Club".
-- Vista de solo id/nombre/slug, security_invoker=false (igual que v_clubes_publicos).

BEGIN;

CREATE OR REPLACE VIEW public.v_clubes_nombres_feed
  WITH (security_invoker = false)
AS
SELECT
  c.id,
  c.nombre,
  c.slug
FROM public.clubes c
WHERE c.activo = TRUE;

COMMENT ON VIEW public.v_clubes_nombres_feed IS
  'Nombres públicos de clubes para el feed de noticias del jugador. Sin datos sensibles.';

GRANT SELECT ON public.v_clubes_nombres_feed TO anon, authenticated;

COMMIT;
