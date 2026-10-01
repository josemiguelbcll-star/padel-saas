-- ============================================================================
-- 0128_estadisticas_jugadores_turnos_cerrados.sql
-- Actualiza fn_estadisticas_jugadores para calcular métricas (visitas, gasto turnos,
-- gasto buffet, último partido y ranking) ÚNICAMENTE en base a turnos ya cerrados
-- (cerrado_en IS NOT NULL) y clases pasadas (fecha <= CURRENT_DATE), excluyendo
-- turnos futuros, turnos abiertos o cancelados.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_estadisticas_jugadores()
RETURNS TABLE (
  jugador_id BIGINT,
  visitas BIGINT,
  gasto_turnos DECIMAL(12,2),
  gasto_buffet DECIMAL(12,2),
  gasto_total DECIMAL(12,2),
  ultimo_partido DATE
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH 
  -- Reservas cerradas no canceladas donde participó el jugador
  turnos_part AS (
    SELECT DISTINCT rj.jugador_id, r.id AS reserva_id, r.fecha
    FROM reserva_jugadores rj
    JOIN reservas r ON r.id = rj.reserva_id
    WHERE r.club_id = v_club_id 
      AND rj.jugador_id IS NOT NULL 
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
    UNION
    SELECT DISTINCT r.jugador_id, r.id AS reserva_id, r.fecha
    FROM reservas r
    WHERE r.club_id = v_club_id 
      AND r.jugador_id IS NOT NULL 
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
  ),
  -- Clases asistidas finalizadas / pasadas
  clases_part AS (
    SELECT DISTINCT coa.jugador_id, coa.clase_id, coa.fecha
    FROM clase_ocurrencia_alumnos coa
    LEFT JOIN clase_ocurrencias co ON co.clase_id = coa.clase_id AND co.fecha = coa.fecha AND co.club_id = coa.club_id
    WHERE coa.club_id = v_club_id 
      AND coa.jugador_id IS NOT NULL
      AND coa.fecha <= CURRENT_DATE
      AND (co.estado IS NULL OR co.estado NOT IN ('cancelada', 'liberada'))
  ),
  -- Pagos de alquiler en reservas CERRADAS
  pagos_alquiler_reserva AS (
    SELECT 
      COALESCE(rp.jugador_id, rj.jugador_id) AS jugador_id,
      SUM(COALESCE(rp.monto_alquiler, rp.monto)) AS total_alquiler
    FROM reserva_pagos rp
    JOIN reservas r ON r.id = rp.reserva_id
    LEFT JOIN reserva_jugadores rj ON rj.id = rp.reserva_jugador_id
    WHERE rp.club_id = v_club_id
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
      AND COALESCE(rp.jugador_id, rj.jugador_id) IS NOT NULL
    GROUP BY COALESCE(rp.jugador_id, rj.jugador_id)
  ),
  -- Pagos de clase
  pagos_clase AS (
    SELECT 
      COALESCE(cc.jugador_id, coa.jugador_id) AS jugador_id,
      SUM(COALESCE(cc.monto_clase, cc.monto)) AS total_clase,
      SUM(COALESCE(cc.monto_consumo, 0)) AS total_consumo_clase
    FROM clase_cobros cc
    LEFT JOIN clase_ocurrencia_alumnos coa ON coa.id = cc.clase_alumno_id
    WHERE cc.club_id = v_club_id
      AND cc.fecha <= CURRENT_DATE
      AND COALESCE(cc.jugador_id, coa.jugador_id) IS NOT NULL
    GROUP BY COALESCE(cc.jugador_id, coa.jugador_id)
  ),
  -- Pagos de consumos en reservas CERRADAS
  pagos_consumo_reserva AS (
    SELECT 
      COALESCE(rp.jugador_id, rj.jugador_id) AS jugador_id,
      SUM(COALESCE(rp.monto_consumo, 0)) AS total_consumo_reserva
    FROM reserva_pagos rp
    JOIN reservas r ON r.id = rp.reserva_id
    LEFT JOIN reserva_jugadores rj ON rj.id = rp.reserva_jugador_id
    WHERE rp.club_id = v_club_id
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
      AND COALESCE(rp.jugador_id, rj.jugador_id) IS NOT NULL
      AND COALESCE(rp.monto_consumo, 0) > 0
    GROUP BY COALESCE(rp.jugador_id, rj.jugador_id)
  ),
  -- Consumos directos asignados en reservas CERRADAS
  consumos_directos AS (
    SELECT 
      COALESCE(rc.jugador_id, rj.jugador_id) AS jugador_id,
      SUM(rc.subtotal) AS total_consumo_directo
    FROM reserva_consumos rc
    JOIN reservas r ON r.id = rc.reserva_id
    LEFT JOIN reserva_jugadores rj ON rj.id = rc.reserva_jugador_id
    WHERE rc.club_id = v_club_id
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
      AND COALESCE(rc.jugador_id, rj.jugador_id) IS NOT NULL
    GROUP BY COALESCE(rc.jugador_id, rj.jugador_id)
  ),
  -- Consumos directos asignados en clases finalizadas
  consumos_directos_clase AS (
    SELECT 
      coa.jugador_id,
      SUM(cc.subtotal) AS total_consumo_clase_directo
    FROM clase_consumos cc
    JOIN clase_ocurrencia_alumnos coa ON coa.id = cc.clase_alumno_id
    WHERE cc.club_id = v_club_id
      AND cc.fecha <= CURRENT_DATE
      AND coa.jugador_id IS NOT NULL
    GROUP BY coa.jugador_id
  ),
  -- Todas las visitas combinadas (solo partidos jugados y cerrados + clases pasadas)
  todas_visitas AS (
    SELECT tp.jugador_id, tp.fecha FROM turnos_part tp
    UNION ALL
    SELECT cp.jugador_id, cp.fecha FROM clases_part cp
  )
  SELECT 
    j.id AS jugador_id,
    COALESCE(tv.cant_visitas, 0)::BIGINT AS visitas,
    (COALESCE(par.total_alquiler, 0) + COALESCE(pcl.total_clase, 0))::DECIMAL(12,2) AS gasto_turnos,
    (
      GREATEST(COALESCE(pcr.total_consumo_reserva, 0), COALESCE(cd.total_consumo_directo, 0)) + 
      GREATEST(COALESCE(pcl.total_consumo_clase, 0), COALESCE(cdc.total_consumo_clase_directo, 0))
    )::DECIMAL(12,2) AS gasto_buffet,
    (
      (COALESCE(par.total_alquiler, 0) + COALESCE(pcl.total_clase, 0)) +
      (
        GREATEST(COALESCE(pcr.total_consumo_reserva, 0), COALESCE(cd.total_consumo_directo, 0)) + 
        GREATEST(COALESCE(pcl.total_consumo_clase, 0), COALESCE(cdc.total_consumo_clase_directo, 0))
      )
    )::DECIMAL(12,2) AS gasto_total,
    tv.max_fecha AS ultimo_partido
  FROM jugadores j
  LEFT JOIN (
    SELECT 
      v.jugador_id, 
      COUNT(*)::BIGINT AS cant_visitas,
      MAX(v.fecha) AS max_fecha
    FROM todas_visitas v
    GROUP BY v.jugador_id
  ) tv ON tv.jugador_id = j.id
  LEFT JOIN pagos_alquiler_reserva par ON par.jugador_id = j.id
  LEFT JOIN pagos_clase pcl ON pcl.jugador_id = j.id
  LEFT JOIN pagos_consumo_reserva pcr ON pcr.jugador_id = j.id
  LEFT JOIN consumos_directos cd ON cd.jugador_id = j.id
  LEFT JOIN consumos_directos_clase cdc ON cdc.jugador_id = j.id
  WHERE j.club_id = v_club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_estadisticas_jugadores() TO authenticated;
