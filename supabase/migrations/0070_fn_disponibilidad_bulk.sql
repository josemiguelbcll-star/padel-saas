-- 0070: fn_disponibilidad_bulk
-- Igual que fn_disponibilidad_publica (0069) pero para TODOS los clubes públicos activos.
-- 1 query por fecha — sin N+1 desde el frontend.
-- SECURITY DEFINER (pública, sin current_club_id()).

CREATE OR REPLACE FUNCTION fn_disponibilidad_bulk(
  p_fecha DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  club_slug     TEXT,
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
  WITH clubes_publicos AS (
    SELECT c.id, c.slug, c.hora_apertura, c.hora_cierre, c.duracion_turno_default
    FROM clubes c
    WHERE c.perfil_publico_activo = TRUE
      AND c.estado IN ('trial', 'activo')
      AND c.activo = TRUE
  ),

  canchas_activas AS (
    SELECT ca.id, ca.nombre, ca.club_id
    FROM canchas ca
    JOIN clubes_publicos cl ON ca.club_id = cl.id
    WHERE ca.activa = TRUE
  ),

  -- Paso del grid por club: menor duración configurada para p_fecha
  -- Fallback: duracion_turno_default del club
  paso_por_club AS (
    SELECT
      cl.id AS club_id,
      COALESCE(
        (
          SELECT MIN(d)
          FROM franjas_turno f
          CROSS JOIN LATERAL unnest(f.duraciones_min) AS d
          WHERE f.club_id = cl.id
            AND f.activa = TRUE
            AND (
              f.dias_semana IS NULL
              OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(f.dias_semana)
            )
        ),
        cl.duracion_turno_default
      ) AS paso
    FROM clubes_publicos cl
  ),

  -- Grid de horas de inicio por club
  time_grid AS (
    SELECT
      cl.id   AS club_id,
      cl.slug AS club_slug,
      (cl.hora_apertura + (gs.n * (pc.paso::TEXT || ' min')::INTERVAL))::TIME AS hora
    FROM clubes_publicos cl
    JOIN paso_por_club pc ON pc.club_id = cl.id
    CROSS JOIN LATERAL generate_series(
      0,
      GREATEST(0,
        FLOOR(
          EXTRACT(EPOCH FROM (cl.hora_cierre - cl.hora_apertura)) / 60.0
          / pc.paso
        )::INT - 1
      )
    ) AS gs(n)
  ),

  -- Resolver duraciones desde franjas_turno por (club, cancha, hora)
  slot_base AS (
    SELECT
      tg.club_slug,
      ca.id     AS cancha_id,
      ca.nombre AS cancha_nombre,
      tg.hora   AS hora_inicio,
      ca.club_id,
      COALESCE(
        (
          SELECT f.duraciones_min
          FROM franjas_turno f
          WHERE f.club_id = ca.club_id
            AND f.activa = TRUE
            AND (f.cancha_id IS NULL OR f.cancha_id = ca.id)
            AND (
              f.dias_semana IS NULL
              OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(f.dias_semana)
            )
            AND (f.desde_hora IS NULL OR tg.hora >= f.desde_hora)
            AND (f.hasta_hora IS NULL OR tg.hora <  f.hasta_hora)
          ORDER BY
            (f.cancha_id IS NOT NULL) DESC,
            f.prioridad DESC,
            f.id DESC
          LIMIT 1
        ),
        (SELECT ARRAY[pc.paso]::INTEGER[] FROM paso_por_club pc WHERE pc.club_id = ca.club_id)
      ) AS duraciones
    FROM canchas_activas ca
    JOIN time_grid tg ON tg.club_id = ca.club_id
  ),

  -- Expandir duraciones → un slot por duración válida
  slots AS (
    SELECT
      sb.club_slug,
      sb.cancha_id,
      sb.cancha_nombre,
      sb.hora_inicio,
      (sb.hora_inicio + (dur::TEXT || ' min')::INTERVAL)::TIME AS hora_fin
    FROM slot_base sb
    CROSS JOIN LATERAL unnest(sb.duraciones) AS dur
    JOIN clubes_publicos cl ON cl.slug = sb.club_slug
    WHERE (sb.hora_inicio + (dur::TEXT || ' min')::INTERVAL)::TIME <= cl.hora_cierre
  ),

  -- Reservas activas del día
  ocupados AS (
    SELECT r.cancha_id, r.hora_inicio
    FROM reservas r
    JOIN canchas_activas ca ON r.cancha_id = ca.id
    WHERE r.fecha = p_fecha
      AND r.estado <> 'cancelada'
  )

  SELECT
    s.club_slug,
    s.cancha_id,
    s.cancha_nombre,
    s.hora_inicio,
    s.hora_fin,
    NOT EXISTS (
      SELECT 1 FROM ocupados o
      WHERE o.cancha_id   = s.cancha_id
        AND o.hora_inicio  = s.hora_inicio
    ) AS disponible
  FROM slots s
  ORDER BY s.club_slug, s.cancha_nombre, s.hora_inicio, s.hora_fin
$$;
