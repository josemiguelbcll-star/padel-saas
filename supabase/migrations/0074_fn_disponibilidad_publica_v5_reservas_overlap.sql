-- 0074: fn_disponibilidad_publica v5
-- BUG FIX (v4 → v5): el CTE ocupados_reservas comparaba r.hora_inicio = s.hora_inicio
-- de forma exacta, igual que el bug que se corrigió en 0073 para ocupados_fijos.
--
-- PROBLEMA: el paso_grid del club puede ser 90 min con apertura 07:30, generando
-- slots en 07:30, 09:00, 10:30, 12:00... Las reservas del admin se crean con
-- su propia grilla interna (p.ej. inicio en 08:30, 11:00, 12:30, 14:00, 17:00...)
-- que NO coincide con los inicios del grid público → NOT EXISTS nunca encuentra
-- match → TODOS los slots aparecen disponibles aunque el club esté lleno.
--
-- SOLUCIÓN: mismo patrón que ocupados_fijos (0073): detectar SOLAPAMIENTO.
-- Un slot (s.hora_inicio, s.hora_fin) es bloqueado por una reserva (r.hora_inicio, r.hora_fin)
-- cuando sus rangos solapan:
--   s.hora_inicio < r.hora_fin  AND  s.hora_fin > r.hora_inicio
-- Se usa DISTINCT sobre (cancha_id, hora_inicio) del slot porque un slot puede tener
-- varias duraciones y basta con que una de ellas solape para bloquearlo.

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
    SELECT ca.id, ca.nombre
    FROM canchas ca
    JOIN club_data cl ON ca.club_id = cl.id
    WHERE ca.activa = TRUE
  ),

  -- Paso del grid = menor duración configurada para el día p_fecha en franjas_turno.
  -- Si no hay franjas → usa duracion_turno_default.
  paso_grid AS (
    SELECT COALESCE(
      (
        SELECT MIN(d)
        FROM franjas_turno f
        CROSS JOIN LATERAL unnest(f.duraciones_min) AS d
        WHERE f.club_id = (SELECT id FROM club_data)
          AND f.activa = TRUE
          AND (
            f.dias_semana IS NULL
            OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(f.dias_semana)
          )
      ),
      (SELECT duracion_turno_default FROM club_data)
    ) AS paso
  ),

  -- Grid de horas de inicio: apertura → cierre, step = paso_grid
  time_grid AS (
    SELECT
      (cl.hora_apertura + (gs.n * (pg.paso::TEXT || ' min')::INTERVAL))::TIME AS hora
    FROM club_data cl, paso_grid pg
    CROSS JOIN LATERAL generate_series(
      0,
      GREATEST(0,
        FLOOR(
          EXTRACT(EPOCH FROM (cl.hora_cierre - cl.hora_apertura)) / 60.0
          / pg.paso
        )::INT - 1
      )
    ) AS gs(n)
  ),

  -- Para cada (cancha, hora_inicio): resolver duraciones permitidas por franjas_turno.
  slot_base AS (
    SELECT
      ca.id        AS cancha_id,
      ca.nombre    AS cancha_nombre,
      tg.hora      AS hora_inicio,
      COALESCE(
        (
          SELECT f.duraciones_min
          FROM franjas_turno f
          WHERE f.club_id = (SELECT id FROM club_data)
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
        (SELECT ARRAY[cl.duracion_turno_default]::INTEGER[] FROM club_data cl)
      ) AS duraciones
    FROM canchas_activas ca
    CROSS JOIN time_grid tg
  ),

  -- Expandir: un slot por cada duración válida; descartar los que superan hora_cierre
  slots AS (
    SELECT
      sb.cancha_id,
      sb.cancha_nombre,
      sb.hora_inicio,
      (sb.hora_inicio + (dur::TEXT || ' min')::INTERVAL)::TIME AS hora_fin
    FROM slot_base sb
    CROSS JOIN LATERAL unnest(sb.duraciones) AS dur
    JOIN club_data cl ON TRUE
    WHERE (sb.hora_inicio + (dur::TEXT || ' min')::INTERVAL)::TIME <= cl.hora_cierre
  ),

  -- ── OCUPADOS: reservas puntuales — detección por SOLAPAMIENTO ─────────────
  -- BUG FIX v5: ya no comparamos r.hora_inicio = s.hora_inicio (exacto).
  -- Una reserva (r.hora_inicio, r.hora_fin) bloquea todos los slots cuyo rango
  -- (s.hora_inicio, s.hora_fin) solapa con ella:
  --   s.hora_inicio < r.hora_fin  AND  s.hora_fin > r.hora_inicio
  -- DISTINCT sobre (cancha_id, hora_inicio) del slot: basta con que UNA duración
  -- del slot solape para bloquearlo.
  ocupados_reservas AS (
    SELECT DISTINCT s.cancha_id, s.hora_inicio
    FROM slots s
    JOIN reservas r ON r.cancha_id = s.cancha_id
    JOIN club_data cl ON r.club_id = cl.id
    WHERE r.fecha   = p_fecha
      AND r.estado <> 'cancelada'
      AND s.hora_inicio < r.hora_fin
      AND s.hora_fin    > r.hora_inicio
  ),

  -- ── OCUPADOS: turnos fijos vigentes — detección por SOLAPAMIENTO ──────────
  -- (mismo patrón introducido en 0073)
  ocupados_fijos AS (
    SELECT DISTINCT s.cancha_id, s.hora_inicio
    FROM slots s
    JOIN turnos_fijos tf ON tf.cancha_id = s.cancha_id
    JOIN club_data cl    ON tf.club_id   = cl.id
    WHERE tf.activo     = TRUE
      AND tf.dia_semana = EXTRACT(ISODOW FROM p_fecha)::INT
      AND tf.fecha_desde <= p_fecha
      AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha)
      AND s.hora_inicio < (tf.hora_inicio + (tf.duracion_min::TEXT || ' min')::INTERVAL)::TIME
      AND s.hora_fin    > tf.hora_inicio
  ),

  -- Unión de ambas fuentes de ocupación
  ocupados AS (
    SELECT cancha_id, hora_inicio FROM ocupados_reservas
    UNION
    SELECT cancha_id, hora_inicio FROM ocupados_fijos
  )

  SELECT
    s.cancha_id,
    s.cancha_nombre,
    s.hora_inicio,
    s.hora_fin,
    NOT EXISTS (
      SELECT 1 FROM ocupados o
      WHERE o.cancha_id   = s.cancha_id
        AND o.hora_inicio = s.hora_inicio
    ) AS disponible
  FROM slots s
  ORDER BY s.cancha_nombre, s.hora_inicio, s.hora_fin
$$;
