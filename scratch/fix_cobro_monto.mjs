import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('fn_execute_sql', {
    query: `
      CREATE OR REPLACE FUNCTION fn_cobrar_persona_turno(
        p_reserva_jugador_id BIGINT,
        p_medio_pago VARCHAR,
        p_observaciones TEXT,
        p_monto_esperado NUMERIC,
        p_cuenta_id BIGINT DEFAULT NULL,
        p_monto NUMERIC DEFAULT NULL
      ) RETURNS reserva_pagos AS $$
      DECLARE
        v_club_id BIGINT;
        v_usuario_id UUID;
        v_persona reserva_jugadores%ROWTYPE;
        v_reserva reservas%ROWTYPE;
        v_cuenta_id BIGINT;
        v_es_caja BOOLEAN;
        v_turno_caja_id BIGINT;
        
        v_total_consumos DECIMAL := 0;
        v_global_pagado DECIMAL := 0;
        v_global_pagado_alquiler DECIMAL := 0;
        v_global_pagado_consumo DECIMAL := 0;
        v_global_restante DECIMAL := 0;
        v_global_restante_alquiler DECIMAL := 0;
        v_global_restante_consumo DECIMAL := 0;
        
        v_monto_cobrado DECIMAL;
        v_cobro_alquiler DECIMAL := 0;
        v_cobro_consumo DECIMAL := 0;
        
        v_pago reserva_pagos%ROWTYPE;
        v_nuevo_monto_pagado DECIMAL;
        v_nuevo_estado VARCHAR;
      BEGIN
        v_usuario_id := auth.uid();
        IF v_usuario_id IS NULL THEN
          RAISE EXCEPTION 'No autorizado.';
        END IF;

        v_club_id := current_club_id();
        IF v_club_id IS NULL THEN
          RAISE EXCEPTION 'No hay sesión activa.';
        END IF;

        -- Resolver cuenta destino
        IF p_cuenta_id IS NOT NULL THEN
          SELECT es_caja_fisica INTO v_es_caja
          FROM cuentas
          WHERE id = p_cuenta_id AND club_id = v_club_id AND activa = TRUE;
          IF v_es_caja IS NULL THEN
            RAISE EXCEPTION 'La cuenta seleccionada no existe, no pertenece a tu club o está inactiva.';
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
            RAISE EXCEPTION 'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
          END IF;
        END IF;

        -- Lock de la persona
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

        -- Calcular métricas globales del turno
        SELECT COALESCE(SUM(subtotal), 0)
        INTO v_total_consumos
        FROM reserva_consumos
        WHERE reserva_id = v_persona.reserva_id;
        
        SELECT 
          COALESCE(SUM(monto), 0),
          COALESCE(SUM(monto_alquiler), 0),
          COALESCE(SUM(monto_consumo), 0)
        INTO v_global_pagado, v_global_pagado_alquiler, v_global_pagado_consumo
        FROM reserva_pagos
        WHERE reserva_id = v_persona.reserva_id;
        
        v_global_restante := GREATEST(0, (v_reserva.monto_total + v_total_consumos) - v_global_pagado);
        v_global_restante_alquiler := GREATEST(0, v_reserva.monto_total - v_global_pagado_alquiler);
        v_global_restante_consumo := GREATEST(0, v_total_consumos - v_global_pagado_consumo);

        -- Si el turno ya está 100% pagado globalmente
        IF v_global_restante <= 0 THEN
          RAISE EXCEPTION 'El turno ya está completamente saldado.';
        END IF;

        -- Validar monto - SE ELIMINA LA RESTRICCIÓN DE MONTO NULL PORQUE AHORA ESTAMOS COBRANDO EL MONTO ESPERADO SI VIENE NULL
        IF p_monto IS NULL THEN
          -- Si no se envió monto parcial (p_monto), asumimos que quiere cobrar el monto esperado completo (p_monto_esperado)
          -- como funcionaba antes del nuevo esquema.
          v_monto_cobrado := p_monto_esperado;
        ELSE
          v_monto_cobrado := p_monto;
        END IF;

        IF v_monto_cobrado <= 0 THEN
          RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
        END IF;

        -- Validamos contra el saldo global (no contra el límite rígido de la persona)
        IF v_monto_cobrado > v_global_restante THEN
          RAISE EXCEPTION 'El monto a cobrar ($%) supera el saldo total pendiente del turno ($%). Ajustá el monto.', v_monto_cobrado, v_global_restante;
        END IF;

        -- Desglose en cascada (waterfall) para evitar decimales y errores de redondeo en JS.
        -- Primero se llena el alquiler. Si sobra, va a consumo.
        IF v_monto_cobrado <= v_global_restante_alquiler THEN
          v_cobro_alquiler := v_monto_cobrado;
          v_cobro_consumo := 0;
        ELSE
          v_cobro_alquiler := v_global_restante_alquiler;
          v_cobro_consumo := v_monto_cobrado - v_global_restante_alquiler;
        END IF;

        -- INSERT del pago
        INSERT INTO reserva_pagos (
          club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
          jugador_id, reserva_jugador_id, monto_alquiler, monto_consumo,
          turno_caja_id, cuenta_id
        ) VALUES (
          v_club_id, v_persona.reserva_id, v_monto_cobrado, p_medio_pago, 'pago', v_usuario_id, p_observaciones,
          v_persona.jugador_id, p_reserva_jugador_id, v_cobro_alquiler, v_cobro_consumo,
          v_turno_caja_id, v_cuenta_id
        )
        RETURNING * INTO v_pago;

        -- Actualizar reserva
        v_nuevo_monto_pagado := v_reserva.monto_pagado + v_cobro_alquiler;

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
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `
  });
  if (error) {
    console.error("Error patching function:", error);
  } else {
    console.log("Function patched successfully.");
  }
}
run();
