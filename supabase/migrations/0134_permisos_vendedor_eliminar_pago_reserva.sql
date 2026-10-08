-- ============================================================================
-- Migration 0134_permisos_vendedor_eliminar_pago_reserva.sql
--
-- 1. RESERVAS: Permite a usuarios con rol 'vendedor' (además de 'admin') modificar y
--    eliminar pagos de reservas (deshacer cobro / cambiar medio de pago).
--    Actualiza las políticas RLS sobre la tabla `reserva_pagos`.
--
-- 2. RESERVAS RPC: Define la función RPC `fn_eliminar_pago_reserva(p_pago_id BIGINT)` como
--    SECURITY DEFINER con validación de rol ('admin' o 'vendedor') y pertenencia
--    al club, recalculando monto_pagado, monto_sena y estado de la reserva,
--    y restaurando la cuota_fija del jugador si correspondiera.
--
-- 3. CLASES: Permite a usuarios con rol 'vendedor' modificar y eliminar
--    cobros de clases (deshacer cobro de alumno / cobro general).
--    Actualiza las políticas RLS sobre la tabla `clase_cobros`.
--
-- 4. CLASES RPC: Define la función RPC `fn_borrar_cobro_clase(p_cobro_id BIGINT)` como
--    SECURITY DEFINER con validación de rol ('admin' o 'vendedor') y pertenencia
--    al club para eliminar cobros de clases limpiamente.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Políticas RLS en reserva_pagos para permitir a vendedores deshacer cobros
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "reserva_pagos_update_solo_admin" ON reserva_pagos;
DROP POLICY IF EXISTS "reserva_pagos_delete_solo_admin" ON reserva_pagos;
DROP POLICY IF EXISTS "reserva_pagos_update_admin_vendedor" ON reserva_pagos;
DROP POLICY IF EXISTS "reserva_pagos_delete_admin_vendedor" ON reserva_pagos;

CREATE POLICY "reserva_pagos_update_admin_vendedor"
ON reserva_pagos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

CREATE POLICY "reserva_pagos_delete_admin_vendedor"
ON reserva_pagos FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON reserva_pagos TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. RPC: fn_eliminar_pago_reserva
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_eliminar_pago_reserva(
  p_pago_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago reserva_pagos;
  v_reserva reservas;
  v_nuevo_monto_pagado DECIMAL(12,2) := 0;
  v_nuevo_monto_sena DECIMAL(12,2) := 0;
  v_nuevo_estado VARCHAR(20);
  v_total_pagado_persona DECIMAL(12,2) := 0;
BEGIN
  -- Validar rol del usuario
  IF current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar pagos de reservas.';
  END IF;

  -- Obtener el pago asegurando que pertenezca al club del usuario activo
  SELECT * INTO v_pago
  FROM reserva_pagos
  WHERE id = p_pago_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no existe o no pertenece a tu club.';
  END IF;

  -- Obtener la reserva asociada
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_pago.reserva_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva asociada al pago no existe o no pertenece a tu club.';
  END IF;

  -- No permitir eliminar pagos en turnos ya cerrados definitivamente
  IF v_reserva.estado = 'cerrada' THEN
    RAISE EXCEPTION 'No se pueden eliminar pagos de un turno que ya ha sido cerrado.';
  END IF;

  -- Eliminar el pago
  DELETE FROM reserva_pagos
  WHERE id = p_pago_id;

  -- Recalcular montos acumulados de la reserva
  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(CASE WHEN tipo = 'sena' THEN monto ELSE 0 END), 0)
  INTO v_nuevo_monto_pagado, v_nuevo_monto_sena
  FROM reserva_pagos
  WHERE reserva_id = v_reserva.id;

  -- Determinar el nuevo estado de la reserva
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

  -- Actualizar reserva
  UPDATE reservas
  SET
    monto_pagado = LEAST(v_reserva.monto_total, v_nuevo_monto_pagado),
    monto_sena = v_nuevo_monto_sena,
    estado = v_nuevo_estado
  WHERE id = v_reserva.id;

  -- Si el pago estaba asignado a una persona del turno, revisar su cuota_fija
  IF v_pago.reserva_jugador_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado_persona
    FROM reserva_pagos
    WHERE reserva_jugador_id = v_pago.reserva_jugador_id;

    IF v_total_pagado_persona = 0 THEN
      -- Se eliminaron todos sus pagos: liberar cuota fija para reparto dinámico
      UPDATE reserva_jugadores
      SET cuota_fija = NULL
      WHERE id = v_pago.reserva_jugador_id;
    ELSE
      -- Si la cuota fija supera lo que pagó efectivamente, ajustarla
      UPDATE reserva_jugadores
      SET cuota_fija = v_total_pagado_persona
      WHERE id = v_pago.reserva_jugador_id
        AND cuota_fija IS NOT NULL
        AND cuota_fija > v_total_pagado_persona;
    END IF;
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_eliminar_pago_reserva(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Políticas RLS en clase_cobros para permitir a vendedores anular/borrar cobros
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "clase_cobros_update_solo_admin" ON clase_cobros;
DROP POLICY IF EXISTS "clase_cobros_delete_solo_admin" ON clase_cobros;
DROP POLICY IF EXISTS "clase_cobros_update_admin_vendedor" ON clase_cobros;
DROP POLICY IF EXISTS "clase_cobros_delete_admin_vendedor" ON clase_cobros;

CREATE POLICY "clase_cobros_update_admin_vendedor"
ON clase_cobros FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

CREATE POLICY "clase_cobros_delete_admin_vendedor"
ON clase_cobros FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin', 'vendedor')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON clase_cobros TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPC: fn_borrar_cobro_clase
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_borrar_cobro_clase(
  p_cobro_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cobro clase_cobros;
BEGIN
  -- Validar permisos de rol
  IF current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar cobros de clases.';
  END IF;

  -- Validar pertenencia al club del usuario activo
  SELECT * INTO v_cobro
  FROM clase_cobros
  WHERE id = p_cobro_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cobro no existe o no pertenece a tu club.';
  END IF;

  -- Eliminar el cobro
  DELETE FROM clase_cobros
  WHERE id = p_cobro_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_borrar_cobro_clase(BIGINT) TO authenticated;

COMMIT;
