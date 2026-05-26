-- ============================================================================
-- 0055_fn_cancelar_cerrar_turno.sql
-- RPCs del ciclo de vida operativo del turno: cancelar (con guarda de
-- integridad) y cerrar (cierre manual terminal).
--
-- =====================================================================
-- POR QUÉ
-- =====================================================================
-- Hoy la cancelación de una reserva suelta es un UPDATE directo desde el
-- frontend (useActualizarReserva), SIN guarda: se puede cancelar un turno
-- pagado o con consumos. Estas RPCs ponen la regla de integridad
-- server-side:
--   - Cancelar SOLO un turno sin plata ni consumo (reservado, o abierto
--     "vacío"). Nunca un turno cerrado.
--   - Cerrar es manual y NO exige saldo 0 (se puede seguir debiendo; el
--     aviso "todos pagaron, ¿cerrás?" es UX del frontend). Cerrado es
--     terminal: la guarda de la 0054 ya impide cargar consumos a un turno
--     cerrado; cobrar sí se permite (saldar deuda).
--
-- =====================================================================
-- QUÉ NO TOCA
-- =====================================================================
-- - enum reservas.estado (CHECK de 5 valores intacto).
-- - EXCLUDE no_overlap_reservas: fn_cancelar_reserva setea estado='cancelada',
--   así que el slot se libera por el WHERE (estado != 'cancelada') existente.
-- - funciones de cobro / consumo (no se modifican acá).
-- - materialización.
--
-- Gate: ambas SECURITY INVOKER. Los únicos roles del sistema son 'admin' y
-- 'vendedor' (CHECK 0001); el chequeo de sesión (current_club_id + auth.uid)
-- es el gate admin/vendedor. La RLS de reservas valida tenant en el UPDATE.
--
-- PENDIENTE FUTURO (no acá): "reabrir turno" (admin limpia cerrado_en).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. fn_cancelar_reserva — cancela SOLO si no hay plata ni consumo
-- ============================================================================
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

  -- Lock de la reserva + validación de tenant.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  -- Ya cancelada → mensaje claro (no-op suave).
  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'El turno ya está cancelado.';
  END IF;

  -- Cerrado es terminal: no se cancela.
  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede cancelar un turno cerrado.';
  END IF;

  -- Regla de integridad: solo se cancela un turno SIN plata ni consumo.
  IF EXISTS (
    SELECT 1 FROM reserva_pagos WHERE reserva_id = p_reserva_id
  ) THEN
    RAISE EXCEPTION
      'El turno tiene pagos registrados; no se puede cancelar. (Cancelar con seña/pago se resolverá más adelante.)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reserva_consumos WHERE reserva_id = p_reserva_id
  ) THEN
    RAISE EXCEPTION
      'El turno tiene consumos cargados; no se puede cancelar.';
  END IF;

  -- OK: cancelar. estado='cancelada' preserva la semántica del EXCLUDE
  -- no_overlap_reservas (WHERE estado != 'cancelada') → libera el slot.
  UPDATE reservas
  SET estado = 'cancelada'
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_cancelar_reserva(BIGINT) IS
  'Cancela una reserva SOLO si no tiene pagos ni consumos y no está cerrada
   (regla de integridad del ciclo de vida del turno). Setea estado=cancelada
   (libera el slot vía el EXCLUDE no_overlap_reservas). Reemplaza el UPDATE
   directo sin guarda del frontend. Gate admin/vendedor (sesión válida).';

GRANT EXECUTE ON FUNCTION fn_cancelar_reserva(BIGINT) TO authenticated;

-- ============================================================================
-- 2. fn_cerrar_turno — cierre MANUAL terminal (no exige saldo 0)
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cerrar_turno(p_reserva_id BIGINT)
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

  -- Lock de la reserva + validación de tenant.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  -- No se cierra un turno cancelado.
  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cerrar un turno cancelado.';
  END IF;

  -- Ya cerrado → mensaje claro (no-op suave).
  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'El turno ya está cerrado.';
  END IF;

  -- OK: cerrar. NO exige saldo 0 — se puede cerrar con deuda pendiente
  -- (el aviso "todos pagaron, ¿cerrás?" es UX del frontend). Cerrado es
  -- terminal: la 0054 ya impide cargar consumos; cobrar sí se permite.
  UPDATE reservas
  SET cerrado_en = NOW()
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_cerrar_turno(BIGINT) IS
  'Cierra manualmente un turno (cerrado_en = NOW()). Terminal: no admite
   cargar consumos después (guarda en fn_cargar_consumo_turno, 0054); cobrar
   sí se permite (saldar deuda). NO exige saldo 0. Rechaza turnos cancelados
   o ya cerrados. Gate admin/vendedor (sesión válida).';

GRANT EXECUTE ON FUNCTION fn_cerrar_turno(BIGINT) TO authenticated;

COMMIT;

-- ============================================================================
-- Fin de la migración 0055_fn_cancelar_cerrar_turno.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Como vendedor del club:
--
-- A. Cancelar un turno RESERVADO vacío (sin pago ni consumo) → OK:
--    await window.supabase.rpc('fn_cancelar_reserva', { p_reserva_id: X });
--    → estado pasa a 'cancelada', el slot queda libre en la grilla.
--
-- B. Cancelar un turno CON pago → RECHAZA:
--    (reserva con seña / algún reserva_pago)
--    → ERROR: 'El turno tiene pagos registrados; no se puede cancelar...'
--
-- C. Cancelar un turno CON consumo → RECHAZA:
--    → ERROR: 'El turno tiene consumos cargados; no se puede cancelar.'
--
-- D. Cancelar un turno CERRADO → RECHAZA:
--    → ERROR: 'No se puede cancelar un turno cerrado.'
--
-- E. Cerrar un turno → OK (aunque tenga saldo pendiente):
--    await window.supabase.rpc('fn_cerrar_turno', { p_reserva_id: X });
--    → cerrado_en = NOW().
--
-- F. Cerrar uno ya cerrado → 'El turno ya está cerrado.'
--    Cerrar uno cancelado → 'No se puede cerrar un turno cancelado.'
--
-- G. Post-cierre: cargar consumo → bloqueado (guarda de la 0054);
--    cobrar (fn_cobrar_persona_turno) → sigue funcionando.
-- ============================================================================
