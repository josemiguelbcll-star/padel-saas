-- ============================================================================
-- Migración 0166: Sincronizar fn_crear_reserva (liberación de turno fijo)
-- ============================================================================
-- Problema
--   Al liberar una instancia puntual de un turno fijo por fecha (RPC
--   fn_liberar_turno_fijo_por_fecha, migración 0164) la reserva se marca como
--   'cancelada'. Sin embargo, al intentar crear una reserva suelta en ese slot
--   la base seguía lanzando:
--     'Ese horario está reservado para el turno fijo de %...'
--
--   La cláusula que "suelta" el slot cuando el turno fijo fue liberado para esa
--   fecha existe en fn_crear_reserva desde la migración 0129:
--     AND NOT EXISTS (
--       SELECT 1 FROM reservas r_cancel
--       WHERE r_cancel.club_id = v_club_id
--         AND r_cancel.turno_fijo_id = tf.id
--         AND r_cancel.fecha = p_fecha
--         AND r_cancel.estado = 'cancelada'
--     )
--   La versión desplegada en producción es anterior (pre-0129) y no la incluye,
--   por eso la liberación no desbloqueaba el horario.
--
-- Solución
--   Reaplicar fn_crear_reserva con la versión vigente del repositorio (0129).
--   Es idempotente (CREATE OR REPLACE) y NO modifica la lógica de la función:
--   solo sincroniza lo desplegado con el código fuente.
--
-- Nota
--   Esta versión también incluye el desglose de reserva_pagos
--   (monto_alquiler / monto_consumo / turno_caja_id), por lo que además evita el
--   error 23514 (reserva_pagos_desglose_check) que se venía parcheando con el
--   trigger defensivo de la 0165.
-- ============================================================================

BEGIN;

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
  v_titular_reserva_jugador_id BIGINT;
  v_turno_caja_id BIGINT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  v_hora_fin := fn_calcular_hora_fin(p_hora_inicio, p_duracion_min);

  -- 1. Chequeo de clase activa en esa cancha (ignorando clases liberadas para p_fecha)
  IF EXISTS (
    SELECT 1
    FROM clases c
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
    RAISE EXCEPTION 'Ese horario se solapa con una clase configurada en esa cancha.';
  END IF;

  -- 2. Bloqueo de slots de turnos fijos activos vigentes
  -- Se excluye si el turno fijo fue liberado / cancelado para esta fecha específica
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
    AND NOT EXISTS (
      SELECT 1 FROM reservas r_cancel
      WHERE r_cancel.club_id = v_club_id
        AND r_cancel.turno_fijo_id = tf.id
        AND r_cancel.fecha = p_fecha
        AND r_cancel.estado = 'cancelada'
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
    VALUES (v_club_id, v_reserva.id, p_jugador_titular_id, TRUE)
    RETURNING id INTO v_titular_reserva_jugador_id;
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
      VALUES (
        v_club_id,
        v_reserva.id,
        v_nombre,
        (p_jugador_titular_id IS NULL AND v_titular_reserva_jugador_id IS NULL)
      )
      RETURNING id INTO v_jid;

      IF p_jugador_titular_id IS NULL AND v_titular_reserva_jugador_id IS NULL THEN
        v_titular_reserva_jugador_id := v_jid;
      END IF;
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

    IF p_medio_pago = 'efectivo' THEN
      v_turno_caja_id := current_club_caja_abierta();
    END IF;

    INSERT INTO reserva_pagos (
      club_id,
      reserva_id,
      monto,
      medio_pago,
      tipo,
      usuario_id,
      cuenta_id,
      jugador_id,
      reserva_jugador_id,
      monto_alquiler,
      monto_consumo,
      turno_caja_id
    ) VALUES (
      v_club_id,
      v_reserva.id,
      p_monto_pagado,
      p_medio_pago,
      v_tipo_pago,
      v_usuario_id,
      v_cuenta_id,
      p_jugador_titular_id,
      v_titular_reserva_jugador_id,
      p_monto_pagado,
      0,
      v_turno_caja_id
    );
  END IF;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION public.fn_crear_reserva(
  BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT,
  DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT
) IS
  'Crea una reserva suelta. Bloquea slots de turnos fijos activos vigentes
   EXCEPTO cuando el turno fijo fue liberado (reserva cancelada) para esa fecha.
   Inserta el desglose de reserva_pagos (monto_alquiler/monto_consumo).';

GRANT EXECUTE ON FUNCTION public.fn_crear_reserva(
  BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT,
  DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT
) TO authenticated;

COMMIT;
