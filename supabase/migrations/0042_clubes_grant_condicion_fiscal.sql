-- ============================================================================
-- 0042_clubes_grant_condicion_fiscal.sql
-- Suma `condicion_fiscal` al GRANT UPDATE column-level de `clubes`. Sin
-- esto, el frontend no puede guardar el campo agregado en la 0041 (la
-- policy RLS deja pasar al admin, pero el GRANT column-level lo
-- bloquea con 42501 — patrón de defensa en capas, ver 0016/0017).
--
-- El GRANT acumula: NO reemplaza los privilegios viejos sobre
-- (nombre, color_primario_hsl, logo_path, hora_apertura, hora_cierre,
-- duracion_turno_default). Solo añade `condicion_fiscal` a la lista
-- de columnas que el rol `authenticated` puede UPDATEar (la policy
-- `clubes_update_solo_admin_horarios` sigue gateando a admin).
-- ============================================================================

BEGIN;

GRANT UPDATE (condicion_fiscal) ON clubes TO authenticated;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- SELECT column_name, privilege_type
-- FROM information_schema.column_privileges
-- WHERE table_name = 'clubes' AND grantee = 'authenticated'
--   AND column_name = 'condicion_fiscal';
-- → 1 fila: condicion_fiscal | UPDATE.
--
-- Smoke test desde el frontend (admin del club):
--   await window.supabase.from('clubes')
--     .update({ condicion_fiscal: 'responsable_inscripto' })
--     .eq('id', <club_id>);
-- → OK. Sin la migración: ERROR 42501 (permission denied).
-- ============================================================================
