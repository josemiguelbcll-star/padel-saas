-- ============================================================================
-- 0033_turnos_fijos_delete_policy.sql
-- Bug fix: fn_eliminar_turno_fijo (0032) ejecutaba el DELETE pero RLS lo
-- filtraba silenciosamente porque turnos_fijos NO tenía policy de DELETE
-- (solo SELECT/INSERT/UPDATE en 0030). Como la función es SECURITY INVOKER,
-- el DELETE corría con permisos del caller y afectaba 0 filas sin error.
-- Resultado: la RPC retornaba {reservas_canceladas: N} OK pero el turno
-- fijo sobrevivía.
--
-- =====================================================================
-- SOLUCIÓN
-- =====================================================================
-- Agregar policy DELETE restringida a admin del club. Coherente con el
-- patrón INSERT/UPDATE (también admin-only) y con el resto de las tablas
-- del proyecto. Mantiene fn_eliminar_turno_fijo como SECURITY INVOKER:
-- defensa en capas (gate de admin en RPC + RLS server-side).
--
-- =====================================================================
-- POR QUÉ ESTA OPCIÓN Y NO SECURITY DEFINER
-- =====================================================================
-- 1. Defensa en capas real: la RLS no depende del código de la función.
--    Si un cambio futuro a la RPC borra accidentalmente el gate de admin,
--    la policy RLS sigue rechazando. Cinturón + tiradores.
-- 2. Coherencia: todas las tablas del proyecto usan INVOKER + policies
--    por operación. DEFINER sería una excepción que rompe el patrón.
-- 3. Auditoría: la policy queda visible en pg_policies. Herramientas de
--    audit la detectan sin leer código PL/pgSQL.
-- 4. El admin del club es el dueño legítimo del turno fijo — está
--    perfectamente legitimado para borrarlo. DEFINER (que eleva
--    privilegios) no es necesario.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Policy de DELETE — solo admin del club
-- ============================================================================
CREATE POLICY "turnos_fijos_delete_admin"
ON turnos_fijos FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 2. GRANT DELETE explícito
-- ============================================================================
--    El rol authenticated ya tiene DELETE por default privileges del
--    proyecto (deuda de seguridad anotada en CLAUDE.md → Deudas de
--    seguridad detectadas). Agregamos el GRANT explícito para:
--      - Documentar el privilegio intencional (intent visible en SQL).
--      - Blindar contra una futura depuración de defaults que revoque
--        DELETE en bloque.
-- ============================================================================
GRANT DELETE ON turnos_fijos TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0033_turnos_fijos_delete_policy.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. La policy existe ----------
-- SELECT polname, polcmd FROM pg_policies WHERE tablename = 'turnos_fijos';
-- → Debe listar 4 policies:
--      turnos_fijos_select_propio_club  (r = SELECT)
--      turnos_fijos_insert_admin        (a = INSERT)
--      turnos_fijos_update_admin        (w = UPDATE)
--      turnos_fijos_delete_admin        (d = DELETE)  ← NUEVA

-- ---------- B. LA CRÍTICA — eliminar como admin AHORA SÍ borra ----------
-- Crear un turno fijo de prueba, materializar para tener pendientes,
-- y eliminar como admin:
--   await window.supabase.rpc('fn_eliminar_turno_fijo', {
--     p_turno_fijo_id: <id>
--   });
-- → { data: [{ reservas_canceladas: N }], error: null }
-- Verificar (ambas tienen que ser ciertas):
--   1) SELECT id FROM turnos_fijos WHERE id = <id>;
--      → 0 filas. El turno fijo SE BORRÓ.
--   2) SELECT estado, turno_fijo_id FROM reservas
--        WHERE fecha >= CURRENT_DATE AND estado = 'cancelada'
--          AND turno_fijo_id IS NULL;
--      → Las pendientes futuras canceladas tienen turno_fijo_id = NULL
--        (ON DELETE SET NULL aplicado correctamente).
--   3) SELECT id, estado, monto_pagado FROM reservas
--        WHERE fecha < CURRENT_DATE AND turno_fijo_id IS NULL;
--      → Las pasadas/pagadas se preservan intactas (estado/monto sin tocar).

-- ---------- C. Slot liberado para nuevo turno fijo ----------
-- Crear otro turno fijo en el mismo slot del que acabás de eliminar:
--   await window.supabase.rpc('fn_crear_turno_fijo', {
--     p_cancha_id: <misma>, p_dia_semana: <mismo>, p_hora_inicio: <misma>,
--     ...
--   });
-- → OK. El UNIQUE parcial (turnos_fijos_no_overlap_activos) liberado
--   porque el viejo se borró.

-- ---------- D. Vendedor → bloqueado por gate de la RPC (primer barrera) ----------
-- Como vendedor:
--   await window.supabase.rpc('fn_eliminar_turno_fijo', { p_turno_fijo_id: <id> });
-- → P0001: 'Solo el administrador puede eliminar turnos fijos.'
-- Ni siquiera llega al DELETE; el RAISE EXCEPTION del gate de la RPC corta.

-- ---------- E. DELETE directo de vendedor (sin pasar por RPC) → RLS lo bloquea ----------
-- Como vendedor (caso hipotético, frontend NO hace esto):
--   await window.supabase.from('turnos_fijos').delete().eq('id', <id>);
-- → 0 filas afectadas (sin error). La policy filtra por rol admin.
-- (Esto demuestra la segunda capa de defensa: aun si el code path normal
-- fallara, la RLS protege.)

-- ---------- F. DELETE de admin de OTRO club → RLS bloquea por club_id ----------
-- Hipotético: admin del club X intenta borrar turno fijo del club Y:
--   await window.supabase.from('turnos_fijos').delete().eq('id', <id_otro_club>);
-- → 0 filas afectadas. La policy filtra por current_club_id().

-- ---------- G. UPDATE/INSERT/SELECT siguen funcionando ----------
-- Como admin: crear, editar, cancelar (UPDATE), listar — todo igual.
-- (Esta migración solo SUMA una policy; no toca las existentes.)
-- ============================================================================
