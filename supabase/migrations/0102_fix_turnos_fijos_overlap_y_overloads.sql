-- Migration 0102_fix_turnos_fijos_overlap_y_overloads.sql
-- 1. Elimina sobrecargas duplicadas de fn_crear_turno_fijo y fn_actualizar_turno_fijo (resuelve error PostgREST PGRST203)
-- 2. Garantiza validación estricta de solapamiento de horarios al crear/actualizar turnos fijos y crear reservas (alquiler de canchas)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DROPEAR SOBRECARGAS PREVIAS DE FUNCIONES
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_crear_turno_fijo(BIGINT, INTEGER, TIME, INTEGER, DATE, BIGINT, VARCHAR, DATE, TEXT);
DROP FUNCTION IF EXISTS public.fn_crear_turno_fijo(BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.fn_actualizar_turno_fijo(BIGINT, BIGINT, VARCHAR, DATE, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_actualizar_turno_fijo(BIGINT, BIGINT, VARCHAR, DATE, TEXT);
DROP FUNCTION IF EXISTS public.fn_actualizar_turno_fijo(BIGINT, BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_actualizar_turno_fijo(BIGINT, BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.fn_crear_reserva(BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT, DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: fn_crear_turno_fijo
-- ─────────────────────────────────────────────────────────────────────────────
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

  IF p_fecha_hasta IS NOT NULL AND p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'La fecha hasta no puede ser anterior a la fecha desde.';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  -- 1. Validar solapamiento con clases activas
  IF EXISTS (
    SELECT 1
    FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND p_dia_semana = ANY(c.dias_semana)
      AND tsrange(
        ('1970-01-01'::date + c.hora_inicio)::timestamp,
        ('1970-01-01'::date + fn_calcular_hora_fin(c.hora_inicio, c.duracion_min))::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con una clase activa en esa cancha.';
  END IF;

  -- 2. Validar solapamiento con otros turnos fijos activos
  IF EXISTS (
    SELECT 1
    FROM turnos_fijos tf
    WHERE tf.club_id = v_club_id
      AND tf.cancha_id = p_cancha_id
      AND tf.activo = TRUE
      AND tf.dia_semana = p_dia_semana
      AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha_desde)
      AND (p_fecha_hasta IS NULL OR tf.fecha_desde <= p_fecha_hasta)
      AND tsrange(
        ('1970-01-01'::date + tf.hora_inicio)::timestamp,
        ('1970-01-01'::date + fn_calcular_hora_fin(tf.hora_inicio, tf.duracion_min))::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con otro turno fijo activo en esa cancha.';
  END IF;

  -- 3. Validar solapamiento con reservas ya existentes en esa cancha para ese día de la semana y rango de fechas
  IF EXISTS (
    SELECT 1
    FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = p_cancha_id
      AND r.estado != 'cancelada'
      AND r.fecha >= p_fecha_desde
      AND (p_fecha_hasta IS NULL OR r.fecha <= p_fecha_hasta)
      AND EXTRACT(ISODOW FROM r.fecha)::INT = p_dia_semana
      AND tsrange(
        (r.fecha + r.hora_inicio)::timestamp,
        (r.fecha + r.hora_fin)::timestamp
      ) && tsrange(
        (r.fecha + p_hora_inicio)::timestamp,
        (r.fecha + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con una reserva ya existente en esa cancha. Verificá la grilla de reservas.';
  END IF;

  -- 4. Validar existencia de tarifa
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: fn_actualizar_turno_fijo
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_nuevo_fecha_hasta DATE;
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
  v_nuevo_fecha_hasta := CASE
    WHEN p_clear_fecha_hasta THEN NULL
    WHEN p_fecha_hasta IS NOT NULL THEN p_fecha_hasta
    ELSE v_turno.fecha_hasta
  END;

  IF v_nuevo_fecha_hasta IS NOT NULL AND v_nuevo_fecha_hasta < v_nuevo_fecha_desde THEN
    RAISE EXCEPTION 'La fecha hasta no puede ser anterior a la fecha desde.';
  END IF;

  -- Validar titular nuevo
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

  IF v_nuevo_jugador IS NULL
     AND (v_nuevo_nombre IS NULL OR LENGTH(TRIM(v_nuevo_nombre)) = 0) THEN
    RAISE EXCEPTION 'Tenés que indicar un jugador registrado o un nombre.';
  END IF;

  IF v_nuevo_jugador IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM jugadores WHERE id = v_nuevo_jugador AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'El jugador no existe o no pertenece a tu club.';
    END IF;
  END IF;

  -- Si cambió cancha, día, hora, duración o fechas, hacer validaciones correspondientes
  IF v_nuevo_cancha_id <> v_turno.cancha_id 
     OR v_nuevo_dia_semana <> v_turno.dia_semana 
     OR v_nuevo_hora_inicio <> v_turno.hora_inicio 
     OR v_nuevo_duracion_min <> v_turno.duracion_min 
     OR v_nuevo_fecha_desde <> v_turno.fecha_desde
     OR (v_nuevo_fecha_hasta IS DISTINCT FROM v_turno.fecha_hasta)
  THEN
    -- 1. Validar existencia de la cancha
    IF NOT EXISTS (
      SELECT 1 FROM canchas WHERE id = v_nuevo_cancha_id AND club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'La cancha no existe o no pertenece a tu club.';
    END IF;

    v_hora_fin := fn_calcular_hora_fin(v_nuevo_hora_inicio, v_nuevo_duracion_min);

    -- 2. Validar solapamiento con clases
    IF EXISTS (
      SELECT 1
      FROM clases c
      WHERE c.club_id = v_club_id
        AND c.cancha_id = v_nuevo_cancha_id
        AND c.activa = TRUE
        AND v_nuevo_dia_semana = ANY(c.dias_semana)
        AND tsrange(
          ('1970-01-01'::date + c.hora_inicio)::timestamp,
          ('1970-01-01'::date + fn_calcular_hora_fin(c.hora_inicio, c.duracion_min))::timestamp
        ) && tsrange(
          ('1970-01-01'::date + v_nuevo_hora_inicio)::timestamp,
          ('1970-01-01'::date + v_hora_fin)::timestamp
        )
    ) THEN
      RAISE EXCEPTION 'Ese horario se solapa con una clase activa en esa cancha.';
    END IF;

    -- 3. Validar solapamiento con otros turnos fijos activos
    IF EXISTS (
      SELECT 1
      FROM turnos_fijos tf
      WHERE tf.club_id = v_club_id
        AND tf.cancha_id = v_nuevo_cancha_id
        AND tf.activo = TRUE
        AND tf.dia_semana = v_nuevo_dia_semana
        AND tf.id <> p_turno_fijo_id
        AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= v_nuevo_fecha_desde)
        AND (v_nuevo_fecha_hasta IS NULL OR tf.fecha_desde <= v_nuevo_fecha_hasta)
        AND tsrange(
          ('1970-01-01'::date + tf.hora_inicio)::timestamp,
          ('1970-01-01'::date + fn_calcular_hora_fin(tf.hora_inicio, tf.duracion_min))::timestamp
        ) && tsrange(
          ('1970-01-01'::date + v_nuevo_hora_inicio)::timestamp,
          ('1970-01-01'::date + v_hora_fin)::timestamp
        )
    ) THEN
      RAISE EXCEPTION 'Ese horario se solapa con otro turno fijo activo en esa cancha.';
    END IF;

    -- 4. Validar solapamiento con reservas ya existentes en esa cancha (que no pertenezcan a este turno fijo)
    IF EXISTS (
      SELECT 1
      FROM reservas r
      WHERE r.club_id = v_club_id
        AND r.cancha_id = v_nuevo_cancha_id
        AND r.estado != 'cancelada'
        AND (r.turno_fijo_id IS NULL OR r.turno_fijo_id <> p_turno_fijo_id)
        AND r.fecha >= v_nuevo_fecha_desde
        AND (v_nuevo_fecha_hasta IS NULL OR r.fecha <= v_nuevo_fecha_hasta)
        AND EXTRACT(ISODOW FROM r.fecha)::INT = v_nuevo_dia_semana
        AND tsrange(
          (r.fecha + r.hora_inicio)::timestamp,
          (r.fecha + r.hora_fin)::timestamp
        ) && tsrange(
          (r.fecha + v_nuevo_hora_inicio)::timestamp,
          (r.fecha + v_hora_fin)::timestamp
        )
    ) THEN
      RAISE EXCEPTION 'Ese horario se solapa con una reserva ya existente en esa cancha. Verificá la grilla de reservas.';
    END IF;

    -- 5. Validar existencia de tarifa
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
      fecha_hasta = v_nuevo_fecha_hasta,
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: fn_crear_reserva (Alquiler de cancha)
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- 1. Chequeo de clase activa en esa cancha
  IF EXISTS (
    SELECT 1
    FROM clases c
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
    RAISE EXCEPTION 'Ese horario se solapa con una clase configurada en esa cancha.';
  END IF;

  -- 2. Bloqueo de slots de turnos fijos activos vigentes
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
      ('1970-01-01'::date + fn_calcular_hora_fin(tf.hora_inicio, tf.duracion_min))::timestamp
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

  -- 3. Chequeo de superposición con otra reserva activa existente en la misma cancha
  IF EXISTS (
    SELECT 1
    FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = p_cancha_id
      AND r.fecha = p_fecha
      AND r.estado != 'cancelada'
      AND tsrange(
        (p_fecha + r.hora_inicio)::timestamp,
        (p_fecha + r.hora_fin)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario ya está ocupado por otra reserva en esa cancha.';
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: fn_reservar_desde_app (Reservas móvil)
-- ─────────────────────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PERMISOS DE EJECUCIÓN (GRANT)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fn_crear_turno_fijo(BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_actualizar_turno_fijo(BIGINT, BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crear_reserva(BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT, DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER) TO authenticated;
