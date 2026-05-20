-- ============================================================================
-- 0006_fn_cobrar_reserva.sql
-- Sprint 3a — RPC para cobrar saldo de una reserva (acción del detalle)
--
-- Esta migración agrega una sola función: fn_cobrar_reserva. Es la
-- contraparte de fn_crear_reserva para la operación "cobrar el saldo
-- pendiente" desde el DetalleReservaDialog.
--
-- Por qué RPC y no inserts sueltos desde el frontend:
--   - INSERT en reserva_pagos + UPDATE en reservas tienen que ser
--     atómicos (regla CLAUDE.md nº 6). Si una falla, la otra no debe
--     aplicarse.
--   - SELECT FOR UPDATE evita doble cobranza: si dos vendedores cobran
--     simultáneamente, el segundo espera el commit del primero y
--     recalcula el saldo con la nueva realidad.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). No toca
-- fn_crear_reserva ni el trigger anti-overlap de clases.
-- ============================================================================

BEGIN;

-- ============================================================================
-- fn_cobrar_reserva
--
-- Inputs:
--   p_reserva_id      ID de la reserva sobre la que se cobra.
--   p_monto           Monto del cobro (DECIMAL, > 0).
--   p_medio_pago      Medio de pago ('efectivo'/'transferencia'/'mp'/'tarjeta'/'otro').
--   p_observaciones   Texto libre opcional para anotar algo en el pago.
--
-- Mensajes de error (todos en P0001, pasan directo al usuario vía dbErrors):
--   - 'No hay sesión activa.'
--   - 'El monto a cobrar debe ser mayor a 0.'
--   - 'El medio de pago es obligatorio.'
--   - 'La reserva no existe o no pertenece a tu club.'
--   - 'No se puede cobrar sobre una reserva cancelada.'
--   - 'Esta reserva ya está paga, no hay saldo para cobrar.'
--   - 'El cobro de $X supera el saldo pendiente de $Y. Ajustá el monto.'
--
-- Regla de tipo del pago insertado:
--   - reserva en estado 'pendiente' AND nuevo monto_pagado < total → 'sena'
--     (primer pago parcial sobre una reserva pendiente es la seña).
--   - cualquier otro caso → 'pago'.
--
-- Regla de nuevo estado:
--   - Si nuevo monto_pagado >= monto_total:
--       'jugada'  si ya era 'jugada' (no se desjuega un partido jugado).
--       'pagada'  en cualquier otro caso.
--   - Si nuevo monto_pagado < monto_total:
--       'jugada'  si ya era 'jugada' (puede tener saldo igual).
--       'senada'  en cualquier otro caso.
--
-- Concurrencia: SELECT FOR UPDATE acquiere lock exclusivo en la fila de
-- la reserva. Cualquier otra operación que toque la misma reserva
-- (cobrar, cancelar, marcar jugada, editar observaciones) espera el
-- commit. Garantiza que la suma de cobros nunca supera el total.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cobrar_reserva(
  p_reserva_id BIGINT,
  p_monto DECIMAL,
  p_medio_pago VARCHAR,
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
  v_saldo DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_monto_sena DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_tipo_pago VARCHAR(20);
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Validación temprana de inputs.
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- Lock exclusivo de la fila para evitar doble cobranza concurrente.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  -- Estados no cobrables.
  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar sobre una reserva cancelada.';
  END IF;

  -- Mensaje explícito para reserva ya paga (mejor UX que dejar que tire
  -- el CHECK monto_pagado <= monto_total con un error técnico).
  v_saldo := v_reserva.monto_total - v_reserva.monto_pagado;
  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Esta reserva ya está paga, no hay saldo para cobrar.';
  END IF;

  v_nuevo_monto_pagado := v_reserva.monto_pagado + p_monto;

  -- Validación de no-exceso del total, con saldo concreto en el mensaje
  -- para que el vendedor sepa cuánto ajustar.
  IF v_nuevo_monto_pagado > v_reserva.monto_total THEN
    RAISE EXCEPTION 'El cobro de $% supera el saldo pendiente de $%. Ajustá el monto.',
      p_monto, v_saldo;
  END IF;

  -- Tipo del pago: 'sena' sólo cuando es el primer pago sobre 'pendiente'
  -- y queda parcial. Resto es 'pago'.
  IF v_reserva.estado = 'pendiente' AND v_nuevo_monto_pagado < v_reserva.monto_total THEN
    v_tipo_pago := 'sena';
    v_nuevo_monto_sena := p_monto;
  ELSE
    v_tipo_pago := 'pago';
    v_nuevo_monto_sena := v_reserva.monto_sena;
  END IF;

  -- Nuevo estado: 'jugada' nunca se baja (turno jugado no se desjuega).
  IF v_nuevo_monto_pagado >= v_reserva.monto_total THEN
    v_nuevo_estado := CASE WHEN v_reserva.estado = 'jugada' THEN 'jugada' ELSE 'pagada' END;
  ELSE
    v_nuevo_estado := CASE WHEN v_reserva.estado = 'jugada' THEN 'jugada' ELSE 'senada' END;
  END IF;

  -- 1. Registrar el pago. RLS valida tenant; CHECKs validan monto > 0 y
  --    medio_pago/tipo en los enums permitidos.
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_reserva_id, p_monto, p_medio_pago, v_tipo_pago, p_observaciones, v_usuario_id
  );

  -- 2. Sincronizar los escalares de la reserva.
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
  'Registra un cobro: INSERT atómico en reserva_pagos + UPDATE de
   monto_pagado/monto_sena/estado en reservas. SELECT FOR UPDATE
   previene doble cobranza concurrente. Determina tipo (sena/pago) y
   nuevo estado según el contexto.';

GRANT EXECUTE ON FUNCTION fn_cobrar_reserva(
  BIGINT, DECIMAL, VARCHAR, TEXT
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0006_fn_cobrar_reserva.sql
-- ============================================================================
