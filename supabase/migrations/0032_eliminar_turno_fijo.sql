-- ============================================================================
-- 0032_eliminar_turno_fijo.sql
-- RPC para eliminar definitivamente un turno fijo (DELETE), distinto del
-- "desactivar" (activo=FALSE) ya existente.
--
-- =====================================================================
-- CONCEPTO
-- =====================================================================
-- Hasta hoy el único path de "cancelar turno fijo" era fn_cancelar_turno_fijo
-- (soft-disable: activo=FALSE, conserva la fila). Eso es útil cuando se
-- quiere preservar el registro inactivo en histórico.
--
-- Esta migración suma fn_eliminar_turno_fijo (hard-delete: DELETE) para
-- el caso "data que no se usa más, querés liberar el slot del UNIQUE
-- parcial". Preserva el historial financiero vía el ON DELETE SET NULL
-- ya existente en reservas.turno_fijo_id (0030).
--
-- =====================================================================
-- QUÉ HACE LA RPC (atómica)
-- =====================================================================
-- 1. Cancela reservas FUTURAS pendientes asociadas:
--      UPDATE reservas SET estado='cancelada'
--      WHERE turno_fijo_id = X AND club_id = Y
--        AND fecha >= CURRENT_DATE AND estado = 'pendiente';
--    Las pagadas/señadas/jugadas/canceladas NO se tocan (historial).
--
-- 2. DELETE FROM turnos_fijos WHERE id = X.
--    El ON DELETE SET NULL en reservas.turno_fijo_id deja las reservas
--    históricas SIN LINK al turno fijo, pero NO las borra — preserva
--    cobros, snapshots de monto, jugadores asociados, etc.
--
-- =====================================================================
-- DIFERENCIA CON fn_cancelar_turno_fijo
-- =====================================================================
--   - cancelar  → activo = FALSE. Conserva la fila inactiva.
--   - eliminar  → DELETE. Libera el slot del UNIQUE parcial
--                 (turnos_fijos_no_overlap_activos), pudiendo crear
--                 otro turno fijo en ese cancha+día+hora.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_eliminar_turno_fijo(
  p_turno_fijo_id BIGINT
)
RETURNS TABLE (
  reservas_canceladas INT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_fijos;
  v_canceladas INT := 0;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede eliminar turnos fijos.';
  END IF;

  -- Lock + validar pertenencia al club. Si no existe (o no es de este
  -- club), RAISE con mensaje claro antes de tocar nada.
  SELECT * INTO v_turno
  FROM turnos_fijos
  WHERE id = p_turno_fijo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno fijo no encontrado.';
  END IF;

  -- 1. Cancelar reservas pendientes FUTURAS del turno.
  --    NO toca:
  --      - reservas pasadas (fecha < hoy): historia.
  --      - reservas pagadas/señadas/jugadas/canceladas: historia financiera
  --        o ya están fuera de juego.
  UPDATE reservas
  SET estado = 'cancelada'
  WHERE turno_fijo_id = p_turno_fijo_id
    AND club_id = v_club_id
    AND fecha >= CURRENT_DATE
    AND estado = 'pendiente';
  GET DIAGNOSTICS v_canceladas = ROW_COUNT;

  -- 2. DELETE del turno fijo.
  --    El ON DELETE SET NULL en reservas.turno_fijo_id (0030) deja las
  --    reservas históricas SIN LINK al turno fijo, pero NO las borra.
  --    Esto preserva snapshots de monto, cobros, jugadores asociados,
  --    medio de pago, turno_caja_id, etc.
  DELETE FROM turnos_fijos WHERE id = p_turno_fijo_id;

  RETURN QUERY SELECT v_canceladas;
END;
$$;

COMMENT ON FUNCTION fn_eliminar_turno_fijo IS
  'Elimina (DELETE) un turno fijo. Cancela primero las reservas
   pendientes FUTURAS asociadas (no toca pagadas/jugadas/históricas).
   El ON DELETE SET NULL en reservas.turno_fijo_id (0030) preserva las
   reservas históricas sin link. Atómica. Gate: admin. Distinto de
   fn_cancelar_turno_fijo, que solo desactiva (activo=FALSE) sin DELETE.';

GRANT EXECUTE ON FUNCTION fn_eliminar_turno_fijo(BIGINT) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0032_eliminar_turno_fijo.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. La función existe + gate admin ----------
-- Como vendedor (NO admin):
--   await window.supabase.rpc('fn_eliminar_turno_fijo', {
--     p_turno_fijo_id: <id>
--   });
-- → 'Solo el administrador puede eliminar turnos fijos.'

-- ---------- B. Turno fijo inexistente ----------
-- Como admin:
--   await window.supabase.rpc('fn_eliminar_turno_fijo', {
--     p_turno_fijo_id: 99999999
--   });
-- → 'Turno fijo no encontrado.'

-- ---------- C. Eliminar turno fijo SIN reservas materializadas pendientes ----------
-- Como admin, sobre un turno fijo recién creado (sin materializar):
--   await window.supabase.rpc('fn_eliminar_turno_fijo', { p_turno_fijo_id: <id> });
-- → { data: [{ reservas_canceladas: 0 }], error: null }
-- Verificar:
--   SELECT * FROM turnos_fijos WHERE id = <id>;   → 0 filas
--   El slot (cancha+dia+hora) queda libre — se puede crear otro turno
--   fijo allí (UNIQUE parcial deja de aplicar).

-- ---------- D. Eliminar turno fijo CON pendientes futuras ----------
-- Como admin, sobre un turno fijo con reservas pendientes materializadas:
--   await window.supabase.rpc('fn_eliminar_turno_fijo', { p_turno_fijo_id: <id> });
-- → { data: [{ reservas_canceladas: N }] } donde N = reservas pendientes
--   futuras que pasaron a estado='cancelada'.
-- Verificar:
--   SELECT estado, turno_fijo_id FROM reservas WHERE turno_fijo_id IS NULL
--     AND fecha >= CURRENT_DATE AND estado = 'cancelada';
--   → Las pendientes futuras quedaron canceladas y con turno_fijo_id = NULL
--     (por ON DELETE SET NULL).

-- ---------- E. Preserva historial — reservas pagadas/jugadas NO se tocan ----------
-- Sobre un turno fijo con reservas pasadas pagadas:
-- Antes:
--   SELECT id, estado, monto_pagado, turno_fijo_id FROM reservas
--     WHERE turno_fijo_id = <id> AND fecha < CURRENT_DATE;
-- Eliminar el turno fijo.
-- Después:
--   Mismas filas → estado intacto, monto_pagado intacto, turno_fijo_id = NULL.
--   Los reserva_pagos asociados intactos. La caja del día intacta.

-- ---------- F. Libera el slot del UNIQUE parcial ----------
-- Después de eliminar un turno fijo activo del miércoles 19:00 cancha 1,
-- crear OTRO turno fijo (mismo slot):
--   await window.supabase.rpc('fn_crear_turno_fijo', {
--     p_cancha_id: 1, p_jugador_id: <otro>, p_nombre_libre: null,
--     p_dia_semana: 3, p_hora_inicio: '19:00', p_duracion_min: 90,
--     p_fecha_desde: '2026-05-22'
--   });
-- → OK (no choca con UNIQUE parcial, porque el viejo se borró).

-- ---------- G. Atomicidad — si falla algo, rollback completo ----------
-- (No hay forma fácil de inducir el fallo desde el cliente. La
-- transacción implícita PL/pgSQL garantiza que UPDATE + DELETE van
-- juntos: si DELETE falla por FK no esperada, los UPDATEs se anulan.)

-- ---------- H. Sesión / RLS / club mismatch ----------
-- Como admin de OTRO club (con club_id distinto):
--   await window.supabase.rpc('fn_eliminar_turno_fijo', { p_turno_fijo_id: <id_signo> });
-- → 'Turno fijo no encontrado.' (porque el WHERE filtra por club_id).
-- ============================================================================
