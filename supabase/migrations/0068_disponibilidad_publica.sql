-- ============================================================================
-- 0068_disponibilidad_publica.sql
-- Disponibilidad pública de turnos + mejora v_clubes_publicos con portada
--
-- 1. Recrea v_clubes_publicos sumando portada_url (foto de portada).
-- 2. fn_disponibilidad_publica(slug, fecha): devuelve los slots libres
--    de cada cancha para la fecha dada. SECURITY DEFINER → accesible
--    por anon sin exponer datos sensibles.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. v_clubes_publicos — agrega portada_url para las cards de la landing
-- ============================================================================
DROP VIEW IF EXISTS v_clubes_publicos;

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
  c.website,
  -- Foto de portada (subquery escalar — NULL si no hay fotos)
  (
    SELECT f.url
    FROM club_fotos f
    WHERE f.club_id = c.id AND f.es_portada = TRUE
    LIMIT 1
  ) AS portada_url
FROM clubes c
WHERE c.perfil_publico_activo = TRUE
  AND c.estado IN ('trial', 'activo')
  AND c.activo = TRUE;

GRANT SELECT ON v_clubes_publicos TO anon;
GRANT SELECT ON v_clubes_publicos TO authenticated;


-- ============================================================================
-- 2. fn_disponibilidad_publica(p_slug, p_fecha)
--
-- Genera los slots del día a partir de hora_apertura, hora_cierre y
-- duracion_turno_default del club, luego marca cuáles están ocupados
-- (existe reserva no cancelada en ese horario para esa cancha).
--
-- Solo funciona para clubs con perfil_publico_activo = TRUE. Un club
-- sin perfil público devuelve 0 filas (no hay error, no hay leak).
--
-- SECURITY DEFINER: se ejecuta con los privilegios del dueño de la
-- función (bypassa RLS), igual que las vistas públicas de 0067. El
-- filtro WHERE reemplaza a la RLS.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_disponibilidad_publica(
  p_slug TEXT,
  p_fecha DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  cancha_id     BIGINT,
  cancha_nombre TEXT,
  hora_inicio   TIME,
  hora_fin      TIME,
  disponible    BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club_data AS (
    SELECT c.id, c.hora_apertura, c.hora_cierre, c.duracion_turno_default
    FROM clubes c
    WHERE c.slug = p_slug
      AND c.perfil_publico_activo = TRUE
      AND c.estado IN ('trial', 'activo')
      AND c.activo = TRUE
    LIMIT 1
  ),
  canchas_activas AS (
    SELECT ca.id, ca.nombre, ca.orden
    FROM canchas ca
    JOIN club_data cl ON ca.club_id = cl.id
    WHERE ca.activa = TRUE
  ),
  -- Genera slots: n=0 → primer slot, n=1 → segundo, etc.
  slots AS (
    SELECT
      can.id       AS cancha_id,
      can.nombre   AS cancha_nombre,
      (cl.hora_apertura + (gs.n * (cl.duracion_turno_default::TEXT || ' min')::INTERVAL))::TIME AS hora_inicio,
      (cl.hora_apertura + ((gs.n + 1) * (cl.duracion_turno_default::TEXT || ' min')::INTERVAL))::TIME AS hora_fin
    FROM club_data cl
    CROSS JOIN canchas_activas can
    CROSS JOIN LATERAL generate_series(
      0,
      GREATEST(
        0,
        FLOOR(
          EXTRACT(EPOCH FROM (cl.hora_cierre - cl.hora_apertura)) / 60.0
          / cl.duracion_turno_default
        )::INT - 1
      )
    ) AS gs(n)
    -- Excluye el último slot si su fin supera el cierre
    WHERE (cl.hora_apertura + ((gs.n + 1) * (cl.duracion_turno_default::TEXT || ' min')::INTERVAL))::TIME
            <= cl.hora_cierre
  ),
  -- Reservas activas (no canceladas) para la fecha pedida
  ocupados AS (
    SELECT r.cancha_id, r.hora_inicio
    FROM reservas r
    JOIN club_data cl ON r.club_id = cl.id
    WHERE r.fecha = p_fecha
      AND r.estado <> 'cancelada'
  )
  SELECT
    s.cancha_id,
    s.cancha_nombre,
    s.hora_inicio,
    s.hora_fin,
    NOT EXISTS (
      SELECT 1 FROM ocupados o
      WHERE o.cancha_id = s.cancha_id
        AND o.hora_inicio = s.hora_inicio
    ) AS disponible
  FROM slots s
  ORDER BY s.cancha_nombre, s.hora_inicio
$$;

COMMENT ON FUNCTION fn_disponibilidad_publica(TEXT, DATE) IS
  'Devuelve los slots de cada cancha (libre/ocupado) para un club público
   en una fecha dada. Solo clubes con perfil_publico_activo=TRUE. Accesible
   por anon (SECURITY DEFINER). Sin datos sensibles (solo horarios).';

GRANT EXECUTE ON FUNCTION fn_disponibilidad_publica(TEXT, DATE) TO anon;
GRANT EXECUTE ON FUNCTION fn_disponibilidad_publica(TEXT, DATE) TO authenticated;

COMMIT;
