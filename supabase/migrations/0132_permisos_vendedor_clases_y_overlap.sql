-- ============================================================================
-- Migration 0132_permisos_vendedor_clases_y_overlap.sql
--
-- 1. Permite a usuarios con rol 'vendedor' crear, modificar y eliminar clases
--    (en particular clases de una única fecha agendadas desde la grilla de reservas).
--    Actualiza las políticas RLS sobre la tabla `clases`.
--
-- 2. Actualiza el trigger `fn_check_clase_no_overlap_reservas()` para que,
--    en el caso de clases no recurrentes (es_recurrente = FALSE), valide
--    solapamientos únicamente contra la fecha puntual de la clase (fecha_clase),
--    evitando falsos positivos con reservas de semanas futuras.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. RLS en tabla clases: permitir 'admin' y 'vendedor'
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "clases_insert_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_update_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_delete_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_insert_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_update_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_delete_admin_vendedor" ON clases;

CREATE POLICY "clases_insert_admin_vendedor"
ON clases FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

CREATE POLICY "clases_update_admin_vendedor"
ON clases FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

CREATE POLICY "clases_delete_admin_vendedor"
ON clases FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

-- Asegurar permisos a nivel tabla
GRANT SELECT, INSERT, UPDATE, DELETE ON clases TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE clases_id_seq TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Trigger anti-overlap: contemplar es_recurrente y fecha_clase
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_check_clase_no_overlap_reservas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conflicto RECORD;
  v_dur_interval INTERVAL;
BEGIN
  -- Una clase inactiva no ocupa la grilla, no hace falta validar.
  IF NEW.activa = FALSE THEN
    RETURN NEW;
  END IF;

  v_dur_interval := (NEW.duracion_min || ' minutes')::interval;

  SELECT
    r.fecha,
    r.hora_inicio,
    r.hora_fin,
    j.nombre AS jugador_nombre
    INTO v_conflicto
  FROM reservas r
  LEFT JOIN jugadores j ON j.id = r.jugador_id
  WHERE r.club_id = NEW.club_id
    AND r.cancha_id = NEW.cancha_id
    AND r.fecha >= CURRENT_DATE
    AND r.estado != 'cancelada'
    AND (
      (NEW.es_recurrente IS NOT FALSE AND EXTRACT(ISODOW FROM r.fecha)::INT = ANY(NEW.dias_semana))
      OR
      (NEW.es_recurrente IS FALSE AND r.fecha = NEW.fecha_clase)
    )
    AND tsrange(
      (r.fecha + r.hora_inicio)::timestamp,
      (r.fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
    ) && tsrange(
      (r.fecha + NEW.hora_inicio)::timestamp,
      (r.fecha + NEW.hora_inicio + v_dur_interval)::timestamp
    )
  ORDER BY r.fecha, r.hora_inicio
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'No se puede crear o modificar la clase porque se solapa con una reserva existente el % a las % (jugador: %). Cancelá o mové la reserva primero.',
      to_char(v_conflicto.fecha, 'DD/MM/YYYY'),
      to_char(v_conflicto.hora_inicio, 'HH24:MI'),
      COALESCE(v_conflicto.jugador_nombre, 'anónimo');
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
