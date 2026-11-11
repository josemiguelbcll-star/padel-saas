-- 0154 — Proteger cobros de reserva atados a una caja ya cerrada
--
-- Problema: `fn_eliminar_pago_reserva` validaba únicamente el estado del
-- turno (`reservas.estado = 'cerrada'`), pero NO si la caja a la que entró
-- el cobro (`reserva_pagos.turno_caja_id` → `turnos_caja.cerrada_en`) ya
-- estaba cerrada. Resultado: con la caja cerrada se podían borrar cobros en
-- efectivo, dejando el turno "sin cobrar" aunque la plata ya se había
-- arquado, y sin forma de reponerla sin ensuciar una caja nueva.
--
-- Política acordada:
--   * El vendedor NO puede borrar un cobro que ya entró a una caja cerrada.
--   * Un administrador SÍ puede, pero la corrección queda auditada
--     (motivo + usuario + fecha), y si fue en efectivo se registra el ajuste
--     negativo correspondiente en la caja ABIERTA actual para no dejar plata
--     sin atribuir (mismo patrón que `fn_anular_venta`).
--
-- El resto del comportamiento (recalcular montos/estado al borrar) se
-- conserva tal cual estaba en la 0135.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Auditoría de correcciones de cobros de reserva
-- ----------------------------------------------------------------------------
CREATE TABLE public.reserva_pagos_correcciones (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id),
  -- Sin FK a reservas/reserva_pagos: el cobro se borra y la reserva podría
  -- eliminarse, pero la auditoría debe sobrevivir. Guardamos snapshots.
  reserva_id BIGINT NOT NULL,
  reserva_pago_id BIGINT NOT NULL,
  motivo TEXT NOT NULL,
  snapshot_pago JSONB NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  medio_pago VARCHAR(30) NOT NULL,
  turno_caja_id BIGINT,
  usuario_id UUID NOT NULL REFERENCES auth.users(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reserva_pagos_correcciones_club_fecha
  ON public.reserva_pagos_correcciones(club_id, fecha_hora);
CREATE INDEX idx_reserva_pagos_correcciones_reserva
  ON public.reserva_pagos_correcciones(reserva_id);

ALTER TABLE public.reserva_pagos_correcciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY reserva_pagos_correcciones_select
  ON public.reserva_pagos_correcciones FOR SELECT TO authenticated
  USING (club_id = public.current_club_id());
GRANT SELECT ON public.reserva_pagos_correcciones TO authenticated;

COMMENT ON TABLE public.reserva_pagos_correcciones IS
  'Auditoría de correcciones (borrados) de cobros de reserva que ya habían
   entrado a una caja cerrada. Solo un admin puede hacerlas; requiere motivo.';

-- ----------------------------------------------------------------------------
-- 2. RPC con guarda de caja cerrada + corrección auditada (solo admin)
--
-- Se dropea la versión de 1 arg de la 0135 para reemplazarla por esta de 2
-- args (con default) y evitar ambigüedad de overloads en PostgREST.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_eliminar_pago_reserva(BIGINT);

CREATE FUNCTION public.fn_eliminar_pago_reserva(
  p_pago_id BIGINT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago reserva_pagos;
  v_reserva reservas;
  v_rol TEXT := current_user_rol();
  v_caja_cerrada BOOLEAN := FALSE;
  v_turno_caja turnos_caja;
  v_caja_abierta BIGINT;
  v_nuevo_monto_pagado DECIMAL(12,2) := 0;
  v_nuevo_monto_sena DECIMAL(12,2) := 0;
  v_nuevo_estado VARCHAR(20);
  v_total_pagado_persona DECIMAL(12,2) := 0;
BEGIN
  IF v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar pagos de reservas.';
  END IF;

  SELECT * INTO v_pago
  FROM reserva_pagos
  WHERE id = p_pago_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no existe o no pertenece a tu club.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_pago.reserva_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva asociada al pago no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cerrada' THEN
    RAISE EXCEPTION 'No se pueden eliminar pagos de un turno que ya ha sido cerrado.';
  END IF;

  -- ¿El cobro entró a una caja que ya está cerrada?
  IF v_pago.turno_caja_id IS NOT NULL THEN
    SELECT * INTO v_turno_caja
    FROM turnos_caja
    WHERE id = v_pago.turno_caja_id;
    IF FOUND AND v_turno_caja.cerrada_en IS NOT NULL THEN
      v_caja_cerrada := TRUE;
    END IF;
  END IF;

  IF v_caja_cerrada THEN
    IF v_rol <> 'admin' THEN
      RAISE EXCEPTION 'Este cobro ya fue cerrado en caja. Solo un administrador puede corregirlo, indicando el motivo.';
    END IF;
    IF NULLIF(BTRIM(p_motivo), '') IS NULL THEN
      RAISE EXCEPTION 'Indicá el motivo de la corrección.';
    END IF;

    INSERT INTO public.reserva_pagos_correcciones (
      club_id, reserva_id, reserva_pago_id, motivo, snapshot_pago,
      monto, medio_pago, turno_caja_id, usuario_id
    ) VALUES (
      current_club_id(), v_reserva.id, v_pago.id, BTRIM(p_motivo), to_jsonb(v_pago),
      v_pago.monto, v_pago.medio_pago, v_pago.turno_caja_id, auth.uid()
    );

    -- Si fue efectivo, el ajuste negativo va a la caja ABIERTA actual para
    -- que la plata no quede atribuida a una caja que no la recibió.
    IF v_pago.medio_pago = 'efectivo' THEN
      v_caja_abierta := current_club_caja_abierta();
      IF v_caja_abierta IS NULL THEN
        RAISE EXCEPTION 'No hay caja abierta para registrar la corrección del efectivo cobrado.';
      END IF;
      INSERT INTO public.caja_movimientos_manuales (
        club_id, turno_caja_id, tipo, monto, concepto, observaciones, usuario_id
      ) VALUES (
        current_club_id(), v_caja_abierta, 'ajuste_negativo', v_pago.monto,
        'Corrección de cobro (reserva #' || v_reserva.id || ')',
        BTRIM(p_motivo), auth.uid()
      );
    END IF;
  END IF;

  DELETE FROM reserva_pagos
  WHERE id = p_pago_id;

  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(CASE WHEN tipo = 'sena' THEN monto ELSE 0 END), 0)
  INTO v_nuevo_monto_pagado, v_nuevo_monto_sena
  FROM reserva_pagos
  WHERE reserva_id = v_reserva.id;

  IF v_reserva.estado NOT IN ('cancelada', 'cerrada', 'jugada') THEN
    IF v_nuevo_monto_pagado >= v_reserva.monto_total AND v_reserva.monto_total > 0 THEN
      v_nuevo_estado := 'pagada';
    ELSIF v_nuevo_monto_pagado > 0 THEN
      v_nuevo_estado := 'senada';
    ELSE
      v_nuevo_estado := 'pendiente';
    END IF;
  ELSE
    v_nuevo_estado := v_reserva.estado;
  END IF;

  UPDATE reservas
  SET
    monto_pagado = LEAST(v_reserva.monto_total, v_nuevo_monto_pagado),
    monto_sena = v_nuevo_monto_sena,
    estado = v_nuevo_estado
  WHERE id = v_reserva.id;

  IF v_pago.reserva_jugador_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado_persona
    FROM reserva_pagos
    WHERE reserva_jugador_id = v_pago.reserva_jugador_id;

    IF v_total_pagado_persona = 0 THEN
      UPDATE reserva_jugadores
      SET cuota_fija = NULL
      WHERE id = v_pago.reserva_jugador_id;
    ELSE
      UPDATE reserva_jugadores
      SET cuota_fija = v_total_pagado_persona
      WHERE id = v_pago.reserva_jugador_id
        AND cuota_fija IS NOT NULL
        AND cuota_fija > v_total_pagado_persona;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_eliminar_pago_reserva(BIGINT, TEXT) TO authenticated;

COMMIT;
