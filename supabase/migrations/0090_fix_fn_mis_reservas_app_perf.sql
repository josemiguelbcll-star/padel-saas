-- ============================================================================
-- 0090 — Optimización de alto rendimiento para fn_mis_reservas_app
--
-- Problema resuelto: El JOIN directo evaluando fn_normalizar_telefono(j.telefono)
-- sobre la tabla reservas completa producía escaneos secuenciales y timeouts de 20s+.
--
-- Solución:
--   1. Extraer los IDs de jugadores coincidentes en v_jugador_ids vía el índice idx_jugadores_tel_norm.
--   2. Filtrar la tabla reservas directamente con `r.jugador_id = ANY(v_jugador_ids)`, usando el índice primario/FK.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_mis_reservas_app()
RETURNS TABLE(
  id            BIGINT,
  club_id       BIGINT,
  club_nombre   TEXT,
  cancha_nombre TEXT,
  fecha         DATE,
  hora_inicio   TIME,
  hora_fin      TIME,
  duracion_min  INTEGER,
  estado        TEXT,
  monto_total   NUMERIC(12,2),
  monto_pagado  NUMERIC(12,2),
  es_futura     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_tel_norm    TEXT;
  v_jugador_ids BIGINT[];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sin sesión activa';
  END IF;

  -- Obtener teléfono normalizado del jugador autenticado
  SELECT fn_normalizar_telefono(ja.telefono)
  INTO   v_tel_norm
  FROM   jugadores_app ja
  WHERE  ja.auth_user_id = v_user_id
    AND  ja.activo = TRUE;

  -- Sin teléfono registrado → no hay matching posible
  IF v_tel_norm IS NULL THEN
    RETURN;
  END IF;

  -- Obtener IDs de jugadores cuyos teléfonos normalizados coincidan
  SELECT array_agg(j.id)
  INTO   v_jugador_ids
  FROM   jugadores j
  WHERE  fn_normalizar_telefono(j.telefono) = v_tel_norm;

  IF v_jugador_ids IS NULL OR array_length(v_jugador_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Próximas + últimas 10 históricas
  RETURN QUERY
  WITH proximas AS (
    SELECT
      r.id,
      r.club_id,
      cl.nombre::TEXT   AS club_nombre,
      ca.nombre::TEXT   AS cancha_nombre,
      r.fecha,
      r.hora_inicio,
      r.hora_fin,
      r.duracion_min,
      r.estado::TEXT,
      r.monto_total,
      r.monto_pagado,
      TRUE              AS es_futura
    FROM   reservas  r
    JOIN   canchas   ca ON ca.id = r.cancha_id
    JOIN   clubes    cl ON cl.id = r.club_id
    WHERE  r.jugador_id = ANY(v_jugador_ids)
      AND  r.fecha >= CURRENT_DATE
      AND  r.estado != 'cancelada'
  ),
  historial AS (
    SELECT
      r.id,
      r.club_id,
      cl.nombre::TEXT   AS club_nombre,
      ca.nombre::TEXT   AS cancha_nombre,
      r.fecha,
      r.hora_inicio,
      r.hora_fin,
      r.duracion_min,
      r.estado::TEXT,
      r.monto_total,
      r.monto_pagado,
      FALSE             AS es_futura
    FROM   reservas  r
    JOIN   canchas   ca ON ca.id = r.cancha_id
    JOIN   clubes    cl ON cl.id = r.club_id
    WHERE  r.jugador_id = ANY(v_jugador_ids)
      AND  (r.fecha < CURRENT_DATE OR r.estado = 'cancelada')
    ORDER BY r.fecha DESC, r.hora_inicio DESC
    LIMIT 10
  )
  SELECT * FROM proximas
  UNION ALL
  SELECT * FROM historial
  ORDER BY es_futura DESC, fecha ASC, hora_inicio ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_mis_reservas_app IS
  'Devuelve las reservas del jugador autenticado cruzadas por teléfono normalizado optimizado por array_agg(jugador_id).
   Próximas (fecha >= hoy, no canceladas) + historial (últimas 10, por fecha DESC).
   SECURITY DEFINER: lee reservas de todos los clubes para el matching cross-club.
   Si el jugador no tiene teléfono registrado, devuelve conjunto vacío.';

GRANT EXECUTE ON FUNCTION public.fn_mis_reservas_app() TO authenticated;
