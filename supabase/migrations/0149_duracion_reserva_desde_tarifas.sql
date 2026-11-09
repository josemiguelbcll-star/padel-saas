CREATE OR REPLACE FUNCTION public.fn_actualizar_duracion_reserva(
  p_reserva_id BIGINT,
  p_duracion_min INTEGER
)
RETURNS public.reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva public.reservas;
  v_club_id BIGINT;
  v_duraciones INTEGER[];
  v_hora_fin TIMESTAMP;
  v_hora_cierre TIME;
  v_tarifa_id BIGINT;
  v_monto DECIMAL(12,2);
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL OR current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador del club puede cambiar la duración del turno.';
  END IF;

  SELECT r.*
    INTO v_reserva
  FROM public.reservas r
  WHERE r.id = p_reserva_id
    AND r.club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el turno en este club.';
  END IF;

  IF v_reserva.estado = 'cancelada' OR v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede cambiar la duración de un turno cancelado o cerrado.';
  END IF;

  IF p_duracion_min NOT IN (60, 90, 120, 150, 180, 240) THEN
    RAISE EXCEPTION 'La duración indicada no es válida.';
  END IF;

  IF p_duracion_min = v_reserva.duracion_min THEN
    RETURN v_reserva;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT t.duracion_min), ARRAY[]::INTEGER[])
    INTO v_duraciones
  FROM public.tarifas t
  WHERE t.club_id = v_club_id
    AND t.activa = TRUE
    AND t.vigente_desde <= v_reserva.fecha
    AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= v_reserva.fecha)
    AND (t.dias_semana IS NULL OR EXTRACT(ISODOW FROM v_reserva.fecha)::INTEGER = ANY(t.dias_semana))
    AND (
      (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
      OR (v_reserva.hora_inicio >= t.desde_hora AND v_reserva.hora_inicio < t.hasta_hora)
    )
    AND t.duracion_min IS NOT NULL;

  IF NOT (p_duracion_min = ANY(v_duraciones)) THEN
    RAISE EXCEPTION 'No hay una tarifa configurada para esa duración, franja horaria y fecha.';
  END IF;

  v_hora_fin := (v_reserva.fecha + v_reserva.hora_inicio)::TIMESTAMP
    + make_interval(mins => p_duracion_min);

  IF v_hora_fin::DATE <> v_reserva.fecha THEN
    RAISE EXCEPTION 'El turno no puede extenderse más allá del cierre del día.';
  END IF;

  SELECT c.hora_cierre
    INTO v_hora_cierre
  FROM public.clubes c
  WHERE c.id = v_club_id;

  IF v_hora_cierre IS NOT NULL
     AND v_hora_cierre <> TIME '00:00'
     AND v_hora_fin::TIME > v_hora_cierre THEN
    RAISE EXCEPTION 'La duración elegida supera el horario de cierre del club.';
  END IF;

  SELECT t.id, t.monto
    INTO v_tarifa_id, v_monto
  FROM public.tarifas t
  WHERE t.club_id = v_club_id
    AND t.activa = TRUE
    AND t.vigente_desde <= v_reserva.fecha
    AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= v_reserva.fecha)
    AND (t.dias_semana IS NULL OR EXTRACT(ISODOW FROM v_reserva.fecha)::INTEGER = ANY(t.dias_semana))
    AND (
      (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
      OR (v_reserva.hora_inicio >= t.desde_hora AND v_reserva.hora_inicio < t.hasta_hora)
    )
    AND (t.duracion_min IS NULL OR t.duracion_min = p_duracion_min)
  ORDER BY COALESCE(t.duracion_min = p_duracion_min, FALSE) DESC,
           t.prioridad DESC,
           t.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una tarifa vigente para esa duración, franja horaria y fecha.';
  END IF;

  IF v_monto < v_reserva.monto_pagado THEN
    RAISE EXCEPTION
      'La tarifa de % es menor a lo ya pagado (%). No se modificó el turno.',
      v_monto, v_reserva.monto_pagado;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = v_reserva.cancha_id
      AND c.activa = TRUE
      AND (
        (c.es_recurrente IS NOT FALSE AND EXTRACT(ISODOW FROM v_reserva.fecha)::INTEGER = ANY(c.dias_semana))
        OR (c.es_recurrente IS FALSE AND c.fecha_clase = v_reserva.fecha)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.clase_ocurrencias co
        WHERE co.clase_id = c.id
          AND co.fecha = v_reserva.fecha
          AND co.estado IN ('cancelada', 'liberada')
      )
      AND tsrange(
        (v_reserva.fecha + c.hora_inicio)::TIMESTAMP,
        (v_reserva.fecha + c.hora_inicio + (c.duracion_min || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(
        (v_reserva.fecha + v_reserva.hora_inicio)::TIMESTAMP,
        v_hora_fin
      )
  ) THEN
    RAISE EXCEPTION 'La duración elegida se solapa con una clase configurada en esa cancha.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.turnos_fijos tf
    WHERE tf.club_id = v_club_id
      AND tf.cancha_id = v_reserva.cancha_id
      AND tf.activo = TRUE
      AND tf.id IS DISTINCT FROM v_reserva.turno_fijo_id
      AND tf.dia_semana = EXTRACT(ISODOW FROM v_reserva.fecha)::INTEGER
      AND tf.fecha_desde <= v_reserva.fecha
      AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= v_reserva.fecha)
      AND tsrange(
        ('1970-01-01'::DATE + tf.hora_inicio)::TIMESTAMP,
        ('1970-01-01'::DATE + tf.hora_inicio + (tf.duracion_min || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(
        ('1970-01-01'::DATE + v_reserva.hora_inicio)::TIMESTAMP,
        ('1970-01-01'::DATE + v_reserva.hora_inicio)::TIMESTAMP + make_interval(mins => p_duracion_min)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reservas r_cancel
        WHERE r_cancel.club_id = v_club_id
          AND r_cancel.turno_fijo_id = tf.id
          AND r_cancel.fecha = v_reserva.fecha
          AND r_cancel.estado = 'cancelada'
      )
  ) THEN
    RAISE EXCEPTION 'La duración elegida se solapa con otro turno fijo activo.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = v_reserva.cancha_id
      AND r.fecha = v_reserva.fecha
      AND r.id <> v_reserva.id
      AND r.estado <> 'cancelada'
      AND tsrange(
        (r.fecha + r.hora_inicio)::TIMESTAMP,
        (r.fecha + r.hora_inicio + (r.duracion_min || ' minutes')::INTERVAL)::TIMESTAMP
      ) && tsrange(
        (v_reserva.fecha + v_reserva.hora_inicio)::TIMESTAMP,
        v_hora_fin
      )
  ) THEN
    RAISE EXCEPTION 'La duración elegida se solapa con otra reserva de esa cancha.';
  END IF;

  UPDATE public.reservas
  SET duracion_min = p_duracion_min,
      hora_fin = v_hora_fin::TIME,
      tarifa_id = v_tarifa_id,
      monto_total = v_monto,
      estado = CASE
        WHEN v_reserva.estado = 'jugada' THEN 'jugada'
        WHEN v_reserva.monto_pagado >= v_monto THEN 'pagada'
        WHEN v_reserva.monto_pagado > 0 THEN 'senada'
        ELSE 'pendiente'
      END
  WHERE id = v_reserva.id
    AND club_id = v_club_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION public.fn_actualizar_duracion_reserva(BIGINT, INTEGER) IS
  'Actualiza duración y precio desde las tarifas vigentes del horario. Valida '
  'cierre y solapamientos, sin modificar pagos ni consumos.';
