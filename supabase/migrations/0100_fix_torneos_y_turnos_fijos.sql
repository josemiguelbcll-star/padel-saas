-- Migration 0100_fix_torneos_y_turnos_fijos.sql

-- 1. Redefinir fn_crear_turno_fijo para evitar solapamientos con otros turnos fijos
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

  -- Validar solapamiento con clases
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

  -- Validar solapamiento con otros turnos fijos activos
  IF EXISTS (
    SELECT 1
    FROM turnos_fijos tf
    WHERE tf.club_id = v_club_id
      AND tf.cancha_id = p_cancha_id
      AND tf.activo = TRUE
      AND tf.dia_semana = p_dia_semana
      AND tsrange(
        ('1970-01-01'::date + tf.hora_inicio)::timestamp,
        ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con otro turno fijo activo en esa cancha.';
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

  RETURN v_turno;
END;
$$;


-- 2. Redefinir fn_actualizar_turno_fijo para soportar modificación completa y validaciones
CREATE OR REPLACE FUNCTION public.fn_actualizar_turno_fijo(
  p_turno_fijo_id BIGINT,
  p_cancha_id BIGINT DEFAULT NULL,
  p_jugador_id BIGINT DEFAULT NULL,
  p_nombre_libre VARCHAR DEFAULT NULL,
  p_dia_semana INTEGER DEFAULT NULL,
  p_hora_inicio TIME DEFAULT NULL,
  p_duracion_min INTEGER DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  -- Flags para diferenciar "no cambiar" vs "limpiar a NULL".
  p_clear_jugador BOOLEAN DEFAULT FALSE,
  p_clear_nombre_libre BOOLEAN DEFAULT FALSE,
  p_clear_fecha_hasta BOOLEAN DEFAULT FALSE,
  p_clear_observaciones BOOLEAN DEFAULT FALSE
)
RETURNS turnos_fijos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_fijos;
  v_nuevo_cancha_id BIGINT;
  v_nuevo_jugador BIGINT;
  v_nuevo_nombre VARCHAR;
  v_nuevo_dia_semana INTEGER;
  v_nuevo_hora_inicio TIME;
  v_nuevo_duracion_min INTEGER;
  v_nuevo_fecha_desde DATE;
  v_hora_fin TIME;
  v_dia_nombre TEXT;
  v_fecha_chequeo_tarifa DATE;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede actualizar turnos fijos.';
  END IF;

  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  -- Resolver nuevos valores schedule
  v_nuevo_cancha_id := COALESCE(p_cancha_id, v_turno.cancha_id);
  v_nuevo_dia_semana := COALESCE(p_dia_semana, v_turno.dia_semana);
  v_nuevo_hora_inicio := COALESCE(p_hora_inicio, v_turno.hora_inicio);
  v_nuevo_duracion_min := COALESCE(p_duracion_min, v_turno.duracion_min);
  v_nuevo_fecha_desde := COALESCE(p_fecha_desde, v_turno.fecha_desde);

  -- Validar titular nuevo (después de aplicar clears).
  v_nuevo_jugador := CASE
    WHEN p_clear_jugador THEN NULL
    WHEN p_jugador_id IS NOT NULL THEN p_jugador_id
    ELSE v_turno.jugador_id
  END;
  v_nuevo_nombre := CASE
    WHEN p_clear_nombre_libre THEN NULL
    WHEN p_nombre_libre IS NOT NULL THEN TRIM(p_nombre_libre)
    ELSE v_turno.nombre_libre
  END;

  -- Validar titular obligatorio
  IF v_nuevo_jugador IS NULL
     AND (v_nuevo_nombre IS NULL OR LENGTH(TRIM(v_nuevo_nombre)) = 0) THEN
    RAISE EXCEPTION 'Tenés que indicar un jugador registrado o un nombre.';
  END IF;

  -- Si cambió cancha, día, hora o duración, hacer validaciones correspondientes
  IF v_nuevo_cancha_id <> v_turno.cancha_id 
     OR v_nuevo_dia_semana <> v_turno.dia_semana 
     OR v_nuevo_hora_inicio <> v_turno.hora_inicio 
     OR v_nuevo_duracion_min <> v_turno.duracion_min 
     OR v_nuevo_fecha_desde <> v_turno.fecha_desde
  THEN
    -- 1. Validar existencia de la cancha
    IF NOT EXISTS (
      SELECT 1 FROM canchas WHERE id = v_nuevo_cancha_id AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'La cancha no existe o no pertenece a tu club.';
    END IF;

    v_hora_fin := fn_calcular_hora_fin(v_nuevo_hora_inicio, v_nuevo_duracion_min);

    -- 2. Validar que no se solape con clases activas
    IF EXISTS (
      SELECT 1
      FROM clases c
      WHERE c.club_id = v_club_id
        AND c.cancha_id = v_nuevo_cancha_id
        AND c.activa = TRUE
        AND v_nuevo_dia_semana = ANY(c.dias_semana)
        AND tsrange(
          ('1970-01-01'::date + c.hora_inicio)::timestamp,
          ('1970-01-01'::date + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
        ) && tsrange(
          ('1970-01-01'::date + v_nuevo_hora_inicio)::timestamp,
          ('1970-01-01'::date + v_hora_fin)::timestamp
        )
    ) THEN
      RAISE EXCEPTION 'Ese horario se solapa con una clase activa en esa cancha.';
    END IF;

    -- 3. Validar que no se solape con otros turnos fijos activos
    IF EXISTS (
      SELECT 1
      FROM turnos_fijos tf
      WHERE tf.club_id = v_club_id
        AND tf.cancha_id = v_nuevo_cancha_id
        AND tf.activo = TRUE
        AND tf.dia_semana = v_nuevo_dia_semana
        AND tf.id <> p_turno_fijo_id
        AND tsrange(
          ('1970-01-01'::date + tf.hora_inicio)::timestamp,
          ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
        ) && tsrange(
          ('1970-01-01'::date + v_nuevo_hora_inicio)::timestamp,
          ('1970-01-01'::date + v_hora_fin)::timestamp
        )
    ) THEN
      RAISE EXCEPTION 'Ese horario se solapa con otro turno fijo activo en esa cancha.';
    END IF;

    -- 4. Validar existencia de tarifa
    v_fecha_chequeo_tarifa := GREATEST(v_nuevo_fecha_desde, CURRENT_DATE);
    IF NOT EXISTS (
      SELECT 1 FROM tarifas t
      WHERE t.club_id = v_club_id
        AND t.activa = TRUE
        AND t.vigente_desde <= v_fecha_chequeo_tarifa
        AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= v_fecha_chequeo_tarifa)
        AND (t.dias_semana IS NULL OR v_nuevo_dia_semana = ANY(t.dias_semana))
        AND (
          (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
          OR (v_nuevo_hora_inicio >= t.desde_hora AND v_nuevo_hora_inicio < t.hasta_hora)
        )
    ) THEN
      v_dia_nombre := CASE v_nuevo_dia_semana
        WHEN 1 THEN 'lunes'
        WHEN 2 THEN 'martes'
        WHEN 3 THEN 'miércoles'
        WHEN 4 THEN 'jueves'
        WHEN 5 THEN 'viernes'
        WHEN 6 THEN 'sábados'
        WHEN 7 THEN 'domingos'
      END;
      RAISE EXCEPTION
        'No hay ninguna tarifa configurada para los % a las %. Configurá la tarifa en Configuración → Tarifas antes de modificar el turno fijo.',
        v_dia_nombre, to_char(v_nuevo_hora_inicio, 'HH24:MI');
    END IF;
  END IF;

  -- Actualizar registro
  UPDATE turnos_fijos
  SET cancha_id = v_nuevo_cancha_id,
      jugador_id = v_nuevo_jugador,
      nombre_libre = v_nuevo_nombre,
      dia_semana = v_nuevo_dia_semana,
      hora_inicio = v_nuevo_hora_inicio,
      duracion_min = v_nuevo_duracion_min,
      fecha_desde = v_nuevo_fecha_desde,
      fecha_hasta = CASE
        WHEN p_clear_fecha_hasta THEN NULL
        WHEN p_fecha_hasta IS NOT NULL THEN p_fecha_hasta
        ELSE fecha_hasta
      END,
      observaciones = CASE
        WHEN p_clear_observaciones THEN NULL
        WHEN p_observaciones IS NOT NULL THEN p_observaciones
        ELSE observaciones
      END
  WHERE id = p_turno_fijo_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;


-- 3. Redefinir fn_aplicar_modo_torneo para bloquear turnos fijos (en lugar de cancelarlos)
CREATE OR REPLACE FUNCTION public.fn_aplicar_modo_torneo(
  p_fecha DATE,
  p_hora_inicio TIME,
  p_hora_fin TIME,
  p_cancha_ids BIGINT[],
  p_nombre_torneo TEXT
)
RETURNS TABLE(
  reserva_id BIGINT,
  jugador_nombre TEXT,
  telefono TEXT,
  tipo_turno TEXT,
  monto_reembolsado NUMERIC
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva RECORD;
  v_jugador_torneo_id BIGINT;
  v_curr_hora TIME;
  v_chunk INTEGER;
  v_remaining INTEGER;
  v_bloqueo_reserva_id BIGINT;
  v_tipo_turno TEXT;
  v_monto_reembolsado DECIMAL(12,2);
  v_rol VARCHAR;
  v_cancha_id BIGINT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  SELECT rol INTO v_rol FROM usuarios WHERE id = v_usuario_id;
  IF v_rol IS NULL OR v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para realizar esta acción.';
  END IF;

  -- 1. Procesar reservas solapadas
  FOR v_reserva IN (
    SELECT r.id, r.jugador_id, r.turno_fijo_id, r.monto_pagado, r.observaciones, j.nombre as jugador_nombre, j.telefono
    FROM reservas r
    LEFT JOIN jugadores j ON j.id = r.jugador_id
    WHERE r.club_id = v_club_id
      AND r.fecha = p_fecha
      AND r.cancha_id = ANY(p_cancha_ids)
      AND r.estado != 'cancelada'
      AND r.hora_inicio < p_hora_fin
      AND r.hora_fin > p_hora_inicio
    FOR UPDATE OF r
  ) LOOP
    v_monto_reembolsado := 0;

    IF v_reserva.turno_fijo_id IS NOT NULL THEN
      -- CASO FIJO: NO cancelamos. Solo etiquetamos como bloqueado por torneo.
      v_tipo_turno := 'fijo';
      
      UPDATE reservas
      SET observaciones = COALESCE(observaciones || E'\n', '') || '[Bloqueado por Torneo: ' || p_nombre_torneo || ']'
      WHERE id = v_reserva.id;

    ELSE
      -- CASO SUELTO: Sí cancelamos y reembolsamos.
      v_tipo_turno := 'suelto';
      IF v_reserva.monto_pagado > 0 AND v_reserva.jugador_id IS NOT NULL THEN
        v_monto_reembolsado := v_reserva.monto_pagado;

        INSERT INTO reserva_pagos (
          club_id,
          reserva_id,
          monto,
          medio_pago,
          tipo,
          jugador_id,
          observaciones,
          usuario_id
        ) VALUES (
          v_club_id,
          v_reserva.id,
          v_reserva.monto_pagado,
          'cuenta_corriente',
          'reembolso',
          v_reserva.jugador_id,
          'Reembolso en cuenta corriente por cancelación de torneo: ' || p_nombre_torneo,
          v_usuario_id
        );
      END IF;

      UPDATE reservas
      SET estado = 'cancelada',
          monto_pagado = 0,
          observaciones = COALESCE(observaciones || E'\n', '') || '[Cancelado por Torneo: ' || p_nombre_torneo || ']'
      WHERE id = v_reserva.id;
    END IF;

    reserva_id := v_reserva.id;
    jugador_nombre := COALESCE(v_reserva.jugador_nombre, 'Invitado');
    telefono := v_reserva.telefono;
    tipo_turno := v_tipo_turno;
    monto_reembolsado := v_monto_reembolsado;
    RETURN NEXT;
  END LOOP;

  -- 2. Asegurar existencia del jugador "Torneo"
  SELECT id INTO v_jugador_torneo_id
  FROM jugadores
  WHERE club_id = v_club_id
    AND nombre = 'Torneo: ' || p_nombre_torneo
    AND activo = FALSE
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO jugadores (club_id, nombre, activo)
    VALUES (v_club_id, 'Torneo: ' || p_nombre_torneo, FALSE)
    RETURNING id INTO v_jugador_torneo_id;
  END IF;

  -- 3. Generar bloques del torneo esquivando slots ocupados por turnos fijos (bloqueados)
  FOREACH v_cancha_id IN ARRAY p_cancha_ids LOOP
    v_curr_hora := p_hora_inicio;
    WHILE v_curr_hora < p_hora_fin LOOP
      v_remaining := EXTRACT(EPOCH FROM (p_hora_fin - v_curr_hora))::INTEGER / 60;
      
      IF v_remaining >= 240 THEN v_chunk := 240;
      ELSIF v_remaining >= 180 THEN v_chunk := 180;
      ELSIF v_remaining >= 150 THEN v_chunk := 150;
      ELSIF v_remaining >= 120 THEN v_chunk := 120;
      ELSIF v_remaining >= 90 THEN v_chunk := 90;
      ELSE v_chunk := 60;
      END IF;

      -- Verificar si hay un turno fijo (bloqueado) que solape con [v_curr_hora, v_curr_hora + v_chunk]
      SELECT id, hora_inicio, hora_fin INTO v_reserva
      FROM reservas
      WHERE club_id = v_club_id
        AND cancha_id = v_cancha_id
        AND fecha = p_fecha
        AND turno_fijo_id IS NOT NULL
        AND estado != 'cancelada'
        AND hora_inicio < (v_curr_hora + (v_chunk || ' minutes')::interval)::time
        AND hora_fin > v_curr_hora
      LIMIT 1;

      IF FOUND THEN
        -- Si hay fijo, acortar el bloque del torneo para terminar donde empieza la fija,
        -- o saltar la fija si el cursor ya está sobre ella.
        IF v_curr_hora < v_reserva.hora_inicio THEN
          v_chunk := EXTRACT(EPOCH FROM (v_reserva.hora_inicio - v_curr_hora))::INTEGER / 60;
          IF v_chunk > 0 THEN
            INSERT INTO reservas (
              club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin, duracion_min,
              monto_total, monto_sena, monto_pagado, estado, observaciones, usuario_alta_id
            ) VALUES (
              v_club_id, v_cancha_id, v_jugador_torneo_id, p_fecha, v_curr_hora,
              ((p_fecha::text || ' ' || v_curr_hora::text)::timestamp + (v_chunk || ' minutes')::interval)::time,
              v_chunk, 0, 0, 0, 'pagada', 'Bloqueo por Torneo: ' || p_nombre_torneo, v_usuario_id
            ) RETURNING id INTO v_bloqueo_reserva_id;

            INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
            VALUES (v_club_id, v_bloqueo_reserva_id, v_jugador_torneo_id, TRUE);
          END IF;
          v_curr_hora := v_reserva.hora_fin;
        ELSE
          v_curr_hora := v_reserva.hora_fin;
        END IF;
        
        CONTINUE;
      END IF;

      -- Insertar bloque torneo normal
      INSERT INTO reservas (
        club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin, duracion_min,
        monto_total, monto_sena, monto_pagado, estado, observaciones, usuario_alta_id
      ) VALUES (
        v_club_id, v_cancha_id, v_jugador_torneo_id, p_fecha, v_curr_hora,
        ((p_fecha::text || ' ' || v_curr_hora::text)::timestamp + (v_chunk || ' minutes')::interval)::time,
        v_chunk, 0, 0, 0, 'pagada', 'Bloqueo por Torneo: ' || p_nombre_torneo, v_usuario_id
      ) RETURNING id INTO v_bloqueo_reserva_id;

      INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
      VALUES (v_club_id, v_bloqueo_reserva_id, v_jugador_torneo_id, TRUE);

      v_curr_hora := ((p_fecha::text || ' ' || v_curr_hora::text)::timestamp + (v_chunk || ' minutes')::interval)::time;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;


-- 4. Redefinir fn_eliminar_bloqueo_torneo para quitar etiqueta de bloqueo y limpiar
CREATE OR REPLACE FUNCTION public.fn_eliminar_bloqueo_torneo(
  p_fecha DATE,
  p_nombre_torneo TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_jugador_id BIGINT;
  v_rol VARCHAR;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  SELECT rol INTO v_rol FROM usuarios WHERE id = v_usuario_id;
  IF v_rol IS NULL OR v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para realizar esta acción.';
  END IF;

  -- Buscar jugador oculto del torneo
  SELECT id INTO v_jugador_id
  FROM jugadores
  WHERE club_id = v_club_id
    AND nombre = 'Torneo: ' || p_nombre_torneo
    AND activo = FALSE
  LIMIT 1;

  IF FOUND THEN
    -- Cancelar bloqueos creados por el torneo
    UPDATE reservas
    SET estado = 'cancelada'
    WHERE club_id = v_club_id
      AND fecha = p_fecha
      AND jugador_id = v_jugador_id
      AND estado != 'cancelada';
  END IF;

  -- Quitar etiqueta [Bloqueado por Torneo: ...] de los turnos fijos de ese día
  UPDATE reservas
  SET observaciones = REPLACE(observaciones, E'\n[Bloqueado por Torneo: ' || p_nombre_torneo || ']', '')
  WHERE club_id = v_club_id
    AND fecha = p_fecha
    AND turno_fijo_id IS NOT NULL
    AND observaciones LIKE '%[Bloqueado por Torneo: ' || p_nombre_torneo || '%';

  UPDATE reservas
  SET observaciones = REPLACE(observaciones, '[Bloqueado por Torneo: ' || p_nombre_torneo || ']', '')
  WHERE club_id = v_club_id
    AND fecha = p_fecha
    AND turno_fijo_id IS NOT NULL
    AND observaciones LIKE '%[Bloqueado por Torneo: ' || p_nombre_torneo || '%';
END;
$$;


-- 5. Crear fn_desbloquear_turno_fijo para remover manualmente el bloqueo de torneo de un turno fijo
CREATE OR REPLACE FUNCTION public.fn_desbloquear_turno_fijo(p_reserva_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_rol VARCHAR;
  v_obs TEXT;
  v_nuevo_obs TEXT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  SELECT rol INTO v_rol FROM usuarios WHERE id = v_usuario_id;
  IF v_rol IS NULL OR v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para realizar esta acción.';
  END IF;

  -- Obtener observaciones de la reserva
  SELECT observaciones INTO v_obs
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.';
  END IF;

  -- Limpiar el tag [Bloqueado por Torneo: ...] de observaciones
  v_nuevo_obs := regexp_replace(v_obs, E'\\n?\\[Bloqueado por Torneo: [^\\]]+\\]', '', 'g');
  v_nuevo_obs := regexp_replace(v_nuevo_obs, E'\\[Bloqueado por Torneo: [^\\]]+\\]', '', 'g');
  v_nuevo_obs := trim(both E'\n' from trim(both ' ' from v_nuevo_obs));

  IF v_nuevo_obs = '' THEN
    v_nuevo_obs := NULL;
  END IF;

  UPDATE reservas
  SET observaciones = v_nuevo_obs
  WHERE id = p_reserva_id AND club_id = v_club_id;
END;
$$;

