-- ============================================================================
-- 0031_bloqueo_slot_turno_fijo.sql
-- Bloquea reservas sueltas en slots de turnos fijos activos vigentes.
--
-- =====================================================================
-- POR QUÉ
-- =====================================================================
-- Hasta hoy, el slot de un turno fijo activo NO materializado aparece
-- libre en la grilla y se puede reservar suelto, pisando el lugar del
-- cliente fijo. El bloqueo agrega una validación server-side en
-- fn_crear_reserva: antes de insertar una reserva suelta, verifica que
-- el slot (cancha + fecha + hora) NO pertenezca a un turno fijo activo
-- vigente en esa fecha.
--
-- =====================================================================
-- POR QUÉ NO ROMPE LA MATERIALIZACIÓN
-- =====================================================================
-- fn_materializar_turnos_fijos (0030) hace INSERT DIRECTO a la tabla
-- reservas con turno_fijo_id SETEADO. NO llama a fn_crear_reserva.
-- Por lo tanto, la validación nueva afecta SOLO al path de reservas
-- sueltas (el frontend usa la RPC vía useCrearReserva).
--
-- Verificado: grep "INSERT INTO reservas" en migraciones devuelve solo
-- fn_crear_reserva (0005) y fn_materializar_turnos_fijos (0030). Frontend
-- no tiene .from('reservas').insert(...) directo.
--
-- =====================================================================
-- DEUDA ANOTADA
-- =====================================================================
-- Defensa en profundidad ideal: TRIGGER BEFORE INSERT en `reservas` que
-- distinga por NEW.turno_fijo_id IS NULL (suelta) vs NOT NULL
-- (materialización). Por ahora el frontend siempre usa la RPC, así que
-- el cambio quirúrgico cubre el 100% del caso real. v2.
-- ============================================================================

BEGIN;

-- ============================================================================
-- CREATE OR REPLACE fn_crear_reserva
--
-- Cambio respecto a la versión 0005:
--   - Sin cambios en signatura.
--   - Sin cambios en estructura de INSERTs (reservas + reserva_jugadores
--     + reserva_pagos), ni en el cálculo de v_monto_sena/v_tipo_pago.
--   - Sin cambios en chequeo de clases (sigue igual).
--   - AGREGADO: bloque nuevo de validación de turno fijo activo,
--     simétrico al chequeo de clases, ubicado justo después de éste y
--     antes del cálculo de v_monto_sena.
--   - AGREGADO en DECLARE: v_turno_fijo_titular_nombre VARCHAR.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_crear_reserva(
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
  p_observaciones TEXT
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
  -- NUEVO 0031: nombre del titular del turno fijo (si bloquea).
  v_turno_fijo_titular_nombre VARCHAR;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  v_hora_fin := p_hora_inicio + (p_duracion_min || ' minutes')::interval;

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

  -- ──────────────────────────────────────────────────────────────────
  -- NUEVO 0031: Bloqueo de slots de turnos fijos activos vigentes.
  --
  -- Aplica SOLO a reservas sueltas (este path = fn_crear_reserva).
  -- La materialización (fn_materializar_turnos_fijos) hace INSERT
  -- directo a la tabla, no pasa por acá → no se ve afectada.
  --
  -- Buscamos un turno fijo:
  --   - del mismo club y misma cancha,
  --   - activo,
  --   - con dia_semana = ISODOW(p_fecha),
  --   - vigente en p_fecha (fecha_desde <= fecha <= fecha_hasta o NULL),
  --   - cuyo rango horario [hora_inicio, hora_inicio+duracion) solapa
  --     con el rango horario de la reserva intentada.
  --
  -- Si encontramos uno, RAISE con el nombre del titular para que el
  -- vendedor entienda qué/quién bloquea el slot.
  -- ──────────────────────────────────────────────────────────────────
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

  -- 1. Insert reservas (RLS valida tenant; no_overlap valida superposición
  --    contra otras reservas).
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
    INSERT INTO reserva_pagos (
      club_id, reserva_id, monto, medio_pago, tipo, usuario_id
    ) VALUES (
      v_club_id, v_reserva.id, p_monto_pagado, p_medio_pago, v_tipo_pago, v_usuario_id
    );
  END IF;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_crear_reserva IS
  'Crea reserva + reserva_jugadores + reserva_pagos en una transacción.
   0005: chequeo contra clases activas.
   0031: bloquea slots de turnos fijos activos vigentes (solo aplica a
   reservas sueltas — la materialización hace INSERT directo y no pasa
   por esta RPC). La signatura no cambia entre 0005 y 0031.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0031_bloqueo_slot_turno_fijo.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. La función se reemplazó ----------
-- SELECT obj_description('fn_crear_reserva'::regproc, 'pg_proc');
-- → Debe mencionar "0031: bloquea slots de turnos fijos activos vigentes".

-- ---------- B. Reservar suelto en slot LIBRE → OK ----------
-- Como vendedor de Signo, en un slot sin turno fijo / sin clase:
--   await window.supabase.rpc('fn_crear_reserva', {
--     p_cancha_id: 1, p_fecha: '2026-05-25', p_hora_inicio: '10:00:00',
--     p_duracion_min: 90, p_jugador_titular_id: null,
--     p_jugadores_ids: [], p_nombres_libres: ['Test'],
--     p_tarifa_id: null, p_monto_total: 10000, p_monto_pagado: 0,
--     p_medio_pago: null, p_estado: 'pendiente', p_observaciones: null
--   });
-- → Reserva creada normalmente.

-- ---------- C. LA CRÍTICA: reservar suelto en SLOT de turno fijo activo ----------
-- Asumiendo turno fijo de Juan los miércoles 19:00 cancha 1, vigente:
--   await window.supabase.rpc('fn_crear_reserva', {
--     p_cancha_id: 1, p_fecha: '2026-05-27',  // miércoles
--     p_hora_inicio: '19:00:00', p_duracion_min: 90, ...
--   });
-- → ERROR: 'Ese horario está reservado para el turno fijo de Juan...
--    desactivá o eliminá el turno fijo desde Reservas → Turnos fijos.'

-- ---------- D. Reservar suelto en OTRA hora misma cancha+día → OK ----------
-- Mismo miércoles 21:00 cancha 1 (turno fijo es 19:00):
-- → Reserva creada. El bloqueo es por slot, no por cancha+día.

-- ---------- E. Reservar suelto en OTRA cancha mismo día+hora → OK ----------
-- Miércoles 19:00 cancha 2 (turno fijo es cancha 1):
-- → Reserva creada.

-- ---------- F. Reservar suelto en OTRO día misma cancha+hora → OK ----------
-- Martes 19:00 cancha 1 (turno fijo es miércoles):
-- → Reserva creada.

-- ---------- G. Reservar suelto en slot de turno fijo DESACTIVADO → OK ----------
-- Después de desactivar el turno fijo de Juan:
-- → Reserva creada (el WHERE filtra activo = TRUE).

-- ---------- H. Reservar suelto FUERA de la vigencia → OK ----------
-- Si el turno fijo tiene fecha_hasta = '2026-05-30', intentar reservar
-- el 2026-06-03:
-- → Reserva creada (la fecha está fuera del rango de vigencia).

-- ---------- I. NO ROMPE LA MATERIALIZACIÓN ----------
--   await window.supabase.rpc('fn_materializar_turnos_fijos', {
--     p_fecha_desde: '2026-05-22', p_fecha_hasta: '2026-06-19'
--   });
-- → reservas_creadas > 0 (las que correspondan).
-- → Las reservas materializadas se crean con turno_fijo_id seteado
--   normalmente — esta RPC NO pasa por fn_crear_reserva, no se ve
--   afectada por el bloqueo.

-- ---------- J. Solape parcial → bloquea ----------
-- Turno fijo miércoles 19:00 duración 90 (hasta 20:30).
-- Intentar reservar suelto miércoles 18:30 duración 60 (hasta 19:30):
-- → ERROR: solapa con el turno fijo (tsrange && detecta).

-- ---------- K. Cobros de reservas existentes → no afectados ----------
-- fn_cobrar_reserva, fn_cobrar_persona_turno → ningún cambio, no usan
-- fn_crear_reserva.
-- ============================================================================
