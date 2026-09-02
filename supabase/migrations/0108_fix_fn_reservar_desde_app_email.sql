-- ============================================================================
-- 0108_fix_fn_reservar_desde_app_email.sql
-- Corrige fn_reservar_desde_app para resolver el email desde auth.users y
-- usar nombre_display de jugadores_app, evitando el error:
-- record "v_jugador_app" has no field "email"
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_reservar_desde_app(
  p_cancha_id    BIGINT,
  p_fecha        DATE,
  p_hora_inicio  TIME,
  p_duracion_min INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         UUID;
  v_jugador_app     jugadores_app%ROWTYPE;
  v_email           TEXT;
  v_club_id         BIGINT;
  v_cancha_nombre   TEXT;
  v_club_nombre     TEXT;
  v_cbu_alias       TEXT;
  v_nombre_banco    TEXT;
  v_sena_porcentaje INTEGER;
  v_club_instagram  TEXT;
  v_tarifa_id       BIGINT;
  v_monto_total     NUMERIC(12,2);
  v_jugador_id      BIGINT;
  v_hora_fin        TIME;
  v_reserva_id      BIGINT;
  v_monto_sena      NUMERIC(12,2);
  v_config          JSONB;
  v_sena_tipo       TEXT;
  v_sena_valor      NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  SELECT * INTO v_jugador_app
  FROM jugadores_app WHERE auth_user_id = v_user_id AND activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completá tu perfil antes de reservar'; END IF;

  -- Resolver email desde auth.users ya que jugadores_app no tiene la columna email
  SELECT email INTO v_email FROM auth.users WHERE id = v_jugador_app.auth_user_id;

  SELECT c.club_id, c.nombre INTO v_club_id, v_cancha_nombre
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

  -- 1. Chequeo de clases activas
  IF EXISTS (
    SELECT 1 FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND EXTRACT(ISODOW FROM p_fecha)::INT = ANY(c.dias_semana)
      AND tsrange(
        (p_fecha + c.hora_inicio)::timestamp,
        (p_fecha + fn_calcular_hora_fin(c.hora_inicio, c.duracion_min))::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario coincide con una clase configurada en la cancha.';
  END IF;

  -- 2. Chequeo de turnos fijos activos
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
        ('1970-01-01'::date + fn_calcular_hora_fin(tf.hora_inicio, tf.duracion_min))::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible (reservado para turno fijo).';
  END IF;

  -- 3. Chequeo de reservas existentes
  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = p_cancha_id
      AND r.fecha = p_fecha
      AND r.estado NOT IN ('cancelada')
      AND tsrange(
        (p_fecha + r.hora_inicio)::timestamp,
        (p_fecha + r.hora_fin)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible. Elegí otro horario.';
  END IF;

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

  IF v_tarifa_id IS NULL THEN
    RAISE EXCEPTION 'No hay tarifas disponibles para este slot.';
  END IF;

  -- Resolver o crear vinculación jugador_app <-> jugadores (por club)
  SELECT id INTO v_jugador_id FROM jugadores
  WHERE club_id = v_club_id 
    AND (
      (v_email IS NOT NULL AND email = v_email) 
      OR (v_jugador_app.telefono IS NOT NULL AND telefono = v_jugador_app.telefono)
    )
    AND activo = TRUE 
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono, es_socio, origen)
    VALUES (
      v_club_id, 
      COALESCE(v_jugador_app.nombre_display, 'Jugador App'), 
      v_email, 
      v_jugador_app.telefono, 
      FALSE, 
      'app'
    )
    RETURNING id INTO v_jugador_id;
  END IF;

  -- Resolver seña
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

GRANT EXECUTE ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER) TO authenticated;
