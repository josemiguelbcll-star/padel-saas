-- ============================================================================
-- 0058_tesoreria_rpcs_cuenta_id.sql
-- Tesorería — ETAPA 2, PASO 2: las RPCs de cobro/pago reciben p_cuenta_id y
-- escriben cuenta_id. Generalizan la "regla de oro del efectivo" de basarse en
-- el literal 'efectivo' a basarse en cuentas.es_caja_fisica.
--
-- ⚠ ESTE ARCHIVO SE CONSTRUYE POR GRUPOS Y NO SE APLICA HASTA TENER LOS 3.
--   GRUPO 1 (este commit): ingresos de reservas — fn_crear_reserva,
--            fn_cobrar_reserva, fn_cobrar_persona_turno.
--   GRUPO 2 (pendiente): fn_cobrar_clase, fn_cerrar_venta, fn_registrar_otro_ingreso.
--   GRUPO 3 (pendiente): fn_registrar_gasto, fn_pagar_cuota, fn_recibir_oc
--            (+ revisar fn_anular_pago_cuota).
--   El arqueo (fn_cerrar_caja) es el PASO 3, va en otra migración. Acá NO.
--
-- =====================================================================
-- PATRÓN COMÚN (todas las RPCs de este paso)
-- =====================================================================
-- 1. +p_cuenta_id BIGINT DEFAULT NULL al final de la firma. Compatible con
--    los callers actuales que lo omiten (resuelven el default). Cambiar la
--    firma obliga a DROP + CREATE (CREATE OR REPLACE crearía un overload).
-- 2. Resolver la cuenta:
--      - si viene p_cuenta_id: validar que es del club (RAISE si no) y usarla.
--      - si no: v_cuenta_id := medio_cuenta_default[club, medio]. Si el medio
--        no tiene default, v_cuenta_id queda NULL (NO se hace RAISE — no romper
--        callers; el "obligá a elegir" se enforce en el frontend más adelante).
-- 3. Regla de oro generalizada: v_es_caja := es_caja_fisica de la cuenta
--    resuelta (FALSE si NULL). IF v_es_caja THEN exigir caja abierta + atar
--    turno_caja_id. Para EFECTIVO (→ cuenta Efectivo es_caja_fisica por el
--    seed 0056) esto es IDÉNTICO al comportamiento previo basado en 'efectivo'.
-- 4. Escribir cuenta_id en la fila de plata (columna agregada en 0057).
--
-- BEHAVIOR-PRESERVING para los callers actuales (que NO pasan p_cuenta_id):
--   - efectivo → default Efectivo (es_caja_fisica=true) → atado a caja igual
--     que hoy + RAISE si no hay caja igual que hoy.
--   - no-efectivo sin default → sin caja igual que hoy; cuenta_id NULL.
--   - no-efectivo con default (admin lo mapeó) → sin caja (la cuenta no es
--     es_caja_fisica) igual que hoy; solo se agrega cuenta_id.
--
-- =====================================================================
-- EXCEPCIÓN: fn_crear_reserva (LEER)
-- =====================================================================
-- fn_crear_reserva inserta la seña/pago INICIAL en reserva_pagos, pero NUNCA
-- tuvo la rama de atado a caja (la 0023 no la tocó). Una seña en efectivo al
-- reservar hoy NO exige caja abierta ni setea turno_caja_id (hueco preexistente
-- de la regla de oro). Para mantenerla IDÉNTICA a hoy:
--   - SÍ se agrega p_cuenta_id + se escribe cuenta_id (coherente con el backfill
--     0057: la seña efectivo histórica ya quedó atada a la cuenta Efectivo).
--   - NO se agrega atado a caja (no se introduce un RAISE 'no hay caja' nuevo
--     en el flujo de reservar).
-- Cerrar ese hueco (exigir caja en la seña efectivo) es una decisión deliberada
-- aparte; queda anotado, no se hace en esta migración.
-- ============================================================================

BEGIN;

-- ============================================================================
-- GRUPO 1 — RPC 1/3: fn_crear_reserva (vigente en 0031)
--
-- Cambios respecto de 0031:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL.
--   ⭐ DECLARE: +v_cuenta_id BIGINT.
--   ⭐ Bloque 5 (pago inicial): resuelve la cuenta y la escribe en el INSERT
--      de reserva_pagos. SIN atado a caja (ver EXCEPCIÓN en el header).
-- Resto (chequeo de clases, bloqueo de turno fijo, INSERTs de reservas /
-- reserva_jugadores, cálculo de seña/tipo_pago) IDÉNTICO a 0031.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_crear_reserva(
  BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT,
  DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT
);

CREATE FUNCTION fn_crear_reserva(
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
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
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
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
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

  -- 1. Insert reservas (sin cambios).
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

    -- ⭐ NUEVO 0058 — Resolver cuenta de tesorería (sin atado a caja: ver
    -- EXCEPCIÓN en el header. Esta RPC NO exige caja para la seña efectivo,
    -- igual que hoy; solo etiqueta la cuenta).
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
      cuenta_id                                            -- ⭐ NUEVO 0058
    ) VALUES (
      v_club_id, v_reserva.id, p_monto_pagado, p_medio_pago, v_tipo_pago, v_usuario_id,
      v_cuenta_id                                          -- ⭐ NUEVO 0058
    );
  END IF;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_crear_reserva IS
  'Crea reserva + reserva_jugadores + reserva_pagos en una transacción.
   0005: chequeo contra clases activas. 0031: bloquea slots de turnos fijos
   vigentes (solo reservas sueltas). 0058: la seña/pago inicial escribe
   cuenta_id (default del medio o p_cuenta_id). SIN atado a caja (hueco
   preexistente preservado — ver header de la migración).';

GRANT EXECUTE ON FUNCTION fn_crear_reserva(
  BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[], BIGINT,
  DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT, BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 1 — RPC 2/3: fn_cobrar_reserva (legacy/deprecada, vigente en 0023)
--
-- Cambios respecto de 0023:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL.
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN.
--   ⭐ El bloque "si efectivo → atar caja" se GENERALIZA a "si la cuenta es
--      es_caja_fisica → atar caja". Para efectivo es idéntico.
--   ⭐ INSERT en reserva_pagos agrega cuenta_id.
-- Resto (locks, cálculo tipo_pago/saldo/estado, UPDATE reservas) IDÉNTICO.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_cobrar_reserva(BIGINT, DECIMAL, VARCHAR, TEXT);

CREATE FUNCTION fn_cobrar_reserva(
  p_reserva_id BIGINT,
  p_monto DECIMAL,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
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
  v_saldo DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_monto_sena DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_tipo_pago VARCHAR(20);
  v_titular_id BIGINT;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- ⭐ NUEVO 0058 — Resolver cuenta + regla de oro generalizada.
  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica INTO v_es_caja
    FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
    FROM medio_cuenta_default mcd
    JOIN cuentas c ON c.id = mcd.cuenta_id
    WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
  END IF;
  v_es_caja := COALESCE(v_es_caja, FALSE);

  -- Si la cuenta entra al arqueo (es_caja_fisica): exigir caja abierta y atar.
  -- Para efectivo (→ Efectivo es_caja_fisica) es IDÉNTICO al literal previo.
  IF v_es_caja THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  -- Lock de la reserva (igual que antes).
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar sobre una reserva cancelada.';
  END IF;

  v_saldo := v_reserva.monto_total - v_reserva.monto_pagado;
  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Esta reserva ya está paga, no hay saldo para cobrar.';
  END IF;

  v_nuevo_monto_pagado := v_reserva.monto_pagado + p_monto;

  IF v_nuevo_monto_pagado > v_reserva.monto_total THEN
    RAISE EXCEPTION 'El cobro de $% supera el saldo pendiente de $%. Ajustá el monto.',
      p_monto, v_saldo;
  END IF;

  IF v_reserva.estado = 'pendiente' AND v_nuevo_monto_pagado < v_reserva.monto_total THEN
    v_tipo_pago := 'sena';
    v_nuevo_monto_sena := p_monto;
  ELSE
    v_tipo_pago := 'pago';
    v_nuevo_monto_sena := v_reserva.monto_sena;
  END IF;

  IF v_nuevo_monto_pagado >= v_reserva.monto_total THEN
    v_nuevo_estado := CASE WHEN v_reserva.estado = 'jugada' THEN 'jugada' ELSE 'pagada' END;
  ELSE
    v_nuevo_estado := CASE WHEN v_reserva.estado = 'jugada' THEN 'jugada' ELSE 'senada' END;
  END IF;

  SELECT id INTO v_titular_id
  FROM reserva_jugadores
  WHERE reserva_id = p_reserva_id
    AND es_titular = TRUE
    AND tipo = 'jugador'
  LIMIT 1;

  -- ⭐ NUEVO 0058 — INSERT incluye cuenta_id (y turno_caja_id como antes).
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id,
    reserva_jugador_id, monto_alquiler, monto_consumo,
    turno_caja_id, cuenta_id                               -- ⭐ NUEVO 0058
  ) VALUES (
    v_club_id, p_reserva_id, p_monto, p_medio_pago, v_tipo_pago, v_usuario_id,
    v_titular_id, p_monto, 0,
    v_turno_caja_id, v_cuenta_id                           -- ⭐ NUEVO 0058
  );

  UPDATE reservas
  SET monto_pagado = v_nuevo_monto_pagado,
      monto_sena = v_nuevo_monto_sena,
      estado = v_nuevo_estado
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_cobrar_reserva IS
  'DEPRECADA desde 0014 (usar fn_cobrar_persona_turno). 0023: regla de oro del
   efectivo. 0058: +p_cuenta_id, escribe cuenta_id y generaliza el atado a caja
   a cuentas.es_caja_fisica (idéntico para efectivo).';

GRANT EXECUTE ON FUNCTION fn_cobrar_reserva(
  BIGINT, DECIMAL, VARCHAR, TEXT, BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 1 — RPC 3/3: fn_cobrar_persona_turno (vigente en 0023, body de 0015)
--
-- Cambios respecto de 0023:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL.
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN.
--   ⭐ El bloque "si efectivo → atar caja" se GENERALIZA a es_caja_fisica.
--   ⭐ INSERT en reserva_pagos agrega cuenta_id.
-- Resto (división Forma B + CEIL, validación cruzada p_monto_esperado,
-- UPDATE de monto_pagado/estado) IDÉNTICO.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_cobrar_persona_turno(BIGINT, VARCHAR, TEXT, DECIMAL);

CREATE FUNCTION fn_cobrar_persona_turno(
  p_reserva_jugador_id BIGINT,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_monto_esperado DECIMAL,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
)
RETURNS reserva_pagos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_persona reserva_jugadores;
  v_reserva reservas;
  v_cantidad_jugadores INT;
  v_cantidad_personas INT;
  v_total_consumos_partido DECIMAL(12,2);
  v_total_consumos_general DECIMAL(12,2);
  v_parte_alquiler DECIMAL(12,2);
  v_parte_consumo_partido DECIMAL(12,2);
  v_parte_consumo_general DECIMAL(12,2);
  v_parte_consumo DECIMAL(12,2);
  v_ya_pagado_alquiler DECIMAL(12,2);
  v_ya_pagado_consumo DECIMAL(12,2);
  v_saldo_alquiler DECIMAL(12,2);
  v_saldo_consumo DECIMAL(12,2);
  v_monto_real DECIMAL(12,2);
  v_parte_total DECIMAL(12,2);
  v_ya_pagado_total DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_pago reserva_pagos;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  IF p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ⭐ NUEVO 0058 — Resolver cuenta + regla de oro generalizada.
  -- Falla rápido ANTES del lock (igual que el bloque de efectivo de 0023).
  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica INTO v_es_caja
    FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
    FROM medio_cuenta_default mcd
    JOIN cuentas c ON c.id = mcd.cuenta_id
    WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
  END IF;
  v_es_caja := COALESCE(v_es_caja, FALSE);

  IF v_es_caja THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  -- Lock de la persona del turno (serializa cobros concurrentes).
  SELECT * INTO v_persona
  FROM reserva_jugadores
  WHERE id = p_reserva_jugador_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona no existe o no pertenece a tu club.';
  END IF;

  -- Lock de la reserva (para que no se cancele mid-flight).
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_persona.reserva_id
  FOR UPDATE;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar a personas de una reserva cancelada.';
  END IF;

  -- Cantidades para la división.
  SELECT COUNT(*) INTO v_cantidad_jugadores
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id AND tipo = 'jugador';

  SELECT COUNT(*) INTO v_cantidad_personas
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id;

  -- DOS bolsas de consumo, separadas por tipo_reparto (0015).
  SELECT
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'partido'), 0),
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'general'), 0)
  INTO v_total_consumos_partido, v_total_consumos_general
  FROM reserva_consumos
  WHERE reserva_id = v_persona.reserva_id;

  -- Partes (Forma B con CEIL al peso).
  v_parte_alquiler := CASE
    WHEN v_cantidad_jugadores > 0 AND v_reserva.monto_total > 0
    THEN CEIL(v_reserva.monto_total / v_cantidad_jugadores)
    ELSE 0
  END;

  v_parte_consumo_partido := CASE
    WHEN v_cantidad_jugadores > 0 AND v_total_consumos_partido > 0
    THEN CEIL(v_total_consumos_partido / v_cantidad_jugadores)
    ELSE 0
  END;

  v_parte_consumo_general := CASE
    WHEN v_cantidad_personas > 0 AND v_total_consumos_general > 0
    THEN CEIL(v_total_consumos_general / v_cantidad_personas)
    ELSE 0
  END;

  v_parte_consumo := CASE
    WHEN v_persona.tipo = 'jugador'
    THEN v_parte_consumo_partido + v_parte_consumo_general
    ELSE v_parte_consumo_general
  END;

  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(monto_consumo), 0)
  INTO v_ya_pagado_alquiler, v_ya_pagado_consumo
  FROM reserva_pagos
  WHERE reserva_jugador_id = p_reserva_jugador_id;

  v_saldo_alquiler := GREATEST(
    0,
    (CASE WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler ELSE 0 END)
      - v_ya_pagado_alquiler
  );
  v_saldo_consumo := GREATEST(0, v_parte_consumo - v_ya_pagado_consumo);

  v_monto_real := v_saldo_alquiler + v_saldo_consumo;

  IF v_monto_real <= 0 THEN
    v_parte_total := CASE
      WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler + v_parte_consumo
      ELSE v_parte_consumo
    END;
    v_ya_pagado_total := v_ya_pagado_alquiler + v_ya_pagado_consumo;
    RAISE EXCEPTION 'Esta persona ya está saldada (pagó $% de $%).',
      v_ya_pagado_total, v_parte_total;
  END IF;

  IF p_monto_esperado IS NULL OR p_monto_esperado <> v_monto_real THEN
    RAISE EXCEPTION
      'La cuenta del turno cambió, revisá el monto antes de cobrar (esperabas $% pero el saldo real es $%).',
      COALESCE(p_monto_esperado, 0), v_monto_real;
  END IF;

  -- ⭐ NUEVO 0058 — INSERT incluye cuenta_id (y turno_caja_id como antes).
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
    jugador_id,
    reserva_jugador_id, monto_alquiler, monto_consumo,
    turno_caja_id, cuenta_id                               -- ⭐ NUEVO 0058
  ) VALUES (
    v_club_id, v_persona.reserva_id, v_monto_real, p_medio_pago, 'pago', v_usuario_id, p_observaciones,
    v_persona.jugador_id,
    p_reserva_jugador_id, v_saldo_alquiler, v_saldo_consumo,
    v_turno_caja_id, v_cuenta_id                           -- ⭐ NUEVO 0058
  )
  RETURNING * INTO v_pago;

  v_nuevo_monto_pagado := v_reserva.monto_pagado + v_saldo_alquiler;

  v_nuevo_estado := CASE
    WHEN v_reserva.estado IN ('jugada', 'cancelada') THEN v_reserva.estado
    WHEN v_nuevo_monto_pagado >= v_reserva.monto_total THEN 'pagada'
    WHEN v_nuevo_monto_pagado > 0 THEN 'senada'
    ELSE v_reserva.estado
  END;

  UPDATE reservas
  SET monto_pagado = v_nuevo_monto_pagado,
      estado = v_nuevo_estado
  WHERE id = v_persona.reserva_id;

  RETURN v_pago;
END;
$$;

COMMENT ON FUNCTION fn_cobrar_persona_turno IS
  'Cobro por persona del turno (división Forma B). 0023: regla de oro del
   efectivo. 0058: +p_cuenta_id, escribe cuenta_id y generaliza el atado a caja
   a cuentas.es_caja_fisica (idéntico para efectivo).';

GRANT EXECUTE ON FUNCTION fn_cobrar_persona_turno(
  BIGINT, VARCHAR, TEXT, DECIMAL, BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 2 — RPC 1/3: fn_cobrar_clase (vigente en 0035, firma de 4 params)
--
-- Cambios respecto de 0035:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL.
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN.
--   ⭐ El bloque "si efectivo → atar caja" se GENERALIZA a es_caja_fisica.
--   ⭐ INSERT en clase_cobros agrega cuenta_id.
-- Resto (resolución de tarifa server-side via fn_resolver_tarifa_clase,
-- snapshot del monto, FOR UPDATE de la clase, weekday) IDÉNTICO a 0035.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_cobrar_clase(BIGINT, DATE, VARCHAR, TEXT);

CREATE FUNCTION fn_cobrar_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
)
RETURNS clase_cobros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clase clases;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cobro clase_cobros;
  v_turno_caja_id BIGINT := NULL;
  v_tarifa_resuelta RECORD;
  v_monto DECIMAL(12,2);
  v_dia_nombre TEXT;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  -- ── Validación: sesión activa (PRESERVADA, idéntica a 0035). ──────
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- ── Validación: medio de pago obligatorio (PRESERVADA). ───────────
  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- ⭐ NUEVO 0058 — Resolver cuenta + regla de oro generalizada.
  -- Para efectivo (→ Efectivo es_caja_fisica) es IDÉNTICO al bloque de
  -- efectivo de 0035 (mismo RAISE, mismo turno_caja_id).
  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica INTO v_es_caja
    FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
    FROM medio_cuenta_default mcd
    JOIN cuentas c ON c.id = mcd.cuenta_id
    WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
  END IF;
  v_es_caja := COALESCE(v_es_caja, FALSE);

  IF v_es_caja THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  -- ── Lock + validación de clase (PRESERVADA). ──────────────────────
  SELECT * INTO v_clase
  FROM clases
  WHERE id = p_clase_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece a tu club.';
  END IF;

  -- ── Validación: weekday (PRESERVADA). ─────────────────────────────
  IF NOT (EXTRACT(ISODOW FROM p_fecha)::INT = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION
      'La clase no se dicta el % — revisá los días configurados.', p_fecha;
  END IF;

  -- ── Resolver tarifa de clase para (fecha, hora_clase) (0035). ─────
  SELECT tarifa_id, monto INTO v_tarifa_resuelta
  FROM fn_resolver_tarifa_clase(p_fecha, v_clase.hora_inicio);

  IF v_tarifa_resuelta.tarifa_id IS NULL THEN
    v_dia_nombre := CASE EXTRACT(ISODOW FROM p_fecha)::INT
      WHEN 1 THEN 'lunes'
      WHEN 2 THEN 'martes'
      WHEN 3 THEN 'miércoles'
      WHEN 4 THEN 'jueves'
      WHEN 5 THEN 'viernes'
      WHEN 6 THEN 'sábados'
      WHEN 7 THEN 'domingos'
    END;
    RAISE EXCEPTION
      'No hay tarifa de clase configurada para los % a las %. Configurala en Configuración → Tarifas (pestaña Clases) antes de cobrar.',
      v_dia_nombre, to_char(v_clase.hora_inicio, 'HH24:MI');
  END IF;

  v_monto := v_tarifa_resuelta.monto;

  -- ⭐ NUEVO 0058 — INSERT incluye cuenta_id (y turno_caja_id como antes).
  INSERT INTO clase_cobros (
    club_id, clase_id, fecha, monto, medio_pago, observaciones, usuario_id,
    turno_caja_id, cuenta_id                               -- ⭐ NUEVO 0058
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, v_monto, p_medio_pago, p_observaciones,
    v_usuario_id, v_turno_caja_id, v_cuenta_id             -- ⭐ NUEVO 0058
  )
  RETURNING * INTO v_cobro;

  RETURN v_cobro;
END;
$$;

COMMENT ON FUNCTION fn_cobrar_clase IS
  'Registra un cobro de ocurrencia de clase. Modelo B (0035): monto resuelto
   server-side via fn_resolver_tarifa_clase. 0058: +p_cuenta_id, escribe
   cuenta_id y generaliza el atado a caja a cuentas.es_caja_fisica (idéntico
   para efectivo).';

GRANT EXECUTE ON FUNCTION fn_cobrar_clase(
  BIGINT, DATE, VARCHAR, TEXT, BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 2 — RPC 2/3: fn_cerrar_venta (vigente en 0025; multi-tabla)
--
-- Cambios respecto de 0025:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL.
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN.
--   ⭐ El bloque "si efectivo → atar caja" se GENERALIZA a es_caja_fisica.
--   ⭐ El INSERT en `ventas` (header) agrega cuenta_id.
-- Los INSERTs en venta_items y movimientos_stock NO se tocan (no tienen
-- medio_pago/cuenta_id). Consolidación de ítems, lock de productos, validación
-- de stock y snapshot de costo/linea IDÉNTICOS a 0025.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_cerrar_venta(JSONB, VARCHAR, TEXT);

CREATE FUNCTION fn_cerrar_venta(
  p_items JSONB,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
)
RETURNS ventas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_venta ventas;
  v_producto productos;
  v_stock INT;
  v_total DECIMAL(12,2) := 0;
  v_pids BIGINT[];
  v_cants INT[];
  v_i INT;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta tiene que tener al menos un producto.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  IF p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ⭐ NUEVO 0058 — Resolver cuenta + regla de oro generalizada.
  -- Falla rápido antes del lock de productos (igual que el bloque de
  -- efectivo de 0025/0023). Para efectivo es IDÉNTICO.
  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica INTO v_es_caja
    FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
    FROM medio_cuenta_default mcd
    JOIN cuentas c ON c.id = mcd.cuenta_id
    WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
  END IF;
  v_es_caja := COALESCE(v_es_caja, FALSE);

  IF v_es_caja THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  -- Consolidar ítems duplicados por producto_id (ver comentario en 0009).
  SELECT
    array_agg(producto_id ORDER BY producto_id),
    array_agg(cantidad ORDER BY producto_id)
  INTO v_pids, v_cants
  FROM (
    SELECT
      (x->>'producto_id')::BIGINT AS producto_id,
      SUM((x->>'cantidad')::INT)::INT AS cantidad
    FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT
  ) c;

  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    IF v_cants[v_i] IS NULL OR v_cants[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
    END IF;
  END LOOP;

  -- Lock exclusivo de los productos involucrados, en orden ASC de id.
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- Validar cada producto + acumular total.
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto seleccionado no existe o no pertenece a tu club.';
    END IF;

    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
    END IF;

    SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
    FROM movimientos_stock
    WHERE producto_id = v_producto.id;

    IF v_stock < v_cants[v_i] THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": hay % unidades, querés vender %.',
        v_producto.nombre, v_stock, v_cants[v_i];
    END IF;

    v_total := v_total + (v_producto.precio * v_cants[v_i]);
  END LOOP;

  -- ⭐ NUEVO 0058 — Header de la venta incluye cuenta_id (y turno_caja_id).
  INSERT INTO ventas (
    club_id, monto_total, medio_pago, observaciones, usuario_id,
    turno_caja_id, cuenta_id                               -- ⭐ NUEVO 0058
  )
  VALUES (
    v_club_id, v_total, p_medio_pago, p_observaciones, v_usuario_id,
    v_turno_caja_id, v_cuenta_id                           -- ⭐ NUEVO 0058
  )
  RETURNING * INTO v_venta;

  -- Items + movimientos. IDÉNTICO a 0025 (linea snapshot incluida).
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    INSERT INTO venta_items (
      club_id, venta_id, producto_id, producto_nombre,
      cantidad, precio_unitario, costo_unitario, subtotal,
      linea
    ) VALUES (
      v_club_id, v_venta.id, v_producto.id, v_producto.nombre,
      v_cants[v_i], v_producto.precio, v_producto.costo,
      v_producto.precio * v_cants[v_i],
      v_producto.linea
    );

    INSERT INTO movimientos_stock (
      club_id, producto_id, cantidad, fuente, venta_id, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, -v_cants[v_i], 'venta', v_venta.id, v_usuario_id
    );
  END LOOP;

  RETURN v_venta;
END;
$$;

COMMENT ON FUNCTION fn_cerrar_venta IS
  'Venta de mostrador atómica (header ventas + venta_items + movimientos_stock).
   0023: regla de oro del efectivo. 0025: snapshot de linea en venta_items.
   0058: +p_cuenta_id, el header escribe cuenta_id y generaliza el atado a caja
   a cuentas.es_caja_fisica (idéntico para efectivo).';

GRANT EXECUTE ON FUNCTION fn_cerrar_venta(
  JSONB, VARCHAR, TEXT, BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 2 — RPC 3/3: fn_registrar_otro_ingreso (vigente en 0028)
--
-- Cambios respecto de 0028:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL.
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN.
--   ⭐ El bloque "si efectivo → atar caja" se GENERALIZA a es_caja_fisica,
--      PERO solo cuando hay cobro (p_medio_pago IS NOT NULL). Un ingreso
--      pendiente (sin cobro) deja cuenta_id NULL: no cayó plata todavía.
--   ⭐ INSERT en otros_ingresos agrega cuenta_id.
-- Resto (gate de rol, validación de monto/fecha/concepto, cobro atómico,
-- resolución de unidad + snapshots) IDÉNTICO a 0028.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_registrar_otro_ingreso(
  BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT
);

CREATE FUNCTION fn_registrar_otro_ingreso(
  p_unidad_id BIGINT,
  p_concepto VARCHAR,
  p_monto DECIMAL,
  p_fecha DATE,
  p_fecha_cobro DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
)
RETURNS otros_ingresos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_unidad unidades_negocio;
  v_turno_caja_id BIGINT := NULL;
  v_concepto_trim VARCHAR;
  v_ingreso otros_ingresos;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para registrar ingresos.';
  END IF;

  -- Validaciones.
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del ingreso debe ser mayor a 0.';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha del ingreso es obligatoria.';
  END IF;

  v_concepto_trim := TRIM(COALESCE(p_concepto, ''));
  IF LENGTH(v_concepto_trim) = 0 THEN
    RAISE EXCEPTION 'El concepto del ingreso es obligatorio.';
  END IF;
  IF LENGTH(v_concepto_trim) > 200 THEN
    RAISE EXCEPTION 'El concepto puede tener hasta 200 caracteres.';
  END IF;

  -- Cobro atómico: o ambos vienen, o ninguno.
  IF (p_fecha_cobro IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si cobraste el ingreso, tenés que indicar fecha de cobro Y medio de pago. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- Resolver unidad (con check de club).
  SELECT * INTO v_unidad
  FROM unidades_negocio
  WHERE id = p_unidad_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad de negocio no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_unidad.activa THEN
    RAISE EXCEPTION
      'La unidad "%" está desactivada — no se pueden cargar ingresos sobre ella. Pedile al admin que la reactive o elegí otra.',
      v_unidad.nombre;
  END IF;

  -- ⭐ NUEVO 0058 — Resolver cuenta + regla de oro generalizada, SOLO si hay
  -- cobro. Un ingreso pendiente (sin medio) no cayó en ninguna cuenta todavía
  -- → cuenta_id NULL. Para efectivo es IDÉNTICO al bloque de efectivo de 0028.
  IF p_medio_pago IS NOT NULL THEN
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM medio_cuenta_default mcd
      JOIN cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;
    v_es_caja := COALESCE(v_es_caja, FALSE);

    IF v_es_caja THEN
      v_turno_caja_id := current_club_caja_abierta();
      IF v_turno_caja_id IS NULL THEN
        RAISE EXCEPTION
          'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar/pagar en efectivo.';
      END IF;
    END IF;
  END IF;

  -- ⭐ NUEVO 0058 — INSERT incluye cuenta_id (y turno_caja_id como antes).
  INSERT INTO otros_ingresos (
    club_id,
    unidad_id, unidad_nombre, unidad_tipo,
    concepto, monto, fecha,
    fecha_cobro, medio_pago, turno_caja_id,
    observaciones,
    usuario_id,
    cuenta_id                                              -- ⭐ NUEVO 0058
  ) VALUES (
    v_club_id,
    v_unidad.id, v_unidad.nombre, v_unidad.tipo,
    v_concepto_trim, p_monto, p_fecha,
    p_fecha_cobro, p_medio_pago, v_turno_caja_id,
    p_observaciones,
    v_usuario_id,
    v_cuenta_id                                            -- ⭐ NUEVO 0058
  )
  RETURNING * INTO v_ingreso;

  RETURN v_ingreso;
END;
$$;

COMMENT ON FUNCTION fn_registrar_otro_ingreso(BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT, BIGINT) IS
  'Registra un otro_ingreso con snapshot de unidad. Cobro opcional. 0058:
   +p_cuenta_id, escribe cuenta_id (solo si hay cobro) y generaliza el atado a
   caja a cuentas.es_caja_fisica (idéntico para efectivo).';

GRANT EXECUTE ON FUNCTION fn_registrar_otro_ingreso(
  BIGINT, VARCHAR, DECIMAL, DATE, DATE, VARCHAR, TEXT, BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 3 — RPC 1/4: fn_registrar_gasto (vigente en 0049, v5, 11 params)
--
-- Cambios respecto de 0049:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL (12º param).
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN.
--   ⭐ El bloque "si efectivo → atar caja" se GENERALIZA a es_caja_fisica,
--      SOLO cuando hay pago directo (p_medio_pago IS NOT NULL). Un gasto
--      pendiente deja cuenta_id NULL (el pago vive en gasto_cuotas).
--   ⭐ INSERT en gastos agrega cuenta_id = v_cuenta_id (NULL si pendiente).
-- La cuota automática (gasto pendiente) NO lleva cuenta (nace impaga; su
-- cuenta la setea fn_pagar_cuota al pagarla) — coherente con el backfill 0057
-- (gasto en cuotas ⇒ gastos.cuenta_id NULL, sin doble conteo). Resto IDÉNTICO
-- a 0049 (gate, snapshots, proveedor, plantilla recurrente uno-por-mes,
-- captura de unique_violation).
-- ============================================================================
DROP FUNCTION IF EXISTS fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN, BIGINT
);

CREATE FUNCTION fn_registrar_gasto(
  p_categoria_id BIGINT,
  p_monto DECIMAL,
  p_fecha_gasto DATE,
  p_proveedor VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_proveedor_id BIGINT DEFAULT NULL,
  p_fecha_vencimiento DATE DEFAULT NULL,
  p_skip_cuota_automatica BOOLEAN DEFAULT FALSE,
  p_gasto_recurrente_id BIGINT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
)
RETURNS gastos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_categoria categorias_gasto;
  v_unidad unidades_negocio;
  v_proveedor proveedores;
  v_proveedor_snapshot VARCHAR(120) := p_proveedor;
  v_recurrente gastos_recurrentes;
  v_turno_caja_id BIGINT := NULL;
  v_gasto gastos;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para registrar gastos.';
  END IF;

  -- Validaciones de input.
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del gasto debe ser mayor a 0.';
  END IF;

  IF p_fecha_gasto IS NULL THEN
    RAISE EXCEPTION 'La fecha del gasto es obligatoria.';
  END IF;

  -- Pago atómico: o ambos vienen, o ninguno.
  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si pagás el gasto, tenés que indicar fecha de pago Y medio de pago. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;

  -- Validar medio_pago si viene.
  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- Resolver categoría → unidad (con check de club).
  SELECT * INTO v_categoria
  FROM categorias_gasto
  WHERE id = p_categoria_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_categoria.activa THEN
    RAISE EXCEPTION
      'La categoría "%" está desactivada — no se pueden cargar gastos sobre ella. Pedile al admin que la reactive o elegí otra.',
      v_categoria.nombre;
  END IF;

  SELECT * INTO v_unidad
  FROM unidades_negocio
  WHERE id = v_categoria.unidad_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La unidad de negocio asociada a la categoría no existe.';
  END IF;

  -- Resolver proveedor si viene proveedor_id (snapshot del nombre gana).
  IF p_proveedor_id IS NOT NULL THEN
    SELECT * INTO v_proveedor
    FROM proveedores
    WHERE id = p_proveedor_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
    END IF;
    IF NOT v_proveedor.activo THEN
      RAISE EXCEPTION
        'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de cargar el gasto.',
        v_proveedor.nombre;
    END IF;

    v_proveedor_snapshot := v_proveedor.nombre;
  END IF;

  -- 0046/0049: plantilla recurrente — valida + uno-por-mes.
  IF p_gasto_recurrente_id IS NOT NULL THEN
    SELECT * INTO v_recurrente
    FROM gastos_recurrentes
    WHERE id = p_gasto_recurrente_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La plantilla recurrente no existe o no pertenece a tu club.';
    END IF;

    IF v_recurrente.categoria_id <> p_categoria_id THEN
      RAISE EXCEPTION
        'La categoría del gasto no coincide con la categoría de la plantilla "%". Si querés cambiar la categoría, editá la plantilla primero.',
        v_recurrente.concepto;
    END IF;

    IF EXISTS (
      SELECT 1 FROM gastos
      WHERE gasto_recurrente_id = p_gasto_recurrente_id
        AND club_id = v_club_id
        AND activo = TRUE
        AND date_trunc('month', fecha_gasto::timestamp)
            = date_trunc('month', p_fecha_gasto::timestamp)
    ) THEN
      RAISE EXCEPTION
        'Ya cargaste un gasto de "%" para %. Si el monto está mal, corregilo desde la tarjeta de recurrentes (no cargues otro).',
        v_recurrente.concepto, to_char(p_fecha_gasto, 'MM/YYYY');
    END IF;
  END IF;

  -- ⭐ NUEVO 0058 — Resolver cuenta (solo si el gasto se paga DIRECTO) + regla
  -- de oro generalizada. Un gasto pendiente (sin medio) deja cuenta_id NULL: el
  -- pago vive en gasto_cuotas (su cuenta la setea fn_pagar_cuota). Para efectivo
  -- es IDÉNTICO al bloque de efectivo de 0049.
  IF p_medio_pago IS NOT NULL THEN
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM medio_cuenta_default mcd
      JOIN cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;
    v_es_caja := COALESCE(v_es_caja, FALSE);

    IF v_es_caja THEN
      v_turno_caja_id := current_club_caja_abierta();
      IF v_turno_caja_id IS NULL THEN
        RAISE EXCEPTION
          'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar/pagar en efectivo.';
      END IF;
    END IF;
  END IF;

  -- INSERT del gasto (puede disparar uq_gasto_recurrente_mes en una race;
  -- capturamos con el mismo mensaje amable — IDÉNTICO a 0049).
  BEGIN
    INSERT INTO gastos (
      club_id,
      categoria_id, categoria_nombre,
      unidad_id, unidad_nombre, unidad_tipo,
      monto, fecha_gasto,
      fecha_pago, medio_pago, turno_caja_id,
      proveedor, proveedor_id,
      observaciones,
      gasto_recurrente_id,
      usuario_id,
      cuenta_id                                            -- ⭐ NUEVO 0058
    ) VALUES (
      v_club_id,
      v_categoria.id, v_categoria.nombre,
      v_unidad.id, v_unidad.nombre, v_unidad.tipo,
      p_monto, p_fecha_gasto,
      p_fecha_pago, p_medio_pago, v_turno_caja_id,
      v_proveedor_snapshot, p_proveedor_id,
      p_observaciones,
      p_gasto_recurrente_id,
      v_usuario_id,
      v_cuenta_id                                          -- ⭐ NUEVO 0058
    )
    RETURNING * INTO v_gasto;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION
        'Ya cargaste un gasto de "%" para %. Si el monto está mal, corregilo desde la tarjeta de recurrentes (no cargues otro).',
        v_recurrente.concepto, to_char(p_fecha_gasto, 'MM/YYYY');
  END;

  -- 0045: gasto pendiente sin skip → genera cuota total. Nace IMPAGA →
  -- cuenta_id NULL (la setea fn_pagar_cuota al pagarla). IDÉNTICO a 0049.
  IF v_gasto.fecha_pago IS NULL AND NOT p_skip_cuota_automatica THEN
    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id
    ) VALUES (
      v_club_id, v_gasto.id, 1, FALSE, v_gasto.monto,
      p_fecha_vencimiento, NULL, NULL, NULL,
      v_usuario_id
    );
  END IF;

  RETURN v_gasto;
END;
$$;

COMMENT ON FUNCTION fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN, BIGINT, BIGINT
) IS
  'Registra un gasto con snapshots de categoría/unidad/proveedor. 0045: cuota
   automática si nace pendiente. 0046/0049: plantilla recurrente uno-por-mes.
   0058: +p_cuenta_id; un gasto pagado directo escribe cuenta_id en gastos
   (regla de oro generalizada a es_caja_fisica, idéntica para efectivo); un
   gasto pendiente deja gastos.cuenta_id NULL (su pago vive en gasto_cuotas).
   Gate: admin O vendedor.';

GRANT EXECUTE ON FUNCTION fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN, BIGINT, BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 3 — RPC 2/4: fn_pagar_cuota (vigente en 0048; +guarda gasto activo)
--
-- Cambios respecto de 0048:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL.
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN.
--   ⭐ El bloque "si efectivo → atar caja" se GENERALIZA a es_caja_fisica.
--   ⭐ El UPDATE de la cuota escribe cuenta_id.
-- Resto IDÉNTICO a 0048 (FOR UPDATE anti-doble-pago, guarda de gasto madre
-- anulado, NO toca gastos.fecha_pago).
-- ============================================================================
DROP FUNCTION IF EXISTS fn_pagar_cuota(BIGINT, DATE, VARCHAR);

CREATE FUNCTION fn_pagar_cuota(
  p_cuota_id BIGINT,
  p_fecha_pago DATE,
  p_medio_pago VARCHAR,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
)
RETURNS gasto_cuotas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cuota gasto_cuotas;
  v_gasto_activo BOOLEAN;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para pagar cuotas.';
  END IF;

  -- Validaciones de input.
  IF p_fecha_pago IS NULL THEN
    RAISE EXCEPTION 'La fecha de pago es obligatoria.';
  END IF;
  IF p_medio_pago IS NULL
     OR p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ── Lock exclusivo de la cuota + validación bajo el lock (0048). ──
  SELECT * INTO v_cuota
  FROM gasto_cuotas
  WHERE id = p_cuota_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuota no existe o no pertenece a tu club.';
  END IF;
  IF v_cuota.fecha_pago IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta cuota ya está pagada (% por %).',
      v_cuota.fecha_pago, v_cuota.medio_pago;
  END IF;

  -- ── Guarda 0048: gasto madre no anulado. ──────────────────────────
  SELECT activo INTO v_gasto_activo
  FROM gastos
  WHERE id = v_cuota.gasto_id;

  IF NOT v_gasto_activo THEN
    RAISE EXCEPTION 'No se puede pagar la cuota de un gasto anulado.';
  END IF;

  -- ⭐ NUEVO 0058 — Resolver cuenta + regla de oro generalizada.
  -- Para efectivo (→ Efectivo es_caja_fisica) es IDÉNTICO al bloque de
  -- efectivo de 0048 (mismo RAISE/turno_caja_id).
  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica INTO v_es_caja
    FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
    FROM medio_cuenta_default mcd
    JOIN cuentas c ON c.id = mcd.cuenta_id
    WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
  END IF;
  v_es_caja := COALESCE(v_es_caja, FALSE);

  IF v_es_caja THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de pagar en efectivo.';
    END IF;
  END IF;

  -- ── Marcar como pagada (NO toca gastos.fecha_pago). ───────────────
  -- ⭐ NUEVO 0058: escribe cuenta_id.
  UPDATE gasto_cuotas
  SET fecha_pago = p_fecha_pago,
      medio_pago = p_medio_pago,
      turno_caja_id = v_turno_caja_id,
      cuenta_id = v_cuenta_id                              -- ⭐ NUEVO 0058
  WHERE id = p_cuota_id
  RETURNING * INTO v_cuota;

  RETURN v_cuota;
END;
$$;

COMMENT ON FUNCTION fn_pagar_cuota(BIGINT, DATE, VARCHAR, BIGINT) IS
  'Marca una cuota pendiente como pagada (lock FOR UPDATE anti-doble-pago;
   guarda 0048 de gasto madre anulado; NO toca gastos.fecha_pago). 0058:
   +p_cuenta_id, escribe cuenta_id y generaliza el atado a caja a
   cuentas.es_caja_fisica (idéntico para efectivo). Gate: admin O vendedor.';

GRANT EXECUTE ON FUNCTION fn_pagar_cuota(BIGINT, DATE, VARCHAR, BIGINT) TO authenticated;


-- ============================================================================
-- GRUPO 3 — RPC 3/4: fn_recibir_oc (vigente en 0045, v3, 10 params)
--
-- Cambios respecto de 0045:
--   ⭐ Firma: +p_cuenta_id BIGINT DEFAULT NULL (11º param).
--   ⭐ DECLARE: +v_cuenta_id BIGINT, +v_es_caja BOOLEAN, +v_cuota_cuenta_id.
--   ⭐ El bloque "si efectivo → atar caja" del pago al recibir se GENERALIZA
--      a es_caja_fisica.
--   ⭐ La cuota que se paga al recibir (anticipo o única) escribe cuenta_id;
--      las cuotas futuras nacen con cuenta_id NULL (la setean al pagarse con
--      fn_pagar_cuota).
-- El gasto sigue naciendo SIEMPRE pendiente (gastos.cuenta_id NULL — el pago
-- vive en las cuotas). Resto IDÉNTICO a 0045 (gate admin, fiscal, PPP, stock,
-- plan de cuotas, atomicidad).
-- ============================================================================
DROP FUNCTION IF EXISTS fn_recibir_oc(
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR, DECIMAL, INT, DATE[]
);

CREATE FUNCTION fn_recibir_oc(
  p_compra_id BIGINT,
  p_fecha_recepcion DATE,
  p_items_recepcion JSONB,
  p_comprobante_tipo VARCHAR DEFAULT NULL,
  p_comprobante_numero VARCHAR DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_anticipo DECIMAL DEFAULT 0,
  p_cantidad_cuotas INT DEFAULT 1,
  p_fechas_vencimiento DATE[] DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL                          -- ⭐ NUEVO 0058
)
RETURNS compras
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_compra compras;
  v_proveedor proveedores;
  v_categoria categorias_gasto;
  v_condicion_fiscal VARCHAR;
  v_gasto gastos;
  v_pids BIGINT[];
  v_bultos INT[];
  v_und_por_bulto INT[];
  v_costos_por_bulto DECIMAL(12,2)[];
  v_tasas_iva DECIMAL(5,2)[];
  v_nuevos_costos DECIMAL(12,2)[];
  v_i INT;
  v_n INT;
  v_producto productos;
  v_stock INT;
  v_cant INT;
  v_costo_unit_neto DECIMAL(12,2);
  v_subtotal_neto DECIMAL(12,2);
  v_subtotal_iva DECIMAL(12,2);
  v_subtotal_total DECIMAL(12,2);
  v_costo_unit_ppp DECIMAL(12,2);
  v_nuevo_costo DECIMAL(12,2);
  v_monto_neto DECIMAL(12,2) := 0;
  v_monto_iva DECIMAL(12,2) := 0;
  v_monto_total DECIMAL(12,2) := 0;
  v_monto_gasto DECIMAL(12,2);
  v_obs_gasto TEXT;
  v_monto_resto DECIMAL(12,2);
  v_cuota_base DECIMAL(12,2);
  v_cuota_actual DECIMAL(12,2);
  v_pagar_anticipo BOOLEAN := FALSE;
  v_pagar_unica BOOLEAN := FALSE;
  v_turno_caja_efectivo BIGINT := NULL;
  v_cuota_fecha_pago DATE;
  v_cuota_medio_pago VARCHAR;
  v_cuota_turno_caja BIGINT;
  v_cuenta_id BIGINT;                                      -- ⭐ NUEVO 0058
  v_es_caja BOOLEAN;                                       -- ⭐ NUEVO 0058
  v_cuota_cuenta_id BIGINT;                                -- ⭐ NUEVO 0058
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede recibir órdenes de compra.';
  END IF;

  -- ── Verificar OC + estado ──────────────────────────────────────────
  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La OC no existe o no pertenece a tu club.';
  END IF;
  IF v_compra.estado <> 'pedida' THEN
    RAISE EXCEPTION 'Solo se pueden recibir OCs en estado "pedida". Esta OC está %.', v_compra.estado;
  END IF;

  -- ── Validaciones básicas ───────────────────────────────────────────
  IF p_fecha_recepcion IS NULL THEN
    RAISE EXCEPTION 'La fecha de recepción es obligatoria.';
  END IF;
  IF p_items_recepcion IS NULL OR jsonb_array_length(p_items_recepcion) = 0 THEN
    RAISE EXCEPTION 'La recepción tiene que tener al menos un item. Si la OC no se concretó, cancelala.';
  END IF;

  -- Pago atómico (igual que fn_registrar_gasto).
  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si pagás al recibir, indicá fecha de pago Y medio. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;
  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ── Validaciones del plan de cuotas (0045). ───────────────────────
  IF p_anticipo IS NULL OR p_anticipo < 0 THEN
    RAISE EXCEPTION 'El anticipo no puede ser negativo (recibido: %).', p_anticipo;
  END IF;
  IF p_cantidad_cuotas IS NULL OR p_cantidad_cuotas < 1 THEN
    RAISE EXCEPTION 'La cantidad de cuotas debe ser >= 1 (recibido: %).', p_cantidad_cuotas;
  END IF;
  IF p_fechas_vencimiento IS NULL
     OR COALESCE(array_length(p_fechas_vencimiento, 1), 0) <> p_cantidad_cuotas THEN
    RAISE EXCEPTION
      'Necesitás exactamente % fecha(s) de vencimiento, una por cuota. Recibido: %.',
      p_cantidad_cuotas,
      COALESCE(array_length(p_fechas_vencimiento, 1), 0);
  END IF;
  FOR v_i IN 1..p_cantidad_cuotas - 1 LOOP
    IF p_fechas_vencimiento[v_i] >= p_fechas_vencimiento[v_i + 1] THEN
      RAISE EXCEPTION
        'Las fechas de vencimiento deben estar en orden ascendente. Fecha % (%) no es anterior a fecha % (%).',
        v_i, p_fechas_vencimiento[v_i],
        v_i + 1, p_fechas_vencimiento[v_i + 1];
    END IF;
  END LOOP;

  -- ── Snapshot de la condición fiscal del club ──────────────────────
  SELECT condicion_fiscal INTO v_condicion_fiscal FROM clubes WHERE id = v_club_id;
  IF v_condicion_fiscal IS NULL THEN
    RAISE EXCEPTION 'El club no tiene configurada la condición fiscal. Andá a Configuración → Marca.';
  END IF;

  -- ── Proveedor ─────────────────────────────────────────────────────
  SELECT * INTO v_proveedor FROM proveedores WHERE id = v_compra.proveedor_id;
  IF NOT v_proveedor.activo THEN
    RAISE EXCEPTION
      'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de recibir.',
      v_proveedor.nombre;
  END IF;

  -- ── Categoría de mercadería ───────────────────────────────────────
  SELECT cg.* INTO v_categoria
  FROM categorias_gasto cg
  JOIN unidades_negocio u ON u.id = cg.unidad_id
  WHERE cg.club_id = v_club_id AND u.tipo = v_compra.linea
    AND cg.es_mercaderia = TRUE AND cg.activa = TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Tu club no tiene una categoría marcada como mercadería para la unidad de %. Andá a Configuración → Categorías de gasto y marcá una.',
      v_compra.linea;
  END IF;

  -- ── Detectar duplicados en items_recepcion ─────────────────────────
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items_recepcion) x
    GROUP BY (x->>'producto_id')::BIGINT HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la recepción. Consolidá cada producto en una sola línea.';
  END IF;

  -- ── Extraer arrays ordenados ASC por producto_id (lock order) ──────
  SELECT
    array_agg((x->>'producto_id')::BIGINT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad_bultos')::INT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'unidades_por_bulto')::INT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'costo_por_bulto')::DECIMAL(12,2) ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'tasa_iva')::DECIMAL(5,2) ORDER BY (x->>'producto_id')::BIGINT)
  INTO v_pids, v_bultos, v_und_por_bulto, v_costos_por_bulto, v_tasas_iva
  FROM jsonb_array_elements(p_items_recepcion) x;

  v_n := array_length(v_pids, 1);

  -- ── Validar items ──────────────────────────────────────────────────
  FOR v_i IN 1..v_n LOOP
    IF v_bultos[v_i] IS NULL OR v_bultos[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad de bultos debe ser mayor a 0 (item %).', v_i;
    END IF;
    IF v_und_por_bulto[v_i] IS NULL OR v_und_por_bulto[v_i] <= 0 THEN
      RAISE EXCEPTION 'Las unidades por bulto deben ser mayor a 0 (item %).', v_i;
    END IF;
    IF v_costos_por_bulto[v_i] IS NULL OR v_costos_por_bulto[v_i] < 0 THEN
      RAISE EXCEPTION 'El costo por bulto debe ser >= 0 (item %).', v_i;
    END IF;
    IF v_tasas_iva[v_i] IS NULL OR v_tasas_iva[v_i] < 0 OR v_tasas_iva[v_i] > 100 THEN
      RAISE EXCEPTION 'La tasa de IVA debe estar entre 0 y 100 (item %). Si no corresponde IVA, pasá 0.', v_i;
    END IF;
  END LOOP;

  -- ── Lock exclusivo sobre productos en orden ASC ───────────────────
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- ── Validar productos + calcular PPP por item (sin escribir) ──────
  v_nuevos_costos := ARRAY[]::DECIMAL(12,2)[];
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos WHERE id = v_pids[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto % no existe o no pertenece a tu club.', v_pids[v_i];
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede recibir.', v_producto.nombre;
    END IF;
    IF v_producto.linea <> v_compra.linea THEN
      RAISE EXCEPTION
        'El producto "%" es de la línea %, no coincide con la línea de la OC (%).',
        v_producto.nombre, v_producto.linea, v_compra.linea;
    END IF;

    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit_neto := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);
    v_subtotal_neto := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];
    v_subtotal_iva := ROUND(v_subtotal_neto * v_tasas_iva[v_i] / 100, 2);
    v_subtotal_total := v_subtotal_neto + v_subtotal_iva;

    IF v_condicion_fiscal = 'responsable_inscripto' THEN
      v_costo_unit_ppp := v_costo_unit_neto;
    ELSE
      v_costo_unit_ppp := ROUND(
        (v_costos_por_bulto[v_i] * (1 + v_tasas_iva[v_i] / 100))
        / v_und_por_bulto[v_i]::DECIMAL,
      2);
    END IF;

    SELECT GREATEST(0, COALESCE(SUM(cantidad), 0))::INT INTO v_stock
    FROM movimientos_stock WHERE producto_id = v_producto.id;

    IF v_stock <= 0 OR v_producto.costo IS NULL THEN
      v_nuevo_costo := v_costo_unit_ppp;
    ELSE
      v_nuevo_costo := ROUND(
        (v_stock::DECIMAL * v_producto.costo + v_cant::DECIMAL * v_costo_unit_ppp)
        / (v_stock::DECIMAL + v_cant::DECIMAL),
      2);
    END IF;

    v_nuevos_costos := v_nuevos_costos || v_nuevo_costo;

    v_monto_neto := v_monto_neto + v_subtotal_neto;
    v_monto_iva := v_monto_iva + v_subtotal_iva;
    v_monto_total := v_monto_total + v_subtotal_total;
  END LOOP;

  -- ── Monto del GASTO según condición fiscal (0043) ──────────────────
  IF v_condicion_fiscal = 'responsable_inscripto' THEN
    v_monto_gasto := v_monto_neto;
  ELSE
    v_monto_gasto := v_monto_total;
  END IF;

  -- ── Validación anticipo contra monto del gasto (0045) ─────────────
  IF p_anticipo >= v_monto_gasto THEN
    RAISE EXCEPTION
      'El anticipo (%) no puede ser igual ni mayor al monto del gasto (%). Para pagar todo al instante usá 1 sola cuota sin anticipo.',
      p_anticipo, v_monto_gasto;
  END IF;

  -- ── Resolver qué cuota se paga al recibir (0045) ──────────────────
  IF p_fecha_pago IS NOT NULL THEN
    IF p_anticipo > 0 THEN
      v_pagar_anticipo := TRUE;
    ELSIF p_cantidad_cuotas = 1 THEN
      v_pagar_unica := TRUE;
    ELSE
      RAISE EXCEPTION
        'No se puede pagar al recibir en un plan multi-cuota sin anticipo. Indicá un anticipo > 0 o reducí a una sola cuota.';
    END IF;

    -- ⭐ NUEVO 0058 — Resolver cuenta del pago al recibir + regla de oro
    -- generalizada. Para efectivo es IDÉNTICO al bloque de efectivo de 0045
    -- (mismo RAISE/turno_caja). La cuenta se aplica a la cuota que se paga.
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM medio_cuenta_default mcd
      JOIN cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;
    v_es_caja := COALESCE(v_es_caja, FALSE);

    IF v_es_caja THEN
      v_turno_caja_efectivo := current_club_caja_abierta();
      IF v_turno_caja_efectivo IS NULL THEN
        RAISE EXCEPTION
          'No hay caja abierta. Pedile a la administración que abra la caja del día antes de pagar en efectivo.';
      END IF;
    END IF;
  END IF;

  -- ── DELETE compra_items vigentes ──────────────────────────────────
  DELETE FROM compra_items WHERE compra_id = p_compra_id;

  -- ── Crear el gasto (SIEMPRE pendiente — el pago va por cuotas). ────
  -- No pasamos p_cuenta_id: el gasto nace pendiente → gastos.cuenta_id NULL
  -- (la cuenta del pago vive en la cuota que se paga, abajo).
  v_obs_gasto := 'Compra a ' || v_proveedor.nombre || ' del ' || p_fecha_recepcion::TEXT;
  IF p_comprobante_tipo IS NOT NULL OR p_comprobante_numero IS NOT NULL THEN
    v_obs_gasto := v_obs_gasto || ' ('
      || COALESCE(p_comprobante_tipo, '') || ' '
      || COALESCE(p_comprobante_numero, '') || ')';
  END IF;

  SELECT * INTO v_gasto FROM fn_registrar_gasto(
    p_categoria_id := v_categoria.id,
    p_monto := v_monto_gasto,
    p_fecha_gasto := p_fecha_recepcion,
    p_proveedor := NULL,
    p_observaciones := v_obs_gasto,
    p_fecha_pago := NULL,
    p_medio_pago := NULL,
    p_proveedor_id := v_proveedor.id,
    p_fecha_vencimiento := NULL,
    p_skip_cuota_automatica := TRUE
  );

  -- ── Generar el plan de cuotas (0045). ─────────────────────────────
  v_monto_resto := v_monto_gasto - p_anticipo;

  -- Cuota 0 — anticipo (si > 0).
  IF p_anticipo > 0 THEN
    IF v_pagar_anticipo THEN
      v_cuota_fecha_pago := p_fecha_pago;
      v_cuota_medio_pago := p_medio_pago;
      v_cuota_turno_caja := v_turno_caja_efectivo;
      v_cuota_cuenta_id  := v_cuenta_id;                   -- ⭐ NUEVO 0058
    ELSE
      v_cuota_fecha_pago := NULL;
      v_cuota_medio_pago := NULL;
      v_cuota_turno_caja := NULL;
      v_cuota_cuenta_id  := NULL;                          -- ⭐ NUEVO 0058
    END IF;

    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id, cuenta_id                                -- ⭐ NUEVO 0058
    ) VALUES (
      v_club_id, v_gasto.id, 0, TRUE, p_anticipo,
      p_fecha_recepcion, v_cuota_fecha_pago, v_cuota_medio_pago, v_cuota_turno_caja,
      v_usuario_id, v_cuota_cuenta_id                      -- ⭐ NUEVO 0058
    );
  END IF;

  -- Cuotas 1..N regulares (última absorbe el residuo).
  v_cuota_base := ROUND(v_monto_resto / p_cantidad_cuotas::DECIMAL, 2);
  FOR v_i IN 1..p_cantidad_cuotas LOOP
    IF v_i = p_cantidad_cuotas THEN
      v_cuota_actual := v_monto_resto - (v_cuota_base * (p_cantidad_cuotas - 1));
    ELSE
      v_cuota_actual := v_cuota_base;
    END IF;

    IF v_pagar_unica AND v_i = 1 THEN
      v_cuota_fecha_pago := p_fecha_pago;
      v_cuota_medio_pago := p_medio_pago;
      v_cuota_turno_caja := v_turno_caja_efectivo;
      v_cuota_cuenta_id  := v_cuenta_id;                   -- ⭐ NUEVO 0058
    ELSE
      v_cuota_fecha_pago := NULL;
      v_cuota_medio_pago := NULL;
      v_cuota_turno_caja := NULL;
      v_cuota_cuenta_id  := NULL;                          -- ⭐ NUEVO 0058
    END IF;

    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id, cuenta_id                                -- ⭐ NUEVO 0058
    ) VALUES (
      v_club_id, v_gasto.id, v_i, FALSE, v_cuota_actual,
      p_fechas_vencimiento[v_i], v_cuota_fecha_pago, v_cuota_medio_pago, v_cuota_turno_caja,
      v_usuario_id, v_cuota_cuenta_id                      -- ⭐ NUEVO 0058
    );
  END LOOP;

  -- ── INSERT compra_items + movimientos + UPDATE productos.costo. ───
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit_neto := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);
    v_subtotal_neto := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];
    v_subtotal_iva := ROUND(v_subtotal_neto * v_tasas_iva[v_i] / 100, 2);
    v_subtotal_total := v_subtotal_neto + v_subtotal_iva;

    IF v_condicion_fiscal = 'responsable_inscripto' THEN
      v_costo_unit_ppp := v_costo_unit_neto;
    ELSE
      v_costo_unit_ppp := ROUND(
        (v_costos_por_bulto[v_i] * (1 + v_tasas_iva[v_i] / 100))
        / v_und_por_bulto[v_i]::DECIMAL,
      2);
    END IF;

    INSERT INTO compra_items (
      club_id, compra_id, producto_id, producto_nombre,
      cantidad, costo_unitario_compra, subtotal, linea,
      cantidad_bultos, unidades_por_bulto, costo_por_bulto,
      tasa_iva, subtotal_iva, subtotal_total, costo_unitario_ppp
    ) VALUES (
      v_club_id, p_compra_id, v_producto.id, v_producto.nombre,
      v_cant, v_costo_unit_neto, v_subtotal_neto, v_producto.linea,
      v_bultos[v_i], v_und_por_bulto[v_i], v_costos_por_bulto[v_i],
      v_tasas_iva[v_i], v_subtotal_iva, v_subtotal_total, v_costo_unit_ppp
    );

    INSERT INTO movimientos_stock (
      club_id, producto_id, cantidad, fuente,
      venta_id, reserva_consumo_id, compra_id,
      observaciones, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, v_cant, 'compra_manual',
      NULL, NULL, p_compra_id,
      'Recepción de OC #' || p_compra_id::TEXT,
      v_usuario_id
    );

    UPDATE productos SET costo = v_nuevos_costos[v_i] WHERE id = v_producto.id;
  END LOOP;

  -- ── UPDATE cabecera compras: 'recibida' + datos. ──────────────────
  UPDATE compras
  SET estado = 'recibida',
      fecha_recepcion = p_fecha_recepcion,
      gasto_id = v_gasto.id,
      monto_neto = v_monto_neto,
      monto_iva = v_monto_iva,
      monto_total = v_monto_total,
      condicion_fiscal_club = v_condicion_fiscal,
      comprobante_tipo = p_comprobante_tipo,
      comprobante_numero = p_comprobante_numero
  WHERE id = p_compra_id;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id;
  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION fn_recibir_oc(
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR, DECIMAL, INT, DATE[], BIGINT
) IS
  'Recibe una OC (estado=pedida): plan de cuotas (anticipo + N), gasto SIEMPRE
   pendiente (gastos.cuenta_id NULL), PPP/IVA según fiscal, stock. 0058:
   +p_cuenta_id; la cuota que se paga al recibir (anticipo o única) escribe
   cuenta_id, las futuras nacen NULL (la setea fn_pagar_cuota). Regla de oro
   generalizada a es_caja_fisica (idéntica para efectivo). Gate: admin only.';

GRANT EXECUTE ON FUNCTION fn_recibir_oc(
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR, DECIMAL, INT, DATE[], BIGINT
) TO authenticated;


-- ============================================================================
-- GRUPO 3 — RPC 4/4: fn_anular_pago_cuota (vigente en 0048; SIN cambio de firma)
--
-- Cambios respecto de 0048:
--   ⭐ El UPDATE que revierte la cuota a pendiente ahora resuelve cuenta_id:
--      cuenta_id = NULL cuando NO se generó ajuste (v_mov_id IS NULL) →
--                  Casos 1 (no-efectivo) y 2 (efectivo, caja abierta): el
--                  egreso original sale del libro mayor (saldo restituido).
--      cuenta_id se MANTIENE cuando SÍ se generó ajuste (v_mov_id IS NOT NULL)
--                  → Caso 3 (efectivo, caja cerrada): el egreso original
--                  (−monto, firme en la caja cerrada) queda en el libro mayor
--                  y el ajuste_positivo (+monto, rama caja_manual) lo compensa
--                  → neto 0. Nulearlo daría +2×monto (doble conteo).
-- NO cambia la firma → CREATE OR REPLACE (sin DROP, conserva grants). Resto
-- IDÉNTICO a 0048 (matriz de caja, gate, rastro en anulaciones, atomicidad).
-- Los otros 3 campos (fecha_pago/medio_pago/turno_caja_id) siguen yendo a NULL
-- (lo exige el CHECK cuota_pago_atomico). Nota: en el Caso 3 la cuota queda con
-- cuenta_id set pero fecha_pago NULL — es intencional (asienta el egreso firme).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_anular_pago_cuota(
  p_cuota_id BIGINT,
  p_motivo_tipo VARCHAR,
  p_motivo_detalle TEXT DEFAULT NULL
)
RETURNS anulaciones
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_rol VARCHAR;
  v_cuota gasto_cuotas;
  v_motivo_detalle TEXT;
  v_es_efectivo BOOLEAN;
  v_caja_cerrada_en TIMESTAMPTZ;
  v_caja_original_cerrada BOOLEAN;
  v_caja_hoy BIGINT;
  v_mov_id BIGINT := NULL;
  v_concepto VARCHAR;
  v_anulacion anulaciones;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  v_rol := current_user_rol();
  IF v_rol NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para anular pagos.';
  END IF;

  IF p_motivo_tipo IS NULL OR p_motivo_tipo NOT IN (
    'error_monto','error_carga_duplicado','error_medio_pago','devolucion_proveedor','otro'
  ) THEN
    RAISE EXCEPTION 'Motivo de anulación inválido.';
  END IF;

  v_motivo_detalle := NULLIF(TRIM(COALESCE(p_motivo_detalle, '')), '');
  IF p_motivo_tipo = 'otro' AND v_motivo_detalle IS NULL THEN
    RAISE EXCEPTION 'Si el motivo es "otro", contá brevemente qué pasó en el detalle.';
  END IF;

  -- ── Lock + validación de la cuota ─────────────────────────────────
  SELECT * INTO v_cuota
  FROM gasto_cuotas
  WHERE id = p_cuota_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuota no existe o no pertenece a tu club.';
  END IF;
  IF v_cuota.fecha_pago IS NULL THEN
    RAISE EXCEPTION 'Esta cuota no está pagada — no hay pago para anular.';
  END IF;

  -- ── Determinar el escenario de caja ───────────────────────────────
  v_es_efectivo := (v_cuota.medio_pago = 'efectivo');

  IF v_es_efectivo THEN
    SELECT cerrada_en INTO v_caja_cerrada_en
    FROM turnos_caja
    WHERE id = v_cuota.turno_caja_id AND club_id = v_club_id;
    v_caja_original_cerrada := (v_caja_cerrada_en IS NOT NULL);
  ELSE
    v_caja_original_cerrada := NULL;
  END IF;

  -- ── Gate fino del Caso 3 (efectivo + caja cerrada → ajuste) ───────
  IF v_es_efectivo AND v_caja_original_cerrada AND v_rol <> 'admin' THEN
    RAISE EXCEPTION
      'Anular un pago en efectivo de una caja ya cerrada requiere administrador (genera un ajuste en la caja de hoy).';
  END IF;

  -- ── CASO 3: ajuste_positivo en la caja de HOY ─────────────────────
  IF v_es_efectivo AND v_caja_original_cerrada THEN
    v_caja_hoy := current_club_caja_abierta();
    IF v_caja_hoy IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta para registrar el ajuste de esta anulación. Abrí la caja del día e intentá de nuevo.';
    END IF;

    v_concepto := 'Anulación pago cuota #' || v_cuota.numero
                || ' gasto #' || v_cuota.gasto_id
                || ' (pago del ' || v_cuota.fecha_pago::TEXT || ')';

    INSERT INTO caja_movimientos_manuales (
      club_id, turno_caja_id, tipo, monto, concepto, observaciones, usuario_id
    ) VALUES (
      v_club_id, v_caja_hoy, 'ajuste_positivo', v_cuota.monto, v_concepto,
      v_motivo_detalle, v_usuario_id
    )
    RETURNING id INTO v_mov_id;
  END IF;
  -- Casos 1 (no-efectivo) y 2 (efectivo + caja abierta): no se toca caja.

  -- ── Revertir la cuota a PENDIENTE ─────────────────────────────────
  -- Los 3 campos de pago a NULL (CHECK cuota_pago_atomico).
  -- ⭐ NUEVO 0058 — cuenta_id: NULL si NO hubo ajuste (Casos 1/2 → el egreso
  -- sale del libro mayor, saldo restituido); se MANTIENE si hubo ajuste
  -- (Caso 3 → el egreso firme queda y el ajuste_positivo lo compensa, neto 0;
  -- nulearlo duplicaría el +monto). El gasto madre NO se toca → EERR intacto.
  UPDATE gasto_cuotas
  SET fecha_pago = NULL,
      medio_pago = NULL,
      turno_caja_id = NULL,
      cuenta_id = CASE WHEN v_mov_id IS NULL THEN NULL ELSE cuenta_id END
  WHERE id = p_cuota_id;

  -- ── Rastro (snapshot del pago original, tomado ANTES del nulleo). ──
  INSERT INTO anulaciones (
    club_id, entidad_tipo, gasto_id, gasto_cuota_id,
    motivo_tipo, motivo_detalle,
    monto, fecha_original, medio_pago_original,
    caja_original_id, caja_original_cerrada, caja_movimiento_id,
    usuario_id
  ) VALUES (
    v_club_id, 'pago_cuota', NULL, p_cuota_id,
    p_motivo_tipo, v_motivo_detalle,
    v_cuota.monto, v_cuota.fecha_pago, v_cuota.medio_pago,
    v_cuota.turno_caja_id, v_caja_original_cerrada, v_mov_id,
    v_usuario_id
  )
  RETURNING * INTO v_anulacion;

  RETURN v_anulacion;
END;
$$;

COMMENT ON FUNCTION fn_anular_pago_cuota(BIGINT, VARCHAR, TEXT) IS
  'Anula el pago de una cuota (vuelve a pendiente) sin tocar el gasto madre
   (EERR intacto). Nullea los 3 campos de pago (CHECK cuota_pago_atomico).
   0058: cuenta_id se nulea cuando NO hubo ajuste (Casos 1/2: el egreso sale
   del libro mayor) y se MANTIENE cuando hubo ajuste (Caso 3: el egreso firme
   queda y el ajuste_positivo lo compensa, evitando el doble conteo). Caja
   Filosofía B (idem 0048): nada si no-efectivo o caja abierta; ajuste_positivo
   hoy si efectivo + caja cerrada (requiere caja abierta). Gate: admin O
   vendedor; admin only cuando genera ajuste. Atómica.';

GRANT EXECUTE ON FUNCTION fn_anular_pago_cuota(BIGINT, VARCHAR, TEXT) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0058_tesoreria_rpcs_cuenta_id.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Pre-requisito para los tests de efectivo: caja abierta (SELECT fn_abrir_caja(0)).
--
-- ---------- A. Firmas nuevas (las 9 con +p_cuenta_id) ----------
-- SELECT proname, pg_get_function_arguments(oid) FROM pg_proc
-- WHERE proname IN ('fn_crear_reserva','fn_cobrar_reserva','fn_cobrar_persona_turno',
--   'fn_cobrar_clase','fn_cerrar_venta','fn_registrar_otro_ingreso',
--   'fn_registrar_gasto','fn_pagar_cuota','fn_recibir_oc')
-- ORDER BY proname;
-- → cada una termina en p_cuenta_id bigint. fn_anular_pago_cuota SIN cambio de firma.
--
-- ---------- B. Behavior-preserving efectivo (caller omite p_cuenta_id) ----------
-- Cobrar/pagar en efectivo SIN caja → RAISE 'No hay caja abierta...' (idéntico).
-- Con caja abierta → la fila escribe turno_caja_id (como antes) Y cuenta_id =
-- cuenta Efectivo (medio_cuenta_default['efectivo']).
--   SELECT id, medio_pago, turno_caja_id, cuenta_id FROM gastos ORDER BY id DESC LIMIT 1;
--
-- ---------- C. Gasto pagado directo vs en cuotas (coherencia 0057) ----------
-- Gasto pagado directo (p_fecha_pago + p_medio_pago) → gastos.cuenta_id seteado,
--   sin cuota.
-- Gasto pendiente → gastos.cuenta_id NULL + 1 cuota con cuenta_id NULL.
--   Al pagar la cuota (fn_pagar_cuota), la cuota recibe cuenta_id; gastos.cuenta_id
--   sigue NULL (sin doble conteo en v_movimientos_cuenta).
--
-- ---------- D. fn_recibir_oc — anticipo pagado ----------
-- Recibir OC con p_anticipo>0 + p_fecha_pago + p_medio_pago='efectivo':
--   SELECT numero, es_anticipo, fecha_pago, medio_pago, cuenta_id FROM gasto_cuotas
--   WHERE gasto_id = <gasto de la OC> ORDER BY numero;
-- → cuota 0 (anticipo): pagada, cuenta_id = Efectivo. Cuotas 1..N: cuenta_id NULL.
-- → gastos.cuenta_id del gasto madre: NULL.
--
-- ---------- E. fn_anular_pago_cuota — Caso 2 (efectivo, caja abierta) ----------
-- Pagar cuota efectivo (caja abierta), anular sin cerrar:
-- → cuota: fecha_pago/medio_pago/turno_caja_id/cuenta_id = NULL (sin ajuste,
--   v_mov_id NULL). El egreso sale del libro mayor → saldo de Efectivo restituido.
--
-- ---------- F. fn_anular_pago_cuota — Caso 3 (efectivo, caja cerrada) ----------
-- Pagar cuota efectivo, CERRAR caja, abrir otra, anular:
-- → caja_movimientos_manuales: ajuste_positivo (+monto) en la caja de hoy.
-- → cuota: fecha_pago/medio_pago/turno_caja_id = NULL pero cuenta_id SE MANTIENE.
-- → En v_movimientos_cuenta: el egreso original (−monto) sigue + ajuste (+monto)
--   = neto 0 sobre la cuenta Efectivo (sin doble conteo). diferencia de cierre = 0.
--
-- ---------- G. NADA roto en vivo ----------
-- Todos los flujos actuales (frontend que NO pasa p_cuenta_id) siguen igual:
-- reservar, cobrar turno, vender, cobrar clase, registrar gasto/ingreso, CxP.
-- ============================================================================
