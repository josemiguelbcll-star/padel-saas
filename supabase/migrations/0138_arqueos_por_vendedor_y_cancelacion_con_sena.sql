-- ============================================================================
-- 0138_arqueos_por_vendedor_y_cancelacion_con_sena.sql
--
-- 1. Limita la lectura del historial de cajas de vendedores a las jornadas
--    asociadas a ellos, conservando la lectura de la caja diaria abierta para
--    que puedan operar el turno compartido.
-- 2. Permite cancelar reservas con pagos: los pagos quedan registrados como
--    ingreso de Canchas y el estado cancelado libera el horario.
-- ============================================================================

BEGIN;

-- Los administradores ven todas las cajas. Los vendedores con el permiso de
-- arqueos ven sus cajas por vendedor_id y las jornadas diarias en las que
-- abrieron/cerraron. La caja diaria actualmente abierta sigue visible para
-- que Caja pueda operar igual, aunque el permiso de arqueos esté apagado.
DROP POLICY IF EXISTS "turnos_caja_select_propio_club" ON turnos_caja;

CREATE POLICY "turnos_caja_select_admin_o_propio_vendedor"
ON turnos_caja FOR SELECT TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR id = current_club_caja_abierta()
    OR (
      current_user_rol() = 'vendedor'
      AND EXISTS (
        SELECT 1
        FROM usuarios u
        WHERE u.id = auth.uid()
          AND u.club_id = current_club_id()
          AND u.permisos #>> '{modulos,caja_arqueos,ver}' = 'true'
      )
      AND (
        vendedor_id = auth.uid()
        OR usuario_apertura = auth.uid()
        OR usuario_cierre = auth.uid()
      )
    )
  )
);

-- Cancelar reserva sin borrar cobros: los pagos conservados siguen formando
-- parte del ingreso de Canchas.
CREATE OR REPLACE FUNCTION fn_cancelar_reserva(p_reserva_id BIGINT)
RETURNS reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva reservas;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'El turno ya está cancelado.';
  END IF;

  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede cancelar un turno cerrado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reserva_consumos WHERE reserva_id = p_reserva_id
  ) THEN
    RAISE EXCEPTION
      'El turno tiene consumos cargados; no se puede cancelar.';
  END IF;

  UPDATE reservas
  SET estado = 'cancelada'
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_cancelar_reserva(BIGINT) IS
  'Cancela reservas no cerradas y sin consumos. Conserva los pagos ya
   registrados como ingreso de Canchas; estado=cancelada libera el horario.';

GRANT EXECUTE ON FUNCTION fn_cancelar_reserva(BIGINT) TO authenticated;

COMMIT;
