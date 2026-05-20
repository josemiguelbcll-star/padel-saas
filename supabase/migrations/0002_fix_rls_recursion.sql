-- ============================================================================
-- 0002_fix_rls_recursion.sql
-- Sprint 1 — Fix de recursión en políticas RLS de `clubes` y `usuarios`
--
-- Problema que arregla:
--   Las políticas creadas en 0001 (clubes_select, usuarios_select,
--   usuarios_update_solo_admin) usan la subquery directa
--      (SELECT club_id FROM usuarios WHERE id = auth.uid())
--   Cuando esa subquery se evalúa, Postgres aplica la RLS de `usuarios`
--   de nuevo, que a su vez vuelve a ejecutar la misma subquery →
--   "infinite recursion detected in policy for relation usuarios".
--
-- Solución:
--   Reemplazar las subqueries por llamadas a funciones helper
--   SECURITY DEFINER STABLE. El SECURITY DEFINER hace que la función
--   corra con permisos del owner (postgres, que tiene BYPASSRLS),
--   por lo que la SELECT interna NO vuelve a disparar la policy.
--
--   - current_club_id() ya existía en 0001; ahora la USAMOS en las
--     políticas (en 0001 estaba definida pero no se aplicaba).
--   - current_user_rol() es nueva, análoga a current_club_id().
--
-- No se modifica 0001 (regla CLAUDE.md nº 9). Toda corrección va en
-- migraciones nuevas.
--
-- Comportamiento de seguridad: idéntico al diseñado originalmente.
--   - usuarios sólo ve registros de su propio club.
--   - clubes sólo ve su propio club.
--   - UPDATE de usuarios requiere ser admin del mismo club.
--   - WITH CHECK presente en UPDATE (regla CLAUDE.md nº 3).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Helper nuevo: current_user_rol()
--    Espejo de current_club_id() pero devuelve el rol del usuario actual.
--    Mismas garantías (SECURITY DEFINER, STABLE, search_path fijo).
-- ============================================================================
CREATE OR REPLACE FUNCTION current_user_rol()
RETURNS VARCHAR
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT rol FROM usuarios WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION current_user_rol() IS
  'Devuelve el rol del usuario autenticado actual. Helper SECURITY DEFINER
   STABLE para usar dentro de políticas RLS sin recursión.';

GRANT EXECUTE ON FUNCTION current_user_rol() TO authenticated;

-- ============================================================================
-- 2. Reemplazar política de `clubes`
--    DROP + CREATE en lugar de ALTER POLICY: ALTER POLICY no permite
--    cambiar la expresión USING en todas las versiones de Postgres,
--    y este patrón es más explícito.
-- ============================================================================
DROP POLICY IF EXISTS "clubes_select" ON clubes;

CREATE POLICY "clubes_select"
ON clubes FOR SELECT TO authenticated
USING (id = current_club_id());

-- ============================================================================
-- 3. Reemplazar políticas de `usuarios`
--    - usuarios_select: filtra por club usando current_club_id().
--    - usuarios_update_solo_admin: agrega chequeo de rol con
--      current_user_rol(). Mantiene WITH CHECK idéntico al USING.
-- ============================================================================
DROP POLICY IF EXISTS "usuarios_select" ON usuarios;
DROP POLICY IF EXISTS "usuarios_update_solo_admin" ON usuarios;

CREATE POLICY "usuarios_select"
ON usuarios FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "usuarios_update_solo_admin"
ON usuarios FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

COMMIT;

-- ============================================================================
-- Fin de la migración 0002_fix_rls_recursion.sql
-- ============================================================================
