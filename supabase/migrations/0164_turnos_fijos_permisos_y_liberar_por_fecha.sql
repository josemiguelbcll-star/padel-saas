-- ============================================================================
-- Migración 0164: Turnos fijos — permisos granulares + liberar por fecha
-- ============================================================================
-- 1. Redefine los 4 RPC de turnos fijos para que el gate sea por permiso
--    granular (`has_user_permission('reservas','editar')`) y no por rol
--    hardcodeado de admin. Un vendedor con el permiso de edición de reservas
--    concedido por el admin ya puede crear/editar/cancelar/eliminar.
--    El admin sigue teniendo acceso total (has_user_permission devuelve TRUE).
--    La lógica interna de cada RPC NO cambia: solo la validación de acceso.
--
-- 2. Nuevas RPC para liberar / reactivar una instancia puntual de un turno
--    fijo por fecha, sin eliminar el turno fijo maestro:
--      - fn_liberar_turno_fijo_por_fecha(p_turno_fijo_id, p_fecha)
--      - fn_reactivar_turno_fijo_por_fecha(p_turno_fijo_id, p_fecha)
--    Reutilizan el mecanismo ya existente: una reserva con estado='cancelada'
--    funciona como excepción (fn_crear_reserva no bloquea el slot y
--    fn_materializar_turnos_fijos no la vuelve a crear).
--    Se exige que la reserva ya exista (que el turno esté materializado para
--    esa fecha).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. fn_crear_turno_fijo — gate por permiso (cuerpo idéntico a 0113)
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
-- 2. fn_actualizar_turno_fijo — gate por permiso (cuerpo idéntico a 0113)
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

-- ----------------------------------------------------------------------------
-- 3. fn_cancelar_turno_fijo — gate por permiso (cuerpo idéntico a 0030)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancelar_turno_fijo(
  p_turno_fijo_id BIGINT,
  p_cancelar_pendientes BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  reservas_canceladas INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_fijos;
  v_canceladas INT := 0;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF NOT has_user_permission('reservas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para cancelar turnos fijos. Necesitás permiso de edición de reservas.';
  END IF;

  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  IF NOT v_turno.activo THEN
    RAISE EXCEPTION 'El turno fijo ya está desactivado.';
  END IF;

  -- 1. Cancelar reservas pendientes futuras (si se pidió).
  IF p_cancelar_pendientes THEN
    UPDATE reservas
    SET estado = 'cancelada'
    WHERE turno_fijo_id = p_turno_fijo_id
      AND club_id = v_club_id
      AND fecha >= CURRENT_DATE
      AND estado = 'pendiente';
    GET DIAGNOSTICS v_canceladas = ROW_COUNT;
  END IF;

  -- 2. Desactivar turno fijo.
  UPDATE turnos_fijos
  SET activo = FALSE
  WHERE id = p_turno_fijo_id;

  RETURN QUERY SELECT v_canceladas;
END;
$$;

COMMENT ON FUNCTION public.fn_cancelar_turno_fijo IS
  'Desactiva un turno fijo (activo=FALSE). Si p_cancelar_pendientes=TRUE,
   también cancela las reservas pendientes futuras del turno (no toca
   pagadas/señadas/jugadas/canceladas). Retorna cantidad de reservas
   afectadas. Gate: permiso reservas.editar (admin siempre habilitado).';

GRANT EXECUTE ON FUNCTION public.fn_cancelar_turno_fijo(BIGINT, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. fn_eliminar_turno_fijo — gate por permiso (cuerpo idéntico a 0032)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_eliminar_turno_fijo(
  p_turno_fijo_id BIGINT
)
RETURNS TABLE (
  reservas_canceladas INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_fijos;
  v_canceladas INT := 0;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF NOT has_user_permission('reservas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar turnos fijos. Necesitás permiso de edición de reservas.';
  END IF;

  -- Lock + validar pertenencia al club. Si no existe (o no es de este
  -- club), RAISE con mensaje claro antes de tocar nada.
  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  -- 1. Cancelar reservas pendientes FUTURAS del turno.
  --    NO toca:
  --      - reservas pasadas (fecha < hoy): historia.
  --      - reservas pagadas/señadas/jugadas/canceladas: historia financiera
  --        o ya están fuera de juego.
  UPDATE reservas
  SET estado = 'cancelada'
  WHERE turno_fijo_id = p_turno_fijo_id
    AND club_id = v_club_id
    AND fecha >= CURRENT_DATE
    AND estado = 'pendiente';
  GET DIAGNOSTICS v_canceladas = ROW_COUNT;

  -- 2. DELETE del turno fijo.
  --    El ON DELETE SET NULL en reservas.turno_fijo_id (0030) deja las
  --    reservas históricas SIN LINK al turno fijo, pero NO las borra.
  --    Esto preserva snapshots de monto, cobros, jugadores asociados,
  --    medio de pago, turno_caja_id, etc.
  DELETE FROM turnos_fijos WHERE id = p_turno_fijo_id;

  RETURN QUERY SELECT v_canceladas;
END;
$$;

COMMENT ON FUNCTION public.fn_eliminar_turno_fijo IS
  'Elimina (DELETE) un turno fijo. Cancela primero las reservas
   pendientes FUTURAS asociadas (no toca pagadas/jugadas/históricas).
   El ON DELETE SET NULL en reservas.turno_fijo_id (0030) preserva las
   reservas históricas sin link. Atómica. Gate: permiso reservas.editar.';

GRANT EXECUTE ON FUNCTION public.fn_eliminar_turno_fijo(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. fn_liberar_turno_fijo_por_fecha
-- ----------------------------------------------------------------------------
-- Libera una instancia puntual de un turno fijo para una fecha concreta sin
-- eliminar el turno fijo maestro: marca la reserva de esa fecha como
-- 'cancelada'. El sistema ya interpreta ese estado como excepción
-- (fn_crear_reserva no bloquea el slot y fn_materializar_turnos_fijos no la
-- vuelve a crear), por lo que el horario queda libre para reservar.
--
-- Requiere que la reserva ya exista (que el turno esté materializado en esa
-- fecha). Permite liberar aunque el turno figure como cerrado (cerrado_en).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_liberar_turno_fijo_por_fecha(
  p_turno_fijo_id BIGINT,
  p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno RECORD;
  v_reserva RECORD;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para liberar turnos fijos. Necesitás permiso de edición de reservas.';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'Tenés que indicar una fecha.';
  END IF;

  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  -- La fecha debe corresponder al patrón del turno fijo.
  IF EXTRACT(ISODOW FROM p_fecha)::INT <> v_turno.dia_semana
     OR p_fecha < v_turno.fecha_desde
     OR (v_turno.fecha_hasta IS NOT NULL AND p_fecha > v_turno.fecha_hasta) THEN
    RAISE EXCEPTION 'El turno fijo no corresponde a la fecha seleccionada.';
  END IF;

  -- Debe existir la reserva materializada para esa fecha.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE turno_fijo_id = p_turno_fijo_id
    AND fecha = p_fecha
    AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Todavía no hay una reserva generada para esa fecha. Sincronizá los turnos fijos y volvé a intentar.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'El turno ya está liberado para esa fecha.';
  END IF;

  -- No permitir liberar si el turno ya tiene consumiciones cargadas.
  IF EXISTS (
    SELECT 1 FROM reserva_consumos WHERE reserva_id = v_reserva.id
  ) THEN
    RAISE EXCEPTION 'El turno tiene consumos cargados; no se puede liberar.';
  END IF;

  UPDATE reservas
  SET estado = 'cancelada'
  WHERE id = v_reserva.id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'turno_fijo_id', p_turno_fijo_id,
    'reserva_id', v_reserva.id,
    'fecha', p_fecha,
    'estado', 'cancelada'
  );
END;
$$;

COMMENT ON FUNCTION public.fn_liberar_turno_fijo_por_fecha(BIGINT, DATE) IS
  'Libera una instancia puntual de un turno fijo para una fecha específica
   (marca la reserva como cancelada) sin eliminar el turno fijo maestro. El
   horario queda disponible para reservar. Requiere que la reserva ya exista.
   Gate: permiso reservas.editar.';

GRANT EXECUTE ON FUNCTION public.fn_liberar_turno_fijo_por_fecha(BIGINT, DATE) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. fn_reactivar_turno_fijo_por_fecha
-- ----------------------------------------------------------------------------
-- Revierte una liberación previa para una fecha, siempre que el horario siga
-- libre (sin otra reserva activa). Vuelve la reserva a 'pendiente'.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reactivar_turno_fijo_por_fecha(
  p_turno_fijo_id BIGINT,
  p_fecha DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno RECORD;
  v_reserva RECORD;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para reactivar turnos fijos. Necesitás permiso de edición de reservas.';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'Tenés que indicar una fecha.';
  END IF;

  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE turno_fijo_id = p_turno_fijo_id
    AND fecha = p_fecha
    AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una reserva para reactivar en esa fecha.';
  END IF;

  IF v_reserva.estado <> 'cancelada' THEN
    RAISE EXCEPTION 'El turno no está liberado para esa fecha.';
  END IF;

  -- Verificar que el horario siga libre (que otra reserva no lo haya tomado).
  IF EXISTS (
    SELECT 1
    FROM reservas r
    WHERE r.club_id = v_club_id
      AND r.cancha_id = v_turno.cancha_id
      AND r.fecha = p_fecha
      AND r.id <> v_reserva.id
      AND r.estado <> 'cancelada'
      AND tsrange(
        (p_fecha + r.hora_inicio)::timestamp,
        (p_fecha + r.hora_inicio + (r.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + v_turno.hora_inicio)::timestamp,
        (p_fecha + v_turno.hora_inicio + (v_turno.duracion_min || ' minutes')::interval)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'No se puede reactivar el turno porque ese horario ya fue ocupado por otra reserva.';
  END IF;

  UPDATE reservas
  SET estado = 'pendiente'
  WHERE id = v_reserva.id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'turno_fijo_id', p_turno_fijo_id,
    'reserva_id', v_reserva.id,
    'fecha', p_fecha,
    'estado', 'pendiente'
  );
END;
$$;

COMMENT ON FUNCTION public.fn_reactivar_turno_fijo_por_fecha(BIGINT, DATE) IS
  'Restaura una instancia de turno fijo previamente liberada para una fecha,
   si el horario aún se encuentra disponible. Gate: permiso reservas.editar.';

GRANT EXECUTE ON FUNCTION public.fn_reactivar_turno_fijo_por_fecha(BIGINT, DATE) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS de turnos_fijos — permitir al vendedor con permiso reservas.editar
-- ----------------------------------------------------------------------------
-- Las policies originales (0030 / 0033) exigían rol admin, por lo que un
-- vendedor con el permiso concedido quedaba bloqueado por RLS aunque la RPC
-- lo dejara pasar. Se replican las policies conservando admin y sumando el
-- permiso granular.
DROP POLICY IF EXISTS "turnos_fijos_insert_admin" ON public.turnos_fijos;
CREATE POLICY "turnos_fijos_insert_admin_o_permiso"
ON public.turnos_fijos FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('reservas', 'editar'))
);

DROP POLICY IF EXISTS "turnos_fijos_update_admin" ON public.turnos_fijos;
CREATE POLICY "turnos_fijos_update_admin_o_permiso"
ON public.turnos_fijos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('reservas', 'editar'))
)
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('reservas', 'editar'))
);

DROP POLICY IF EXISTS "turnos_fijos_delete_admin" ON public.turnos_fijos;
CREATE POLICY "turnos_fijos_delete_admin_o_permiso"
ON public.turnos_fijos FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('reservas', 'editar'))
);

COMMIT;

-- ============================================================================
-- Fin de la migración 0164_turnos_fijos_permisos_y_liberar_por_fecha.sql
-- ============================================================================
