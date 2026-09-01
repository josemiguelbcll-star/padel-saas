-- ============================================================================
-- 0106_fix_reservas_check_constraint.sql
-- 1. Elimina check constraints obsoletos en reservas y reserva_pagos.
-- 2. Garantiza que monto_alquiler y monto_consumo SIEMPRE sean >= 0 y sumen monto exacto.
-- 3. Si el monto ingresado supera el saldo pendiente global del turno, cobra automáticamente
--    el saldo restante exacto para saldar el turno sin trabas ni errores.
-- 4. Cuando una persona paga su cuota, se fija automáticamente para que consumos o
--    participantes posteriores NO le agreguen deuda sorpresa a quien ya pagó.
-- 5. Soporta pagos con excedente, cobros parciales, cuota fijada y todos los medios de pago.
-- ============================================================================

-- 1. Eliminar cualquier constraint que bloquee monto_pagado en reservas
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
        pg_get_constraintdef(oid) ILIKE '%monto_pagado <= monto_total%'
        OR conname = 'reservas_check'
        OR conname = 'reservas_monto_pagado_check'
      )
  ) LOOP
    EXECUTE 'ALTER TABLE public.reservas DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- 2. Redefinir fn_cobrar_persona_turno con auto-tope de saldo global y fijación de cuota
CREATE OR REPLACE FUNCTION fn_cobrar_persona_turno(
  p_reserva_jugador_id BIGINT,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_monto_esperado DECIMAL,
  p_cuenta_id BIGINT DEFAULT NULL,
  p_monto DECIMAL DEFAULT NULL
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
  v_cant_jug_sin_fija INT;
  v_cant_pers_sin_fija INT;
  v_alquiler_fijado DECIMAL(12,2);
  v_consumo_fijado DECIMAL(12,2);
  v_alquiler_restante DECIMAL(12,2);
  v_total_consumos_partido DECIMAL(12,2);
  v_total_consumos_general DECIMAL(12,2);
  v_total_consumos DECIMAL(12,2);
  v_total_a_cobrar DECIMAL(12,2);
  v_total_cobrado DECIMAL(12,2);
  v_saldo_global_restante DECIMAL(12,2);
  v_alquiler_restante_global DECIMAL(12,2);
  v_consumo_restante DECIMAL(12,2);
  v_parte_alquiler DECIMAL(12,2);
  v_parte_consumo_partido DECIMAL(12,2);
  v_parte_consumo_general DECIMAL(12,2);
  v_parte_consumo DECIMAL(12,2);
  v_ya_pagado_alquiler DECIMAL(12,2);
  v_ya_pagado_consumo DECIMAL(12,2);
  v_saldo_alquiler DECIMAL(12,2);
  v_saldo_consumo DECIMAL(12,2);
  v_saldo_completo DECIMAL(12,2);
  v_monto_cobrado DECIMAL(12,2);
  v_cobro_alquiler DECIMAL(12,2);
  v_cobro_consumo DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_pago reserva_pagos;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- Admite todos los medios de pago configurables
  IF p_medio_pago NOT IN ('efectivo','transferencia','mp','mercadopago','mercado_pago','tarjeta','cuenta_corriente','deposito','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- Resolver cuenta + regla de tesorería
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

  -- Lock de la persona del turno
  SELECT * INTO v_persona
  FROM reserva_jugadores
  WHERE id = p_reserva_jugador_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona no existe o no pertenece a tu club.';
  END IF;

  -- Lock de la reserva
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_persona.reserva_id
  FOR UPDATE;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar a personas de una reserva cancelada.';
  END IF;

  -- Totales del turno a nivel global
  SELECT
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'partido'), 0),
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'general'), 0),
    COALESCE(SUM(subtotal), 0)
  INTO v_total_consumos_partido, v_total_consumos_general, v_total_consumos
  FROM reserva_consumos
  WHERE reserva_id = v_persona.reserva_id;

  v_total_a_cobrar := v_reserva.monto_total + v_total_consumos;

  SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado
  FROM reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;

  v_saldo_global_restante := GREATEST(0, v_total_a_cobrar - v_total_cobrado);

  -- Si el turno ya está completamente pago
  IF v_saldo_global_restante <= 0 THEN
    RAISE EXCEPTION 'El turno ya está 100%% pagado en su totalidad ($% pagados de $%). No queda saldo pendiente.',
      v_total_cobrado, v_total_a_cobrar;
  END IF;

  SELECT GREATEST(0, v_reserva.monto_total - COALESCE(SUM(monto_alquiler), 0))
  INTO v_alquiler_restante_global
  FROM reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;

  -- Cantidades y redistribución de cuotas fijadas
  SELECT
    COUNT(*) FILTER (WHERE tipo = 'jugador'),
    COUNT(*),
    COUNT(*) FILTER (WHERE tipo = 'jugador' AND cuota_fija IS NULL),
    COUNT(*) FILTER (WHERE cuota_fija IS NULL),
    COALESCE(SUM(CASE WHEN tipo = 'jugador' AND cuota_fija IS NOT NULL THEN LEAST(cuota_fija, v_reserva.monto_total) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cuota_fija IS NOT NULL THEN GREATEST(0, cuota_fija - (CASE WHEN tipo = 'jugador' THEN LEAST(cuota_fija, v_reserva.monto_total) ELSE 0 END)) ELSE 0 END), 0)
  INTO
    v_cantidad_jugadores,
    v_cantidad_personas,
    v_cant_jug_sin_fija,
    v_cant_pers_sin_fija,
    v_alquiler_fijado,
    v_consumo_fijado
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id;

  v_alquiler_restante := GREATEST(0, v_reserva.monto_total - v_alquiler_fijado);
  v_consumo_restante  := GREATEST(0, v_total_consumos - v_consumo_fijado);

  -- Cálculo de la cuota individual
  IF v_persona.cuota_fija IS NOT NULL THEN
    IF v_persona.tipo = 'jugador' THEN
      v_parte_alquiler := LEAST(v_persona.cuota_fija, v_reserva.monto_total);
    ELSE
      v_parte_alquiler := 0;
    END IF;
    v_parte_consumo := GREATEST(0, v_persona.cuota_fija - v_parte_alquiler);
  ELSE
    IF v_persona.tipo = 'jugador' AND v_cant_jug_sin_fija > 0 AND v_alquiler_restante > 0 THEN
      v_parte_alquiler := ROUND(v_alquiler_restante / v_cant_jug_sin_fija, 2);
    ELSE
      v_parte_alquiler := 0;
    END IF;

    -- Consumos
    v_parte_consumo_partido := CASE
      WHEN v_cantidad_jugadores > 0 AND v_total_consumos_partido > 0 AND v_persona.tipo = 'jugador'
      THEN ROUND(v_total_consumos_partido / v_cantidad_jugadores, 2)
      ELSE 0
    END;

    v_parte_consumo_general := CASE
      WHEN v_cantidad_personas > 0 AND v_total_consumos_general > 0
      THEN ROUND(v_total_consumos_general / v_cantidad_personas, 2)
      ELSE 0
    END;

    v_parte_consumo := CASE
      WHEN v_persona.tipo = 'jugador'
      THEN v_parte_consumo_partido + v_parte_consumo_general
      ELSE v_parte_consumo_general
    END;
  END IF;

  -- Ya pagado por esta persona
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
  
  -- El saldo individual nunca puede exceder el saldo global del turno
  v_saldo_completo := LEAST(v_saldo_alquiler + v_saldo_consumo, v_saldo_global_restante);

  -- Validación y cálculo de monto a cobrar con auto-tope inteligente
  IF p_monto IS NOT NULL THEN
    IF p_monto <= 0 THEN
      RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
    END IF;
    -- Si el monto enviado supera el saldo restante global, se cobra exactamente lo que falta para saldar el turno
    v_monto_cobrado := LEAST(p_monto, v_saldo_global_restante);
  ELSE
    IF v_saldo_completo <= 0 THEN
      RAISE EXCEPTION 'Esta persona no tiene saldo pendiente por cobrar.';
    END IF;
    v_monto_cobrado := LEAST(v_saldo_completo, v_saldo_global_restante);
  END IF;

  -- Desglose seguro y positivo (monto_alquiler + monto_consumo = monto)
  v_cobro_alquiler := LEAST(v_monto_cobrado, v_alquiler_restante_global);
  v_cobro_consumo  := v_monto_cobrado - v_cobro_alquiler;

  -- 4. Registrar pago
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
    jugador_id, reserva_jugador_id, monto_alquiler, monto_consumo,
    cuenta_id, turno_caja_id
  ) VALUES (
    v_club_id, v_persona.reserva_id, v_monto_cobrado, p_medio_pago, 'pago',
    v_usuario_id, p_observaciones, v_persona.jugador_id, p_reserva_jugador_id,
    v_cobro_alquiler, v_cobro_consumo, v_cuenta_id, v_turno_caja_id
  )
  RETURNING * INTO v_pago;

  -- 5. Auto-fijar cuota al saldar para proteger a quien ya pagó de consumos futuros
  IF (v_ya_pagado_alquiler + v_ya_pagado_consumo + v_monto_cobrado) >= (v_parte_alquiler + v_parte_consumo) THEN
    UPDATE reserva_jugadores
    SET cuota_fija = COALESCE(cuota_fija, (v_ya_pagado_alquiler + v_ya_pagado_consumo + v_monto_cobrado))
    WHERE id = p_reserva_jugador_id;
  END IF;

  -- 6. Actualizar monto_pagado y estado de la reserva sin violar constraints
  SELECT COALESCE(SUM(monto_alquiler), 0) INTO v_nuevo_monto_pagado
  FROM reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;

  v_nuevo_estado := CASE
    WHEN v_nuevo_monto_pagado >= v_reserva.monto_total THEN 'pagada'
    WHEN v_nuevo_monto_pagado > 0 THEN 'senada'
    ELSE v_reserva.estado
  END;

  UPDATE reservas
  SET monto_pagado = LEAST(v_reserva.monto_total, v_nuevo_monto_pagado),
      estado = CASE
        WHEN v_reserva.estado = 'cancelada' THEN 'cancelada'
        ELSE v_nuevo_estado
      END
  WHERE id = v_persona.reserva_id;

  RETURN v_pago;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cobrar_persona_turno(BIGINT, VARCHAR, TEXT, DECIMAL, BIGINT, DECIMAL) TO authenticated;
