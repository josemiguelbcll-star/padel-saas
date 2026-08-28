-- ============================================================================
-- 0099_fix_jugadores_app_email_reservar.sql
-- Corrección de campos en jugadores_app (email y nombre_display) al reservar o aceptar desafíos.
-- ============================================================================

-- 1. Recrear fn_reservar_desde_app con email resuelto desde auth.users y nombre_display
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

  -- Resolver email desde auth.users ya que jugadores_app no tiene la columna directamente
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

  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.cancha_id = p_cancha_id AND r.fecha = p_fecha
      AND r.estado NOT IN ('cancelada')
      AND r.hora_inicio < v_hora_fin
      AND fn_calcular_hora_fin(r.hora_inicio, r.duracion_min) > p_hora_inicio
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

  -- Resolver o crear vinculación jugador_app <-> jugadores (por club) usando email de auth.users y nombre_display
  SELECT id INTO v_jugador_id FROM jugadores
  WHERE club_id = v_club_id AND email = v_email AND activo = TRUE LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono)
    VALUES (v_club_id, v_jugador_app.nombre_display, v_email, v_jugador_app.telefono)
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


-- 2. Recrear fn_aceptar_desafio con email resuelto desde auth.users y nombre_display
CREATE OR REPLACE FUNCTION public.fn_aceptar_desafio(
  p_desafio_id BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id             UUID;
  v_desafio             desafios%ROWTYPE;
  v_jugador_app_destino jugadores_app%ROWTYPE;
  v_email_destino       TEXT;
  v_club_id             BIGINT;
  v_cancha_id           BIGINT;
  v_fecha               DATE;
  v_hora_inicio         TIME;
  v_duracion_min        INTEGER;
  v_hora_fin            TIME;
  
  v_tarifa_id           BIGINT;
  v_monto_total         NUMERIC(12,2);
  v_jugador_id_de       BIGINT;
  v_jugador_id_para     BIGINT;
  
  v_jugador_app_origen  jugadores_app%ROWTYPE;
  v_email_origen        TEXT;
  v_reserva_id          BIGINT;
  
  -- Datos del club para notificar/Mercado Pago
  v_cbu_alias           TEXT;
  v_nombre_banco        TEXT;
  v_sena_porcentaje     INTEGER;
  v_config              JSONB;
  v_sena_tipo           TEXT;
  v_sena_valor          NUMERIC;
  v_monto_sena          NUMERIC(12,2);
  
  v_cancha_nombre       TEXT;
  v_club_nombre         TEXT;
  v_club_instagram      TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  SELECT * INTO v_desafio FROM desafios WHERE id = p_desafio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Desafio no encontrado'; END IF;

  SELECT * INTO v_jugador_app_destino
  FROM jugadores_app WHERE id = v_desafio.jugador_app_id_para AND auth_user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solo el destino puede aceptar'; END IF;

  IF v_desafio.estado != 'pendiente' THEN RAISE EXCEPTION 'Desafio ya fue respondido'; END IF;

  v_club_id     := v_desafio.club_id;
  v_cancha_id   := v_desafio.cancha_id;
  v_fecha       := v_desafio.fecha;
  v_hora_inicio := v_desafio.hora_inicio;
  v_duracion_min := v_desafio.duracion_min;
  v_hora_fin    := fn_calcular_hora_fin(v_hora_inicio, v_duracion_min);

  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.cancha_id = v_cancha_id AND r.fecha = v_fecha
      AND r.estado NOT IN ('cancelada')
      AND r.hora_inicio < v_hora_fin
      AND fn_calcular_hora_fin(r.hora_inicio, r.duracion_min) > v_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible';
  END IF;

  SELECT id, precio INTO v_tarifa_id, v_monto_total
  FROM tarifas
  WHERE cancha_id = v_cancha_id AND activo = TRUE
    AND hora_inicio <= v_hora_inicio AND hora_fin > v_hora_inicio
    AND (vigente_desde IS NULL OR vigente_desde <= v_fecha)
    AND (vigente_hasta IS NULL OR vigente_hasta >= v_fecha)
    AND (duracion_min IS NULL OR duracion_min = v_duracion_min)
  ORDER BY duracion_min NULLS LAST, vigente_desde DESC NULLS LAST
  LIMIT 1;

  IF v_tarifa_id IS NULL THEN
    RAISE EXCEPTION 'No hay precio configurado para ese horario';
  END IF;

  SELECT * INTO v_jugador_app_origen FROM jugadores_app WHERE id = v_desafio.jugador_app_id_de;

  -- Resolver emails desde auth.users
  SELECT email INTO v_email_origen FROM auth.users WHERE id = v_jugador_app_origen.auth_user_id;
  SELECT email INTO v_email_destino FROM auth.users WHERE id = v_jugador_app_destino.auth_user_id;

  -- Resolver/crear jugadores locales usando email de auth.users y nombre_display
  SELECT id INTO v_jugador_id_de FROM jugadores
  WHERE club_id = v_club_id AND email = v_email_origen AND activo = TRUE LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono)
    VALUES (v_club_id, v_jugador_app_origen.nombre_display, v_email_origen, v_jugador_app_origen.telefono)
    RETURNING id INTO v_jugador_id_de;
  END IF;

  SELECT id INTO v_jugador_id_para FROM jugadores
  WHERE club_id = v_club_id AND email = v_email_destino AND activo = TRUE LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono)
    VALUES (v_club_id, v_jugador_app_destino.nombre_display, v_email_destino, v_jugador_app_destino.telefono)
    RETURNING id INTO v_jugador_id_para;
  END IF;

  SELECT cl.nombre, cl.cbu_alias, cl.nombre_banco, cl.sena_porcentaje, cl.instagram, cl.config
  INTO v_club_nombre, v_cbu_alias, v_nombre_banco, v_sena_porcentaje, v_club_instagram, v_config
  FROM clubes cl WHERE cl.id = v_club_id;

  IF v_cbu_alias IS NULL AND v_config IS NOT NULL THEN
    v_cbu_alias := v_config->'deposito'->>'transferencia_alias';
  END IF;

  SELECT nombre INTO v_cancha_nombre FROM canchas WHERE id = v_cancha_id;

  v_sena_tipo := COALESCE(v_config->'deposito'->>'sena_tipo', 'porcentaje');
  v_sena_valor := COALESCE((v_config->'deposito'->>'sena_valor')::NUMERIC, v_sena_porcentaje);

  IF v_sena_tipo = 'fijo' THEN
    v_monto_sena := LEAST(v_sena_valor, v_monto_total);
  ELSE
    v_monto_sena := ROUND((v_monto_total * v_sena_valor / 100.0), 2);
  END IF;

  IF v_desafio.quien_paga = 'de' THEN
    INSERT INTO reservas (
      club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
      duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
      estado, observaciones
    ) VALUES (
      v_club_id, v_cancha_id, v_jugador_id_de, v_fecha, v_hora_inicio, v_hora_fin,
      v_duracion_min, v_tarifa_id, v_monto_total, v_monto_sena, 0,
      'pendiente', 'Reserva de desafío Padel Match (paga el proponente).'
    ) RETURNING id INTO v_reserva_id;
  ELSIF v_desafio.quien_paga = 'para' THEN
    INSERT INTO reservas (
      club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
      duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
      estado, observaciones
    ) VALUES (
      v_club_id, v_cancha_id, v_jugador_id_para, v_fecha, v_hora_inicio, v_hora_fin,
      v_duracion_min, v_tarifa_id, v_monto_total, v_monto_sena, 0,
      'pendiente', 'Reserva de desafío Padel Match (paga el desafiado).'
    ) RETURNING id INTO v_reserva_id;
  ELSE
    -- 50_50 se creará a nombre de v_jugador_id_de con nota aclaratoria
    INSERT INTO reservas (
      club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
      duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
      estado, observaciones
    ) VALUES (
      v_club_id, v_cancha_id, v_jugador_id_de, v_fecha, v_hora_inicio, v_hora_fin,
      v_duracion_min, v_tarifa_id, v_monto_total, v_monto_sena, 0,
      'pendiente', 'Reserva de desafío Padel Match (pago dividido).'
    ) RETURNING id INTO v_reserva_id;
  END IF;

  INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
  VALUES (v_club_id, v_reserva_id, v_jugador_id_de, TRUE);

  INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
  VALUES (v_club_id, v_reserva_id, v_jugador_id_para, FALSE);

  UPDATE desafios
  SET estado = 'aceptado', reserva_id = v_reserva_id, respondido_en = NOW()
  WHERE id = p_desafio_id;

  RETURN json_build_object(
    'reserva_id', v_reserva_id,
    'cancha_nombre', v_cancha_nombre,
    'club_nombre', v_club_nombre,
    'fecha', v_fecha,
    'hora_inicio', v_hora_inicio,
    'hora_fin', v_hora_fin,
    'duracion_min', v_duracion_min,
    'monto_total', v_monto_total,
    'monto_sena', v_monto_sena,
    'cbu_alias', v_cbu_alias,
    'nombre_banco', v_nombre_banco,
    'club_instagram', v_club_instagram
  );
END;
$$;
