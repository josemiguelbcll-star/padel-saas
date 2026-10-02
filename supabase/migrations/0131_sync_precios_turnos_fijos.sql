-- ============================================================================
-- Migration 0131_sync_precios_turnos_fijos.sql
-- 
-- Permite que al cambiar las tarifas/franjas del club, todas las reservas pendientes
-- sin cobros asociadas a turnos fijos se sincronicen automáticamente con el nuevo
-- precio de la franja correspondiente, sin tener que cambiarlas una por una.
-- ============================================================================

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
          -- Resolver tarifa actual para este día y horario
          SELECT tarifa_id, monto INTO v_tarifa_resuelta
          FROM fn_resolver_tarifa(v_fecha, v_tf.hora_inicio, v_tf.duracion_min);

          -- Si existe y está pendiente, verificar si sus parámetros o tarifa/precio difieren del turno fijo actual
          IF v_reserva_existente.estado = 'pendiente' AND (
            v_reserva_existente.cancha_id <> v_tf.cancha_id
            OR v_reserva_existente.hora_inicio <> v_tf.hora_inicio
            OR v_reserva_existente.duracion_min <> v_tf.duracion_min
            OR (v_reserva_existente.jugador_id IS DISTINCT FROM v_tf.jugador_id)
            OR (v_reserva_existente.monto_pagado = 0 AND v_tarifa_resuelta.monto IS NOT NULL AND v_reserva_existente.monto_total <> v_tarifa_resuelta.monto)
            OR (v_reserva_existente.monto_pagado = 0 AND v_tarifa_resuelta.tarifa_id IS NOT NULL AND v_reserva_existente.tarifa_id IS DISTINCT FROM v_tarifa_resuelta.tarifa_id)
          ) THEN
            UPDATE reservas
            SET cancha_id = v_tf.cancha_id,
                jugador_id = v_tf.jugador_id,
                hora_inicio = v_tf.hora_inicio,
                hora_fin = v_hora_fin,
                duracion_min = v_tf.duracion_min,
                tarifa_id = COALESCE(v_tarifa_resuelta.tarifa_id, v_reserva_existente.tarifa_id),
                monto_total = CASE 
                  WHEN v_reserva_existente.monto_pagado = 0 AND v_tarifa_resuelta.monto IS NOT NULL THEN v_tarifa_resuelta.monto
                  ELSE v_reserva_existente.monto_total
                END
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
          WHEN exclusion_violation THEN
            v_solapadas := v_solapadas + 1;
        END;

      END IF;

      v_fecha := v_fecha + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'creadas', v_creadas,
    'actualizadas', v_actualizadas,
    'ya_hechas', v_ya_hechas,
    'choques_clase', v_choques_clase,
    'sin_tarifa', v_sin_tarifa,
    'solapadas', v_solapadas
  );
END;
$$;

COMMENT ON FUNCTION public.fn_materializar_turnos_fijos(DATE, DATE) IS
  'Genera reservas para turnos fijos y sincroniza automáticamente tarifas, montos y datos en reservas pendientes sin cobros.';

GRANT EXECUTE ON FUNCTION public.fn_materializar_turnos_fijos(DATE, DATE) TO authenticated;

-- ─── Sincronizar automáticamente reservas pendientes al cambiar precio de tarifa ───
CREATE OR REPLACE FUNCTION fn_cambiar_precio_tarifa(
  p_lineage_id BIGINT,
  p_monto_nuevo DECIMAL,
  p_vigente_desde DATE
)
RETURNS tarifas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_actual tarifas;
  v_nueva tarifas;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar precios.';
  END IF;

  IF p_monto_nuevo IS NULL OR p_monto_nuevo <= 0 THEN
    RAISE EXCEPTION 'El monto nuevo debe ser mayor a 0.';
  END IF;
  IF p_vigente_desde IS NULL THEN
    RAISE EXCEPTION 'La fecha desde la que rige el precio nuevo es obligatoria.';
  END IF;
  IF p_vigente_desde < CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha debe ser hoy o futura (no se permite reescribir historia).';
  END IF;

  -- Versión "abierta" del linaje que cubre la fecha del cambio.
  SELECT * INTO v_actual
  FROM tarifas
  WHERE club_id = v_club_id
    AND lineage_id = p_lineage_id
    AND vigente_desde <= p_vigente_desde
    AND (vigente_hasta IS NULL OR vigente_hasta >= p_vigente_desde)
  ORDER BY vigente_desde DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No hay versión del linaje % vigente en la fecha %. Verificá el linaje y la fecha.',
      p_lineage_id, p_vigente_desde;
  END IF;

  IF v_actual.monto = p_monto_nuevo THEN
    RAISE EXCEPTION 'El precio nuevo es igual al actual ($%). No tiene sentido versionar.', v_actual.monto;
  END IF;

  IF v_actual.vigente_desde = p_vigente_desde THEN
    RAISE EXCEPTION
      'Ya hay una versión vigente desde el % con monto $%. Para corregirla, cancelá el aumento programado (deuda v2 — hoy se hace por SQL).',
      v_actual.vigente_desde, v_actual.monto;
  END IF;

  -- Cerrar la versión actual.
  UPDATE tarifas
  SET vigente_hasta = p_vigente_desde - 1
  WHERE id = v_actual.id;

  -- Crear la nueva versión: mismo lineage + mismo metadata + monto nuevo.
  INSERT INTO tarifas (
    club_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa,
    vigente_desde, vigente_hasta, lineage_id,
    duracion_min
  ) VALUES (
    v_club_id, v_actual.nombre, p_monto_nuevo, v_actual.desde_hora, v_actual.hasta_hora,
    v_actual.dias_semana, v_actual.prioridad, v_actual.activa,
    p_vigente_desde, NULL, p_lineage_id,
    v_actual.duracion_min
  )
  RETURNING * INTO v_nueva;

  -- ⭐ Actualizar automáticamente reservas pendientes futuras que tenían asignada
  -- la versión anterior y no tienen pagos registrados (para que no haya que cambiarlas una por una).
  UPDATE reservas
  SET tarifa_id = v_nueva.id,
      monto_total = p_monto_nuevo
  WHERE club_id = v_club_id
    AND tarifa_id = v_actual.id
    AND estado = 'pendiente'
    AND monto_pagado = 0
    AND fecha >= p_vigente_desde;

  RETURN v_nueva;
END;
$$;

COMMENT ON FUNCTION fn_cambiar_precio_tarifa(BIGINT, DECIMAL, DATE) IS
  'Versiona el precio de un linaje y propaga el nuevo precio automáticamente a todas las reservas futuras pendientes sin cobros.';

GRANT EXECUTE ON FUNCTION fn_cambiar_precio_tarifa(BIGINT, DECIMAL, DATE) TO authenticated;

