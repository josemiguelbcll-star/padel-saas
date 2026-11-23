-- ============================================================================
-- Migración 0171: Reserva desde app alineada con disponibilidad
-- ============================================================================
-- Problema
--   1) fn_reservar_desde_app (4 args), usada por el flujo autenticado + MP,
--      no ignoraba el turno fijo cuando esa fecha ya estaba liberada
--      (cancelada). La disponibilidad pública SÍ lo muestra libre → el jugador
--      ve el slot, reserva y recibe "reservado para turno fijo".
--   2) La wrapper de fn_disponibilidad_publica (0152) cancelaba las
--      pre-reservas MP vencidas y después buscaba de nuevo filas
--      pendientes+vencidas (ya no existen). El OR extra era código muerto y
--      podía dejar slots mal marcados si el UPDATE no coincidía.
--
-- Solución
--   Reaplicar el cuerpo vigente (0126 + DEFINER 0147) con el mismo escape de
--   turno fijo liberado que ya tiene fn_crear_reserva (0129/0166).
--   La disponibilidad pública, tras expirar holds, delega 1:1 en la función
--   interna.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_reservar_desde_app(
  p_cancha_id BIGINT,
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_jugador_app jugadores_app%ROWTYPE;
  v_club_id BIGINT;
  v_cancha_nombre TEXT;
  v_cancha_tarifa_id BIGINT;
  v_club_nombre TEXT;
  v_cbu_alias TEXT;
  v_nombre_banco TEXT;
  v_sena_porcentaje NUMERIC;
  v_club_instagram TEXT;
  v_config JSONB;
  v_hora_fin TIME;
  v_tarifa_id BIGINT;
  v_monto_total DECIMAL(12,2);
  v_monto_sena DECIMAL(12,2);
  v_sena_tipo TEXT;
  v_sena_valor NUMERIC;
  v_jugador_id BIGINT;
  v_reserva_id BIGINT;
  v_email TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  SELECT * INTO v_jugador_app
  FROM jugadores_app WHERE auth_user_id = v_user_id AND activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completá tu perfil antes de reservar'; END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_jugador_app.auth_user_id;

  SELECT c.club_id, c.nombre, c.tarifa_id INTO v_club_id, v_cancha_nombre, v_cancha_tarifa_id
  FROM canchas c WHERE c.id = p_cancha_id AND c.activa = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancha no disponible'; END IF;

  SELECT cl.nombre, cl.cbu_alias, cl.nombre_banco, cl.sena_porcentaje, cl.instagram, cl.config
  INTO v_club_nombre, v_cbu_alias, v_nombre_banco, v_sena_porcentaje, v_club_instagram, v_config
  FROM clubes cl WHERE cl.id = v_club_id AND cl.activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club no disponible'; END IF;

  IF v_cbu_alias IS NULL AND v_config IS NOT NULL THEN
    v_cbu_alias := v_config->'deposito'->>'transferencia_alias';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  UPDATE public.reservas
  SET estado = 'cancelada',
      mp_estado = 'expirada',
      observaciones = concat_ws(E'\n', NULLIF(observaciones, ''), 'Pre-reserva MP vencida sin pago.')
  WHERE club_id = v_club_id
    AND cancha_id = p_cancha_id
    AND fecha = p_fecha
    AND estado = 'pendiente'
    AND mp_estado = 'pre_reserva'
    AND mp_expira_en <= NOW();

  IF EXISTS (
    SELECT 1 FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND (
        (c.es_recurrente IS NOT FALSE AND EXTRACT(ISODOW FROM p_fecha)::INT = ANY(c.dias_semana))
        OR (c.es_recurrente IS FALSE AND c.fecha_clase = p_fecha)
      )
      AND NOT EXISTS (
        SELECT 1 FROM clase_ocurrencias co
        WHERE co.clase_id = c.id
          AND co.fecha = p_fecha
          AND co.estado IN ('cancelada', 'liberada')
      )
      AND tsrange(
        (p_fecha + c.hora_inicio)::timestamp,
        (p_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario coincide con una clase configurada en la cancha.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM turnos_fijos tf
    WHERE tf.club_id = v_club_id
      AND tf.cancha_id = p_cancha_id
      AND tf.activo = TRUE
      AND tf.dia_semana = EXTRACT(ISODOW FROM p_fecha)::INT
      AND tf.fecha_desde <= p_fecha
      AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha)
      AND tsrange(
        ('1970-01-01'::date + tf.hora_inicio)::timestamp,
        ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
      AND NOT EXISTS (
        SELECT 1 FROM reservas r_cancel
        WHERE r_cancel.club_id = v_club_id
          AND r_cancel.turno_fijo_id = tf.id
          AND r_cancel.fecha = p_fecha
          AND r_cancel.estado = 'cancelada'
      )
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible (reservado para turno fijo).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = p_cancha_id
      AND r.fecha = p_fecha
      AND r.estado NOT IN ('cancelada')
      AND tsrange(
        (p_fecha + r.hora_inicio)::timestamp,
        (p_fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible. Elegí otro horario.';
  END IF;

  IF v_cancha_tarifa_id IS NOT NULL THEN
    SELECT id, monto INTO v_tarifa_id, v_monto_total
    FROM tarifas
    WHERE id = v_cancha_tarifa_id AND activa = TRUE;
  END IF;

  IF v_tarifa_id IS NULL THEN
    SELECT id, monto INTO v_tarifa_id, v_monto_total
    FROM tarifas
    WHERE club_id = v_club_id AND activa = TRUE
      AND (vigente_desde IS NULL OR vigente_desde <= p_fecha)
      AND (vigente_hasta IS NULL OR vigente_hasta >= p_fecha)
      AND (
        dias_semana IS NULL
        OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(dias_semana)
      )
      AND (
        (desde_hora IS NULL AND hasta_hora IS NULL)
        OR (p_hora_inicio >= desde_hora AND p_hora_inicio < hasta_hora)
      )
      AND (duracion_min IS NULL OR duracion_min = p_duracion_min)
    ORDER BY duracion_min NULLS LAST, vigente_desde DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_tarifa_id IS NULL THEN
    RAISE EXCEPTION 'No hay tarifas disponibles para este slot.';
  END IF;

  SELECT id INTO v_jugador_id FROM jugadores
  WHERE club_id = v_club_id
    AND (
      (v_email IS NOT NULL AND email = v_email)
      OR (v_jugador_app.telefono IS NOT NULL AND telefono = v_jugador_app.telefono)
    )
    AND activo = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono, activo)
    VALUES (
      v_club_id,
      COALESCE(v_jugador_app.nombre_display, 'Jugador App'),
      v_email,
      v_jugador_app.telefono,
      TRUE
    )
    RETURNING id INTO v_jugador_id;
  END IF;

  v_sena_tipo := COALESCE(v_config->'deposito'->>'sena_tipo', 'porcentaje');
  v_sena_valor := COALESCE((v_config->'deposito'->>'sena_valor')::NUMERIC, v_sena_porcentaje);

  IF v_sena_tipo = 'fijo' THEN
    v_monto_sena := LEAST(v_sena_valor, v_monto_total);
  ELSE
    v_monto_sena := ROUND((v_monto_total * v_sena_valor / 100.0), 2);
  END IF;

  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
    duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
    estado, observaciones
  ) VALUES (
    v_club_id, p_cancha_id, v_jugador_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_duracion_min, v_tarifa_id, v_monto_total, v_monto_sena, 0,
    'pendiente', 'Reservado desde la aplicación móvil.'
  )
  RETURNING id INTO v_reserva_id;

  INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
  VALUES (v_club_id, v_reserva_id, v_jugador_id, TRUE);

  RETURN json_build_object(
    'reserva_id', v_reserva_id,
    'cancha_nombre', v_cancha_nombre,
    'club_nombre', v_club_nombre,
    'fecha', p_fecha,
    'hora_inicio', p_hora_inicio,
    'hora_fin', v_hora_fin,
    'duracion_min', p_duracion_min,
    'monto_total', v_monto_total,
    'monto_sena', v_monto_sena,
    'cbu_alias', v_cbu_alias,
    'nombre_banco', v_nombre_banco,
    'club_instagram', v_club_instagram
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER) IS
  'Reserva un slot desde la app del jugador. SECURITY DEFINER. Usada internamente por el overload con metodo_pago. 0171: respeta turnos fijos liberados.';

CREATE OR REPLACE FUNCTION public.fn_disponibilidad_publica(
  p_club_slug TEXT,
  p_fecha DATE
)
RETURNS TABLE (
  cancha_id BIGINT,
  cancha_nombre VARCHAR,
  hora_inicio TIME,
  hora_fin TIME,
  disponible BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
BEGIN
  SELECT id INTO v_club_id
  FROM public.clubes
  WHERE slug = p_club_slug AND activo = TRUE;

  IF v_club_id IS NULL THEN
    RETURN;
  END IF;

  WITH vencidas AS (
    UPDATE public.reservas
    SET estado = 'cancelada',
        mp_estado = 'expirada',
        observaciones = concat_ws(E'\n', NULLIF(observaciones, ''), 'Pre-reserva MP vencida sin pago.')
    WHERE club_id = v_club_id
      AND fecha = p_fecha
      AND estado = 'pendiente'
      AND mp_estado = 'pre_reserva'
      AND mp_expira_en <= NOW()
    RETURNING id, club_id, jugador_app_id
  )
  INSERT INTO public.notificaciones (
    jugador_app_id, titulo, mensaje, leido, fecha, tipo, metadata, club_id, link
  )
  SELECT v.jugador_app_id, 'Pre-reserva vencida',
    'No se recibió el pago dentro del plazo y el horario fue liberado.',
    FALSE, NOW(), 'reserva_pre_reserva_expirada',
    jsonb_build_object('reserva_id', v.id), v.club_id, '/player/partidos'
  FROM vencidas v
  WHERE v.jugador_app_id IS NOT NULL;

  RETURN QUERY
  SELECT
    s.cancha_id,
    s.cancha_nombre,
    s.hora_inicio,
    s.hora_fin,
    s.disponible
  FROM public.fn_disponibilidad_publica_sin_vencimientos(p_club_slug, p_fecha) s;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_disponibilidad_publica(TEXT, DATE) TO anon, authenticated;

COMMIT;
