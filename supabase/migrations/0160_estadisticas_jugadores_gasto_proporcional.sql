-- ============================================================================
-- 0160_estadisticas_jugadores_gasto_proporcional.sql
-- Calcula gasto_turnos y gasto_buffet de forma PROPORCIONAL por participante
-- en lugar de atribuir la totalidad de la reserva y consumos grupales al dueño.
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
  -- Reservas cerradas no canceladas con la cantidad total de participantes
  reservas_cerradas AS (
    SELECT 
      r.id AS reserva_id,
      r.fecha,
      r.monto_total,
      r.jugador_id AS owner_jugador_id,
      GREATEST(
        COALESCE(
          NULLIF((SELECT COUNT(*) FROM reserva_jugadores rj WHERE rj.reserva_id = r.id), 0),
          1
        ),
        1
      ) AS cant_jugadores
    FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
  ),

  -- Participaciones de jugadores en turnos cerrados
  -- (Cada participante registrado en reserva_jugadores; o si no hay reserva_jugadores, el titular/owner)
  participantes_turno AS (
    SELECT DISTINCT
      rj.jugador_id,
      rc.reserva_id,
      rc.fecha,
      rc.monto_total,
      rc.cant_jugadores
    FROM reservas_cerradas rc
    JOIN reserva_jugadores rj ON rj.reserva_id = rc.reserva_id
    WHERE rj.jugador_id IS NOT NULL
    UNION
    SELECT DISTINCT
      rc.owner_jugador_id AS jugador_id,
      rc.reserva_id,
      rc.fecha,
      rc.monto_total,
      rc.cant_jugadores
    FROM reservas_cerradas rc
    WHERE rc.owner_jugador_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reserva_jugadores rj WHERE rj.reserva_id = rc.reserva_id
      )
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

  -- Gasto proporcional en turnos de alquiler
  gasto_alquiler_proporcional AS (
    SELECT 
      pt.jugador_id,
      SUM(pt.monto_total / pt.cant_jugadores) AS total_alquiler
    FROM participantes_turno pt
    GROUP BY pt.jugador_id
  ),

  -- Pagos / cobros individuales de clases
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

  -- Consumos en turnos cerrados:
  -- 1) Consumo individual directo (jugador_id o reserva_jugador_id asignado)
  consumos_individuales_reserva AS (
    SELECT 
      COALESCE(rc.jugador_id, rj.jugador_id) AS jugador_id,
      SUM(rc.subtotal) AS total
    FROM reserva_consumos rc
    JOIN reservas r ON r.id = rc.reserva_id
    LEFT JOIN reserva_jugadores rj ON rj.id = rc.reserva_jugador_id
    WHERE rc.club_id = v_club_id
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
      AND COALESCE(rc.jugador_id, rj.jugador_id) IS NOT NULL
      AND COALESCE(cardinality(rc.reserva_jugadores_ids), 0) = 0
    GROUP BY COALESCE(rc.jugador_id, rj.jugador_id)
  ),

  -- 2) Consumo repartido entre grupo seleccionado (reserva_jugadores_ids)
  consumos_grupo_reserva AS (
    SELECT 
      rj.jugador_id,
      SUM(rc.subtotal / NULLIF(cardinality(rc.reserva_jugadores_ids), 0)) AS total
    FROM reserva_consumos rc
    JOIN reservas r ON r.id = rc.reserva_id
    CROSS JOIN LATERAL unnest(rc.reserva_jugadores_ids) AS sel_id
    JOIN reserva_jugadores rj ON rj.id = sel_id
    WHERE rc.club_id = v_club_id
      AND r.cerrado_en IS NOT NULL
      AND r.estado != 'cancelada'
      AND rj.jugador_id IS NOT NULL
      AND cardinality(rc.reserva_jugadores_ids) > 0
    GROUP BY rj.jugador_id
  ),

  -- 3) Consumo general / partido asignado proporcionalmente a los participantes
  consumos_generales_reserva AS (
    SELECT 
      pt.jugador_id,
      SUM(rc.subtotal / pt.cant_jugadores) AS total
    FROM reserva_consumos rc
    JOIN reservas_cerradas r ON r.reserva_id = rc.reserva_id
    JOIN participantes_turno pt ON pt.reserva_id = rc.reserva_id
    LEFT JOIN reserva_jugadores rj ON rj.id = rc.reserva_jugador_id
    WHERE rc.club_id = v_club_id
      AND rc.jugador_id IS NULL
      AND (rc.reserva_jugador_id IS NULL OR rj.jugador_id IS NULL)
      AND COALESCE(cardinality(rc.reserva_jugadores_ids), 0) = 0
    GROUP BY pt.jugador_id
  ),

  -- Consumos directos en clases
  consumos_clases AS (
    SELECT 
      coa.jugador_id,
      SUM(cc.subtotal) AS total
    FROM clase_consumos cc
    JOIN clase_ocurrencia_alumnos coa ON coa.id = cc.clase_alumno_id
    WHERE cc.club_id = v_club_id
      AND cc.fecha <= CURRENT_DATE
      AND coa.jugador_id IS NOT NULL
    GROUP BY coa.jugador_id
  ),

  -- Ventas directas de mostrador / buffet asignadas a jugador
  ventas_directas_jugador AS (
    SELECT 
      v.jugador_id,
      SUM(v.total) AS total
    FROM ventas v
    WHERE v.club_id = v_club_id
      AND v.jugador_id IS NOT NULL
      AND (v.activa = TRUE OR v.activa IS NULL)
    GROUP BY v.jugador_id
  ),

  -- Todas las visitas combinadas (solo turnos cerrados y clases pasadas)
  todas_visitas AS (
    SELECT pt.jugador_id, pt.fecha FROM participantes_turno pt
    UNION ALL
    SELECT cp.jugador_id, cp.fecha FROM clases_part cp
  )
  SELECT 
    j.id AS jugador_id,
    COALESCE(tv.cant_visitas, 0)::BIGINT AS visitas,
    (COALESCE(gap.total_alquiler, 0) + COALESCE(pcl.total_clase, 0))::DECIMAL(12,2) AS gasto_turnos,
    (
      COALESCE(cir.total, 0) + 
      COALESCE(cgr.total, 0) + 
      COALESCE(cgen.total, 0) + 
      COALESCE(ccl.total, 0) + 
      COALESCE(vdj.total, 0) +
      COALESCE(pcl.total_consumo_clase, 0)
    )::DECIMAL(12,2) AS gasto_buffet,
    (
      (COALESCE(gap.total_alquiler, 0) + COALESCE(pcl.total_clase, 0)) +
      (
        COALESCE(cir.total, 0) + 
        COALESCE(cgr.total, 0) + 
        COALESCE(cgen.total, 0) + 
        COALESCE(ccl.total, 0) + 
        COALESCE(vdj.total, 0) +
        COALESCE(pcl.total_consumo_clase, 0)
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
  LEFT JOIN gasto_alquiler_proporcional gap ON gap.jugador_id = j.id
  LEFT JOIN pagos_clase pcl ON pcl.jugador_id = j.id
  LEFT JOIN consumos_individuales_reserva cir ON cir.jugador_id = j.id
  LEFT JOIN consumos_grupo_reserva cgr ON cgr.jugador_id = j.id
  LEFT JOIN consumos_generales_reserva cgen ON cgen.jugador_id = j.id
  LEFT JOIN consumos_clases ccl ON ccl.jugador_id = j.id
  LEFT JOIN ventas_directas_jugador vdj ON vdj.jugador_id = j.id
  WHERE j.club_id = v_club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_estadisticas_jugadores() TO authenticated;
