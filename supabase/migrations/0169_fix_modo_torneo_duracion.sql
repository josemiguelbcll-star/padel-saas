-- Migration 0169_fix_modo_torneo_duracion.sql
-- Fix: fn_aplicar_modo_torneo generaba bloques con duracion_min arbitraria
-- al esquivar turnos fijos (minutos hasta el inicio del fijo), violando el
-- CHECK reservas.duracion_min IN (60,90,120,150,180,240) -> error
-- "La duración del turno debe ser 60, 90, 120, 150, 180 o 240 minutos".
-- También forzaba bloques de 60 min cuando quedaban <60 min hasta el fin,
-- excediendo p_hora_fin.
-- Fix: tilear la ventana libre con duraciones válidas (240/180/150/120/90/60),
-- saltar turnos fijos, y dejar huecos <60 min sin cubrir (no pueden alojar
-- una reserva válida de todos modos).

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
  v_window INTEGER;
  v_limite TIME;
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

  -- 3. Generar bloques del torneo esquivando slots ocupados por turnos fijos (bloqueados).
  --    Cada bloque usa una duración válida del CHECK (240/180/150/120/90/60) y
  --    nunca excede p_hora_fin ni pisa un turno fijo.
  FOREACH v_cancha_id IN ARRAY p_cancha_ids LOOP
    v_curr_hora := p_hora_inicio;
    WHILE v_curr_hora < p_hora_fin LOOP
      -- Próximo turno fijo que pisa desde v_curr_hora (o lo contiene).
      SELECT r2.hora_inicio, r2.hora_fin INTO v_reserva
      FROM reservas r2
      WHERE r2.club_id = v_club_id
        AND r2.cancha_id = v_cancha_id
        AND r2.fecha = p_fecha
        AND r2.turno_fijo_id IS NOT NULL
        AND r2.estado != 'cancelada'
        AND r2.hora_inicio < p_hora_fin
        AND r2.hora_fin > v_curr_hora
      ORDER BY r2.hora_inicio
      LIMIT 1;

      IF FOUND AND v_reserva.hora_inicio <= v_curr_hora THEN
        -- El cursor está DENTRO del fijo: saltar al final del fijo.
        v_curr_hora := v_reserva.hora_fin;
        CONTINUE;
      END IF;

      -- Techo de la ventana libre: el inicio del próximo fijo o el fin del torneo.
      v_limite := COALESCE(v_reserva.hora_inicio, p_hora_fin);
      v_window := EXTRACT(EPOCH FROM (v_limite - v_curr_hora))::INTEGER / 60;

      -- Mayor duración válida que entre en la ventana.
      IF v_window >= 240 THEN v_chunk := 240;
      ELSIF v_window >= 180 THEN v_chunk := 180;
      ELSIF v_window >= 150 THEN v_chunk := 150;
      ELSIF v_window >= 120 THEN v_chunk := 120;
      ELSIF v_window >= 90 THEN v_chunk := 90;
      ELSIF v_window >= 60 THEN v_chunk := 60;
      ELSE v_chunk := NULL;
      END IF;

      IF v_chunk IS NULL THEN
        -- Hueco <60 min: no puede alojar una reserva válida. Saltar al
        -- final del fijo (si hay) o cerrar la cancha.
        v_curr_hora := COALESCE(v_reserva.hora_fin, p_hora_fin);
        CONTINUE;
      END IF;

      INSERT INTO reservas (
        club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin, duracion_min,
        monto_total, monto_sena, monto_pagado, estado, observaciones, usuario_alta_id
      ) VALUES (
        v_club_id, v_cancha_id, v_jugador_torneo_id, p_fecha, v_curr_hora,
        (v_curr_hora + (v_chunk || ' minutes')::interval)::time,
        v_chunk, 0, 0, 0, 'pagada', 'Bloqueo por Torneo: ' || p_nombre_torneo, v_usuario_id
      ) RETURNING id INTO v_bloqueo_reserva_id;

      INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
      VALUES (v_club_id, v_bloqueo_reserva_id, v_jugador_torneo_id, TRUE);

      v_curr_hora := v_curr_hora + (v_chunk || ' minutes')::interval;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;
