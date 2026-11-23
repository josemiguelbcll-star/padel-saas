-- ============================================================================
-- Migración 0170: Turnos fijos — liberar slots de turnos INACTIVOS al crear/editar
-- ============================================================================
-- Problema: al desactivar un turno fijo (fn_cancelar_turno_fijo) sin tildar
-- "cancelar pendientes", sus reservas futuras 'pendiente' quedan vivas. Al
-- crear un turno fijo nuevo en el mismo cancha/día/horario, el check de
-- solapamiento de fn_crear_turno_fijo las encuentra y rechaza con
-- "Ese horario se solapa con una reserva ya existente", aunque la grilla
-- del día se vea libre (las reservas están en fechas futuras).
--
-- Fix: antes de validar solapamiento, se cancelan las reservas 'pendiente'
-- futuras que pertenecen a turnos_fijos con activo=FALSE y que solapan el
-- nuevo patrón. Las 'senada'/'pagada'/'jugada' NO se tocan (historia
-- financiera): siguen bloqueando y se resuelven manualmente.
--
-- Se redefinen fn_crear_turno_fijo y fn_actualizar_turno_fijo (cuerpos
-- idénticos a 0164 + el paso de limpieza previo a la validación de
-- solapamiento con reservas).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. fn_crear_turno_fijo — con limpieza de reservas huérfanas de turnos inactivos
-- ----------------------------------------------------------------------------
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
  IF NOT has_user_permission('reservas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para crear turnos fijos. Necesitás permiso de edición de reservas.';
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

  -- 0. Limpiar reservas 'pendiente' futuras de turnos fijos INACTIVOS que
  --    solapan el nuevo patrón (huérfanas que bloquearían la creación).
  --    No toca senada/pagada/jugada (historia financiera).
  UPDATE reservas r
  SET estado = 'cancelada'
  FROM turnos_fijos tf
  WHERE r.turno_fijo_id = tf.id
    AND tf.club_id = v_club_id
    AND tf.activo = FALSE
    AND r.club_id = v_club_id
    AND r.cancha_id = p_cancha_id
    AND r.estado = 'pendiente'
    AND r.fecha >= p_fecha_desde
    AND (p_fecha_hasta IS NULL OR r.fecha <= p_fecha_hasta)
    AND EXTRACT(ISODOW FROM r.fecha)::INT = p_dia_semana
    AND tsrange(
      (r.fecha + r.hora_inicio)::timestamp,
      (r.fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
    ) && tsrange(
      (r.fecha + p_hora_inicio)::timestamp,
      (r.fecha + p_hora_inicio + (p_duracion_min || ' minutes')::interval)::timestamp
    );

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

GRANT EXECUTE ON FUNCTION public.fn_crear_turno_fijo(BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. fn_actualizar_turno_fijo — con limpieza de reservas huérfanas de turnos inactivos
-- ----------------------------------------------------------------------------
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
  IF NOT has_user_permission('reservas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para actualizar turnos fijos. Necesitás permiso de edición de reservas.';
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

    -- 1b. Limpiar reservas 'pendiente' futuras de turnos fijos INACTIVOS
    --     (distintos del que se edita) que solapan el nuevo patrón.
    UPDATE reservas r
    SET estado = 'cancelada'
    FROM turnos_fijos tf
    WHERE r.turno_fijo_id = tf.id
      AND tf.club_id = v_club_id
      AND tf.activo = FALSE
      AND tf.id <> p_turno_fijo_id
      AND r.club_id = v_club_id
      AND r.cancha_id = v_nuevo_cancha_id
      AND r.estado = 'pendiente'
      AND r.fecha >= v_nuevo_fecha_desde
      AND (v_nuevo_fecha_hasta IS NULL OR r.fecha <= v_nuevo_fecha_hasta)
      AND EXTRACT(ISODOW FROM r.fecha)::INT = v_nuevo_dia_semana
      AND tsrange(
        (r.fecha + r.hora_inicio)::timestamp,
        (r.fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (r.fecha + v_nuevo_hora_inicio)::timestamp,
        (r.fecha + v_nuevo_hora_inicio + (v_nuevo_duracion_min || ' minutes')::interval)::timestamp
      );

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

GRANT EXECUTE ON FUNCTION public.fn_actualizar_turno_fijo(BIGINT, BIGINT, BIGINT, VARCHAR, INTEGER, TIME, INTEGER, DATE, DATE, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

COMMIT;

-- ============================================================================
-- Fin de la migración 0170_turnos_fijos_liberar_slots_inactivos.sql
-- ============================================================================
