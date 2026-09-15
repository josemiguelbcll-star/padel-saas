-- ============================================================================
-- Migration 0113_fix_midnight_tsrange_turnos_fijos_y_reservas.sql
-- Solución integral para turnos, reservas y clases que cruzan la medianoche:
--   0. Elimina check constraints obsoletos en reservas (reservas_check1 / hora_fin > hora_inicio)
--   1. Corrige el EXCLUDE constraint no_overlap_reservas en la tabla reservas con función inmutable
--   2. Corrige el trigger fn_check_clase_no_overlap_reservas
--   3. Redefine fn_materializar_turnos_fijos con tsrange seguro e intervalos
--   4. Redefine fn_crear_turno_fijo con tsrange seguro
--   5. Redefine fn_actualizar_turno_fijo con tsrange seguro
--   6. Redefine fn_crear_reserva con tsrange seguro
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. ELIMINAR CHECK CONSTRAINTS OBSOLETOS EN RESERVAS (reservas_check1 / hora_fin > hora_inicio)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname 
    FROM pg_constraint 
    WHERE conrelid = 'public.reservas'::regclass 
      AND contype = 'c' 
      AND (
        conname = 'reservas_check1'
        OR conname = 'reservas_check'
        OR pg_get_constraintdef(oid) ILIKE '%hora_fin > hora_inicio%'
        OR pg_get_constraintdef(oid) ILIKE '%monto_pagado <= monto_total%'
      )
  ) LOOP
    EXECUTE 'ALTER TABLE public.reservas DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FUNCIÓN INMUTABLE Y RE-CREACIÓN DE EXCLUDE CONSTRAINT no_overlap_reservas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_reserva_tsrange(
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INTEGER
)
RETURNS tsrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT tsrange(
    (p_fecha + p_hora_inicio)::timestamp,
    ((p_fecha + p_hora_inicio)::timestamp + (COALESCE(p_duracion_min, 90) * INTERVAL '1 minute'))
  );
$$;

ALTER TABLE public.reservas DROP CONSTRAINT IF EXISTS no_overlap_reservas;

ALTER TABLE public.reservas ADD CONSTRAINT no_overlap_reservas EXCLUDE
  USING gist (
    cancha_id WITH =,
    public.fn_reserva_tsrange(fecha, hora_inicio, duracion_min) WITH &&
  )
  WHERE (estado != 'cancelada');


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TRIGGER fn_check_clase_no_overlap_reservas CON tsrange SEGURO
-- ─────────────────────────────────────────────────────────────────────────────
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
    AND EXTRACT(ISODOW FROM r.fecha)::INT = ANY(NEW.dias_semana)
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REDEFINICIÓN DE fn_materializar_turnos_fijos
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_materializar_turnos_fijos(DATE, DATE);

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
  v_reserva_id BIGINT;
  v_reserva_existente RECORD;
  
  -- Contadores para el JSON de retorno
  v_creadas INT := 0;
  v_actualizadas INT := 0;
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

        -- Verificar si ya existe una reserva para este turno fijo en esta fecha
        SELECT * INTO v_reserva_existente
        FROM reservas
        WHERE turno_fijo_id = v_tf.id AND fecha = v_fecha;

        IF FOUND THEN
          -- Si existe y está pendiente, verificar si sus parámetros difieren del turno fijo actual
          IF v_reserva_existente.estado = 'pendiente' AND (
            v_reserva_existente.cancha_id <> v_tf.cancha_id
            OR v_reserva_existente.hora_inicio <> v_tf.hora_inicio
            OR v_reserva_existente.duracion_min <> v_tf.duracion_min
            OR (v_reserva_existente.jugador_id IS DISTINCT FROM v_tf.jugador_id)
          ) THEN
            SELECT tarifa_id, monto INTO v_tarifa_resuelta
            FROM fn_resolver_tarifa(v_fecha, v_tf.hora_inicio, v_tf.duracion_min);

            UPDATE reservas
            SET cancha_id = v_tf.cancha_id,
                jugador_id = v_tf.jugador_id,
                hora_inicio = v_tf.hora_inicio,
                hora_fin = v_hora_fin,
                duracion_min = v_tf.duracion_min,
                tarifa_id = COALESCE(v_tarifa_resuelta.tarifa_id, v_reserva_existente.tarifa_id),
                monto_total = COALESCE(v_tarifa_resuelta.monto, v_reserva_existente.monto_total)
            WHERE id = v_reserva_existente.id;

            -- Sincronizar titular
            DELETE FROM reserva_jugadores
            WHERE reserva_id = v_reserva_existente.id AND es_titular = TRUE;

            IF v_tf.jugador_id IS NOT NULL THEN
              INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
              VALUES (v_club_id, v_reserva_existente.id, v_tf.jugador_id, TRUE);
            END IF;

            v_actualizadas := v_actualizadas + 1;
          ELSE
            v_ya_hechas := v_ya_hechas + 1;
          END IF;

          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        -- Validar choque con clases (usando cálculo seguro con INTERVAL para medianoche)
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
              (v_fecha + v_tf.hora_inicio + (v_tf.duracion_min || ' minutes')::interval)::timestamp
            )
        ) THEN
          v_choques_clase := v_choques_clase + 1;
          v_fecha := v_fecha + 1;
          CONTINUE;
        END IF;

        -- Resolver tarifa (con soporte de proporcionalidad si no hay exacta)
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
          )
          RETURNING id INTO v_reserva_id;

          IF v_tf.jugador_id IS NOT NULL THEN
            INSERT INTO reserva_jugadores (
              club_id, reserva_id, jugador_id, es_titular
            ) VALUES (
              v_club_id, v_reserva_id, v_tf.jugador_id, TRUE
            );
          END IF;
          
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
    'reservas_creadas', v_creadas,
    'actualizadas', v_actualizadas,
    'ya_existentes', v_ya_hechas,
    'slots_ya_materializados', v_ya_hechas,
    'choques_clase', v_choques_clase,
    'slots_ocupados_por_clase', v_choques_clase,
    'sin_tarifa', v_sin_tarifa,
    'slots_sin_tarifa', v_sin_tarifa,
    'solapadas', v_solapadas,
    'slots_ocupados_por_reserva_suelta', v_solapadas
  );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REDEFINICIÓN DE fn_crear_turno_fijo
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_crear_turno_fijo(BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT);

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
  v_tarifa_resuelta RECORD;
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
        ('1970-01-01'::date + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
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
        ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        ('1970-01-01'::date + p_hora_inicio)::timestamp,
        ('1970-01-01'::date + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
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
        (r.fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (r.fecha + p_hora_inicio)::timestamp,
        (r.fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con una reserva ya existente en esa cancha. Verificá la grilla de reservas.';
  END IF;

  -- 4. Validar existencia de tarifa usando fn_resolver_tarifa
  v_fecha_chequeo_tarifa := GREATEST(p_fecha_desde, CURRENT_DATE);

  SELECT tarifa_id, monto INTO v_tarifa_resuelta
  FROM fn_resolver_tarifa(v_fecha_chequeo_tarifa, p_hora_inicio, p_duracion_min);

  IF v_tarifa_resuelta.tarifa_id IS NULL THEN
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

  -- Materializar automáticamente para las próximas 24 semanas
  PERFORM fn_materializar_turnos_fijos(
    CURRENT_DATE,
    (CURRENT_DATE + 168)::DATE
  );

  RETURN v_turno;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REDEFINICIÓN DE fn_actualizar_turno_fijo
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_actualizar_turno_fijo(BIGINT, BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);

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
  v_tarifa_resuelta RECORD;
  v_res RECORD;
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

  -- Resolver nuevos valores de horario/cancha/fechas
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
          ('1970-01-01'::date + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
        ) && tsrange(
          ('1970-01-01'::date + v_nuevo_hora_inicio)::timestamp,
          ('1970-01-01'::date + v_nuevo_hora_inicio + (v_nuevo_duracion_min || ' minutes')::interval)::timestamp
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
          ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
        ) && tsrange(
          ('1970-01-01'::date + v_nuevo_hora_inicio)::timestamp,
          ('1970-01-01'::date + v_nuevo_hora_inicio + (v_nuevo_duracion_min || ' minutes')::interval)::timestamp
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
          (r.fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
        ) && tsrange(
          (r.fecha + v_nuevo_hora_inicio)::timestamp,
          (r.fecha + v_nuevo_hora_inicio + (v_nuevo_duracion_min || ' minutes')::interval)::timestamp
        )
    ) THEN
      RAISE EXCEPTION 'Ese horario se solapa con una reserva ya existente en esa cancha. Verificá la grilla de reservas.';
    END IF;

    -- 5. Validar existencia de tarifa usando fn_resolver_tarifa
    v_fecha_chequeo_tarifa := GREATEST(v_nuevo_fecha_desde, CURRENT_DATE);
    SELECT tarifa_id, monto INTO v_tarifa_resuelta
    FROM fn_resolver_tarifa(v_fecha_chequeo_tarifa, v_nuevo_hora_inicio, v_nuevo_duracion_min);

    IF v_tarifa_resuelta.tarifa_id IS NULL THEN
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

  -- 6. Actualizar registro en turnos_fijos
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

  -- 7. SINCRONIZAR RESERVAS FUTURAS PENDIENTES ASOCIADAS
  -- A. Eliminar/cancelar reservas pendientes que hayan quedado fuera de fecha o de día de semana
  DELETE FROM reservas
  WHERE turno_fijo_id = p_turno_fijo_id
    AND estado = 'pendiente'
    AND fecha >= CURRENT_DATE
    AND (
      EXTRACT(ISODOW FROM fecha)::INT <> v_nuevo_dia_semana
      OR fecha < v_nuevo_fecha_desde
      OR (v_nuevo_fecha_hasta IS NOT NULL AND fecha > v_nuevo_fecha_hasta)
    );

  -- B. Actualizar las reservas pendientes futuras que siguen en el patrón
  v_hora_fin := fn_calcular_hora_fin(v_nuevo_hora_inicio, v_nuevo_duracion_min);

  FOR v_res IN
    SELECT id, fecha
    FROM reservas
    WHERE turno_fijo_id = p_turno_fijo_id
      AND estado = 'pendiente'
      AND fecha >= CURRENT_DATE
  LOOP
    SELECT tarifa_id, monto INTO v_tarifa_resuelta
    FROM fn_resolver_tarifa(v_res.fecha, v_nuevo_hora_inicio, v_nuevo_duracion_min);

    UPDATE reservas
    SET cancha_id = v_nuevo_cancha_id,
        jugador_id = v_nuevo_jugador,
        hora_inicio = v_nuevo_hora_inicio,
        hora_fin = v_hora_fin,
        duracion_min = v_nuevo_duracion_min,
        tarifa_id = COALESCE(v_tarifa_resuelta.tarifa_id, tarifa_id),
        monto_total = COALESCE(v_tarifa_resuelta.monto, monto_total)
    WHERE id = v_res.id;

    -- Actualizar titular en reserva_jugadores
    DELETE FROM reserva_jugadores
    WHERE reserva_id = v_res.id AND es_titular = TRUE;

    IF v_nuevo_jugador IS NOT NULL THEN
      INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
      VALUES (v_club_id, v_res.id, v_nuevo_jugador, TRUE);
    END IF;
  END LOOP;

  -- C. Materializar nuevas fechas faltantes
  PERFORM fn_materializar_turnos_fijos(
    CURRENT_DATE,
    (CURRENT_DATE + 168)::DATE
  );

  RETURN v_turno;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. REDEFINICIÓN DE fn_crear_reserva
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_crear_reserva(BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT, DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT);

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
        (p_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
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
      ('1970-01-01'::date + tf.hora_inicio + (tf.duracion_min || ' minutes')::interval)::timestamp
    ) && tsrange(
      ('1970-01-01'::date + p_hora_inicio)::timestamp,
      ('1970-01-01'::date + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
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
        (p_fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
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
-- 7. GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.fn_reserva_tsrange(DATE, TIME, INTEGER) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fn_materializar_turnos_fijos(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crear_turno_fijo(BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_actualizar_turno_fijo(BIGINT, BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_crear_reserva(BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT, DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT) TO authenticated;
