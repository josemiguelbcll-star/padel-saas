-- 0095: Fix midnight reservations wrap-around and check constraint reservas_check1
-- Defines public.fn_calcular_hora_fin to handle midnight wrap-around (storing it as '24:00:00')
-- Updates:
--   - public.fn_crear_reserva
--   - public.fn_reservar_desde_app
--   - public.fn_materializar_turnos_fijos
--   - public.fn_aceptar_desafio
--   - public.fn_crear_turno_fijo
--   - public.fn_disponibilidad_publica
--   - public.fn_disponibilidad_bulk
--   - public.fn_disponibilidad_publica_franjas

-- Limpieza previa de funciones para evitar errores de cambio de tipo de retorno o valores por defecto
DROP FUNCTION IF EXISTS public.fn_crear_reserva(BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT, DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER);
DROP FUNCTION IF EXISTS public.fn_materializar_turnos_fijos(DATE, DATE);
DROP FUNCTION IF EXISTS public.fn_aceptar_desafio(BIGINT);
DROP FUNCTION IF EXISTS public.fn_crear_turno_fijo(BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.fn_disponibilidad_publica(TEXT, DATE);
DROP FUNCTION IF EXISTS public.fn_disponibilidad_bulk(TEXT[], DATE);
DROP FUNCTION IF EXISTS public.fn_disponibilidad_publica_franjas(TEXT, DATE);

CREATE OR REPLACE FUNCTION public.fn_calcular_hora_fin(
  p_inicio TIME,
  p_duracion INTEGER
)
RETURNS TIME
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_fin TIME;
BEGIN
  v_fin := p_inicio + (p_duracion || ' minutes')::interval;
  IF v_fin = '00:00:00'::time AND p_inicio > '00:00:00'::time THEN
    RETURN '24:00:00'::time;
  END IF;
  RETURN v_fin;
END;
$$;



CREATE OR REPLACE FUNCTION public.fn_crear_reserva(
  p_cancha_id BIGINT,
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INTEGER,
  p_jugador_titular_id BIGINT,
  p_jugadores_ids BIGINT[],
  p_nombres_libres VARCHAR[],
  p_tarifa_id BIGINT,
  p_monto_total DECIMAL,
  p_monto_pagado DECIMAL,
  p_medio_pago VARCHAR,
  p_estado VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva reservas;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_hora_fin TIME;
  v_monto_sena DECIMAL(12,2);
  v_tipo_pago VARCHAR(20);
  v_jid BIGINT;
  v_nombre VARCHAR;
  v_turno_fijo_titular_nombre VARCHAR;
  v_cuenta_id BIGINT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  -- Chequeo de clase activa (0005, sin cambios).
  IF EXISTS (
    SELECT 1
    FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND EXTRACT(ISODOW FROM p_fecha)::INT = ANY(c.dias_semana)
      AND tsrange(
        (p_fecha + c.hora_inicio)::timestamp,
        (p_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con una clase configurada en esa cancha.';
  END IF;

  -- Bloqueo de slots de turnos fijos activos vigentes (0031, sin cambios).
  SELECT COALESCE(j.nombre, tf.nombre_libre)
    INTO v_turno_fijo_titular_nombre
  FROM turnos_fijos tf
  LEFT JOIN jugadores j ON j.id = tf.jugador_id
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
      ('1970-01-01'::date + v_hora_fin)::timestamp
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Ese horario está reservado para el turno fijo de %. No se puede reservar suelto. Si querés liberar el slot, desactivá o eliminá el turno fijo desde Reservas → Turnos fijos.',
      v_turno_fijo_titular_nombre;
  END IF;

  v_monto_sena := CASE WHEN p_estado = 'senada' THEN p_monto_pagado ELSE 0 END;
  v_tipo_pago := CASE WHEN p_estado = 'senada' THEN 'sena' ELSE 'pago' END;

  -- 1. Insert reservas
  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
    duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
    estado, observaciones, usuario_alta_id
  ) VALUES (
    v_club_id, p_cancha_id, p_jugador_titular_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_duracion_min, p_tarifa_id, p_monto_total, v_monto_sena, p_monto_pagado,
    p_estado, p_observaciones, v_usuario_id
  ) RETURNING * INTO v_reserva;

  -- 2. Titular (si lo hay).
  IF p_jugador_titular_id IS NOT NULL THEN
    INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
    VALUES (v_club_id, v_reserva.id, p_jugador_titular_id, TRUE);
  END IF;

  -- 3. Acompañantes con jugador_id.
  IF p_jugadores_ids IS NOT NULL THEN
    FOREACH v_jid IN ARRAY p_jugadores_ids LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
      VALUES (v_club_id, v_reserva.id, v_jid, FALSE);
    END LOOP;
  END IF;

  -- 4. Acompañantes "nombre libre".
  IF p_nombres_libres IS NOT NULL THEN
    FOREACH v_nombre IN ARRAY p_nombres_libres LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, nombre_libre, es_titular)
      VALUES (v_club_id, v_reserva.id, v_nombre, FALSE);
    END LOOP;
  END IF;

  -- 5. Pago inicial si hubo.
  IF p_monto_pagado > 0 THEN
    IF p_medio_pago IS NULL THEN
      RAISE EXCEPTION 'Si hay un pago, el medio de pago es obligatorio.';
    END IF;

    IF p_cuenta_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id
      ) THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT cuenta_id INTO v_cuenta_id
      FROM medio_cuenta_default
      WHERE club_id = v_club_id AND medio_pago = p_medio_pago;
    END IF;

    INSERT INTO reserva_pagos (
      club_id, reserva_id, monto, medio_pago, tipo, usuario_id,
      cuenta_id
    ) VALUES (
      v_club_id, v_reserva.id, p_monto_pagado, p_medio_pago, v_tipo_pago, v_usuario_id,
      v_cuenta_id
    );
  END IF;

  RETURN v_reserva;
END;
$$;


-- 2. Redefinición de fn_reservar_desde_app
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

  -- Resolver o crear vinculación jugador_app <-> jugadores (por club)
  SELECT id INTO v_jugador_id FROM jugadores
  WHERE club_id = v_club_id AND email = v_jugador_app.email AND activo = TRUE LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono, es_socio, origen)
    VALUES (v_club_id, v_jugador_app.nombre, v_jugador_app.email, v_jugador_app.telefono, FALSE, 'app')
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
    'monto_total', v_monto_total,
    'monto_sena', v_monto_sena,
    'cbu_alias', v_cbu_alias,
    'nombre_banco', v_nombre_banco,
    'club_instagram', v_club_instagram
  );
END;
$$;


-- 3. Redefinición de fn_materializar_turnos_fijos
CREATE OR REPLACE FUNCTION public.fn_materializar_turnos_fijos(
  p_fecha_desde DATE,
  p_fecha_hasta DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_tf RECORD;
  v_fecha DATE;
  v_fecha_min DATE;
  v_fecha_max DATE;
  v_hora_fin TIME;
  v_tarifa_resuelta RECORD;
  v_tarifa_id BIGINT;
  v_monto DECIMAL(12,2);
  
  -- Contadores para el JSON de retorno
  v_creadas INT := 0;
  v_ya_hechas INT := 0;
  v_choques_clase INT := 0;
  v_sin_tarifa INT := 0;
  v_solapadas INT := 0;
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  
  IF current_user_rol() <> 'admin' AND current_user_rol() <> 'vendedor' THEN
    RAISE EXCEPTION 'No tenés permisos para materializar turnos fijos.';
  END IF;

  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'Fechas desde/hasta obligatorias.';
  END IF;
  IF p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'La fecha desde no puede ser posterior a la fecha hasta.';
  END IF;
  IF (p_fecha_hasta - p_fecha_desde) > 366 THEN
    RAISE EXCEPTION 'El rango no puede ser mayor a 12 meses.';
  END IF;

  FOR v_tf IN
    SELECT *
    FROM turnos_fijos
    WHERE club_id = v_club_id
      AND activo = TRUE
      AND fecha_desde <= p_fecha_hasta
      AND (fecha_hasta IS NULL OR fecha_hasta >= p_fecha_desde)
  LOOP
    v_fecha_min := GREATEST(p_fecha_desde, v_tf.fecha_desde);
    v_fecha_max := LEAST(
      p_fecha_hasta,
      COALESCE(v_tf.fecha_hasta, p_fecha_hasta)
    );

    v_hora_fin := fn_calcular_hora_fin(v_tf.hora_inicio, v_tf.duracion_min);

    v_fecha := v_fecha_min;
    WHILE v_fecha <= v_fecha_max LOOP
      IF EXTRACT(ISODOW FROM v_fecha)::INT = v_tf.dia_semana THEN

        IF EXISTS (
          SELECT 1 FROM reservas
          WHERE turno_fijo_id = v_tf.id AND fecha = v_fecha
        ) THEN
          v_ya_hechas := v_ya_hechas + 1;
          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM clases c
          WHERE c.club_id = v_club_id
            AND c.cancha_id = v_tf.cancha_id
            AND c.activa = TRUE
            AND v_tf.dia_semana = ANY(c.dias_semana)
            AND tsrange(
              (v_fecha + c.hora_inicio)::timestamp,
              (v_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
            ) && tsrange(
              (v_fecha + v_tf.hora_inicio)::timestamp,
              (v_fecha + v_hora_fin)::timestamp
            )
        ) THEN
          v_choques_clase := v_choques_clase + 1;
          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        SELECT tarifa_id, monto INTO v_tarifa_resuelta
        FROM fn_resolver_tarifa(v_fecha, v_tf.hora_inicio, v_tf.duracion_min);

        IF v_tarifa_resuelta.tarifa_id IS NULL THEN
          v_sin_tarifa := v_sin_tarifa + 1;
          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        v_tarifa_id := v_tarifa_resuelta.tarifa_id;
        v_monto := v_tarifa_resuelta.monto;

        BEGIN
          INSERT INTO reservas (
            club_id, cancha_id, jugador_id, fecha,
            hora_inicio, hora_fin, duracion_min,
            tarifa_id, monto_total,
            monto_sena, monto_pagado,
            estado, usuario_alta_id,
            turno_fijo_id
          ) VALUES (
            v_club_id, v_tf.cancha_id, v_tf.jugador_id, v_fecha,
            v_tf.hora_inicio, v_hora_fin, v_tf.duracion_min,
            v_tarifa_id, v_monto,
            0, 0,
            'pendiente', auth.uid(),
            v_tf.id
          );
          
          v_creadas := v_creadas + 1;
        EXCEPTION
          WHEN unique_violation OR exclusion_violation THEN
            v_solapadas := v_solapadas + 1;
        END;

      END IF;
      v_fecha := v_fecha + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'creadas', v_creadas,
    'ya_existentes', v_ya_hechas,
    'choques_clase', v_choques_clase,
    'sin_tarifa', v_sin_tarifa,
    'solapadas', v_solapadas
  );
END;
$$;


-- 4. Redefinición de fn_aceptar_desafio
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

  -- Resolver/crear jugadores locales
  SELECT id INTO v_jugador_id_de FROM jugadores
  WHERE club_id = v_club_id AND email = v_jugador_app_origen.email AND activo = TRUE LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono, es_socio, origen)
    VALUES (v_club_id, v_jugador_app_origen.nombre, v_jugador_app_origen.email, v_jugador_app_origen.telefono, FALSE, 'app')
    RETURNING id INTO v_jugador_id_de;
  END IF;

  SELECT id INTO v_jugador_id_para FROM jugadores
  WHERE club_id = v_club_id AND email = v_jugador_app_destino.email AND activo = TRUE LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO jugadores(club_id, nombre, email, telefono, es_socio, origen)
    VALUES (v_club_id, v_jugador_app_destino.nombre, v_jugador_app_destino.email, v_jugador_app_destino.telefono, FALSE, 'app')
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
    'monto_total', v_monto_total,
    'monto_sena', v_monto_sena,
    'cbu_alias', v_cbu_alias,
    'nombre_banco', v_nombre_banco,
    'club_instagram', v_club_instagram
  );
END;
$$;




CREATE OR REPLACE FUNCTION public.fn_crear_turno_fijo(
  p_cancha_id BIGINT,
  p_jugador_id BIGINT,
  p_nombre_libre VARCHAR,
  p_dia_semana INTEGER,
  p_hora_inicio TIME,
  p_duracion_min INTEGER,
  p_fecha_desde DATE,
  p_fecha_hasta DATE DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS turnos_fijos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_turno turnos_fijos;
  v_hora_fin TIME;
  v_fecha_chequeo_tarifa DATE;
  v_dia_nombre TEXT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear turnos fijos.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM canchas WHERE id = p_cancha_id AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION 'La cancha no existe o no pertenece a tu club.';
  END IF;

  IF p_jugador_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM jugadores WHERE id = p_jugador_id AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'El jugador no existe o no pertenece a tu club.';
    END IF;
  END IF;

  IF p_jugador_id IS NULL
     AND (p_nombre_libre IS NULL OR LENGTH(TRIM(p_nombre_libre)) = 0) THEN
    RAISE EXCEPTION 'Tenés que indicar un jugador registrado o un nombre.';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  IF EXISTS (
    SELECT 1
    FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND p_dia_semana = ANY(c.dias_semana)
      AND tsrange(
        ('1970-01-01'::date + c.hora_inicio)::timestamp,
        ('1970-01-01'::date + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con una clase activa en esa cancha.';
  END IF;

  v_fecha_chequeo_tarifa := GREATEST(p_fecha_desde, CURRENT_DATE);

  IF NOT EXISTS (
    SELECT 1 FROM tarifas t
    WHERE t.club_id = v_club_id
      AND t.activa = TRUE
      AND t.vigente_desde <= v_fecha_chequeo_tarifa
      AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= v_fecha_chequeo_tarifa)
      AND (t.dias_semana IS NULL OR p_dia_semana = ANY(t.dias_semana))
      AND (
        (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
        OR (p_hora_inicio >= t.desde_hora AND p_hora_inicio < t.hasta_hora)
      )
  ) THEN
    v_dia_nombre := CASE p_dia_semana
      WHEN 1 THEN 'lunes'
      WHEN 2 THEN 'martes'
      WHEN 3 THEN 'miércoles'
      WHEN 4 THEN 'jueves'
      WHEN 5 THEN 'viernes'
      WHEN 6 THEN 'sábados'
      WHEN 7 THEN 'domingos'
    END;
    RAISE EXCEPTION
      'No hay ninguna tarifa configurada para los % a las %. Configurá la tarifa en Configuración → Tarifas antes de crear el turno fijo.',
      v_dia_nombre, to_char(p_hora_inicio, 'HH24:MI');
  END IF;

  BEGIN
    INSERT INTO turnos_fijos (
      club_id, cancha_id, jugador_id, nombre_libre,
      dia_semana, hora_inicio, duracion_min,
      fecha_desde, fecha_hasta,
      observaciones, usuario_alta_id
    ) VALUES (
      v_club_id, p_cancha_id, p_jugador_id,
      CASE WHEN p_nombre_libre IS NULL THEN NULL ELSE TRIM(p_nombre_libre) END,
      p_dia_semana, p_hora_inicio, p_duracion_min,
      p_fecha_desde, p_fecha_hasta,
      p_observaciones, v_usuario_id
    )
    RETURNING * INTO v_turno;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'Ya hay otro turno fijo activo en esa cancha los días % a las %. Desactivá el existente o elegí otro slot.',
        p_dia_semana, p_hora_inicio;
  END;

  RETURN v_turno;
END;
$$;


-- 6. Redefinición de fn_disponibilidad_publica
CREATE OR REPLACE FUNCTION public.fn_disponibilidad_publica(
  p_club_slug TEXT,
  p_fecha DATE
)
RETURNS TABLE(
  cancha_id BIGINT,
  cancha_nombre TEXT,
  hora_inicio TIME,
  hora_fin TIME,
  disponible BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club_data AS (
    SELECT id, hora_apertura, hora_cierre, duracion_turno_default
    FROM clubes
    WHERE slug = p_club_slug AND activo = TRUE
  ),
  canchas_activas AS (
    SELECT id, nombre, club_id
    FROM canchas
    WHERE club_id = (SELECT id FROM club_data) AND activa = TRUE
  ),
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
  slots AS (
    SELECT
      sb.cancha_id,
      sb.cancha_nombre,
      sb.hora_inicio,
      fn_calcular_hora_fin(sb.hora_inicio, dur) AS hora_fin
    FROM slot_base sb
    CROSS JOIN LATERAL unnest(sb.duraciones) AS dur
    JOIN club_data cl ON TRUE
    WHERE fn_calcular_hora_fin(sb.hora_inicio, dur) <= cl.hora_cierre
  ),
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
  ocupados_fijos AS (
    SELECT DISTINCT s.cancha_id, s.hora_inicio
    FROM slots s
    JOIN turnos_fijos tf ON tf.cancha_id = s.cancha_id
    JOIN club_data cl ON tf.club_id = cl.id
    WHERE tf.activo = TRUE
      AND tf.dia_semana = EXTRACT(ISODOW FROM p_fecha)::INT
      AND tf.fecha_desde <= p_fecha
      AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha)
      AND s.hora_inicio < fn_calcular_hora_fin(tf.hora_inicio, tf.duracion_min)
      AND s.hora_fin    > tf.hora_inicio
      AND NOT EXISTS (
        SELECT 1 FROM reservas r
        WHERE r.turno_fijo_id = tf.id
          AND r.fecha = p_fecha
          AND r.estado = 'cancelada'
      )
  ),
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
  ORDER BY s.cancha_nombre, s.hora_inicio, s.hora_fin;
$$;


-- 7. Redefinición de fn_disponibilidad_bulk
CREATE OR REPLACE FUNCTION public.fn_disponibilidad_bulk(
  p_club_slugs TEXT[],
  p_fecha DATE
)
RETURNS TABLE(
  club_slug TEXT,
  cancha_id BIGINT,
  cancha_nombre TEXT,
  hora_inicio TIME,
  hora_fin TIME,
  disponible BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clubes_publicos AS (
    SELECT id, slug, hora_apertura, hora_cierre, duracion_turno_default
    FROM clubes
    WHERE slug = ANY(p_club_slugs) AND activo = TRUE
  ),
  canchas_activas AS (
    SELECT id, nombre, club_id
    FROM canchas
    WHERE club_id IN (SELECT id FROM clubes_publicos) AND activa = TRUE
  ),
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
  slots AS (
    SELECT
      sb.club_slug,
      sb.cancha_id,
      sb.cancha_nombre,
      sb.hora_inicio,
      fn_calcular_hora_fin(sb.hora_inicio, dur) AS hora_fin
    FROM slot_base sb
    CROSS JOIN LATERAL unnest(sb.duraciones) AS dur
    JOIN clubes_publicos cl ON cl.slug = sb.club_slug
    WHERE fn_calcular_hora_fin(sb.hora_inicio, dur) <= cl.hora_cierre
  ),
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
  ORDER BY s.club_slug, s.cancha_nombre, s.hora_inicio, s.hora_fin;
$$;


-- 8. Redefinición de fn_disponibilidad_publica_franjas
CREATE OR REPLACE FUNCTION public.fn_disponibilidad_publica_franjas(
  p_club_slug TEXT,
  p_fecha DATE
)
RETURNS TABLE(
  cancha_id BIGINT,
  cancha_nombre TEXT,
  hora_inicio TIME,
  hora_fin TIME,
  disponible BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club_data AS (
    SELECT id, hora_apertura, hora_cierre, duracion_turno_default
    FROM clubes
    WHERE slug = p_club_slug AND activo = TRUE
  ),
  canchas_activas AS (
    SELECT id, nombre
    FROM canchas
    WHERE club_id = (SELECT id FROM club_data) AND activa = TRUE
  ),
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
  slots AS (
    SELECT
      sb.cancha_id,
      sb.cancha_nombre,
      sb.hora_inicio,
      fn_calcular_hora_fin(sb.hora_inicio, dur) AS hora_fin
    FROM slot_base sb
    CROSS JOIN LATERAL unnest(sb.duraciones) AS dur
    JOIN club_data cl ON TRUE
    WHERE fn_calcular_hora_fin(sb.hora_inicio, dur) <= cl.hora_cierre
  ),
  ocupados AS (
    SELECT r.cancha_id, r.hora_inicio
    FROM reservas r
    JOIN club_data cl ON r.club_id = cl.id
    WHERE r.fecha = p_fecha
      AND r.estado <> 'cancelada'
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
