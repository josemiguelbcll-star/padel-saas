-- ============================================================================
-- Migración 0167: RLS de clases — permitir a vendedores (fix 42501)
-- ============================================================================
-- Problema
--   Al crear una clase (única o recurrente) desde la grilla del día con una
--   cuenta VENDEDOR, la base devuelve:
--     { code: '42501', message: 'new row violates row-level security policy
--       for table "clases"' }
--
--   La política INSERT desplegada sobre `clases` todavía es la original de la
--   migración 0005, que exige `current_user_rol() = 'admin'`. Las versiones que
--   habilitan a vendedores / permisos granulares se agregaron en 0132 y 0133, y
--   no están aplicadas en producción.
--
-- Solución
--   Reaplicar las políticas vigentes del repositorio (0133) sobre `clases`.
--   Es idempotente (DROP IF EXISTS + CREATE) y NO cambia la lógica de negocio:
--   solo sincroniza lo desplegado con el código fuente. Se incluye la definición
--   de has_user_permission por defensa, ya que las políticas la referencian.
--
--   El admin sigue teniendo acceso total (current_user_rol() = 'admin').
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Helper has_user_permission (idempotente; ya existe en entornos al día)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_user_permission(p_modulo TEXT, p_accion TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_rol VARCHAR;
  v_permisos JSONB;
BEGIN
  IF current_user_is_plataforma_admin() THEN
    RETURN TRUE;
  END IF;

  SELECT rol, permisos INTO v_rol, v_permisos
  FROM usuarios
  WHERE id = auth.uid();

  IF v_rol = 'admin' THEN
    RETURN TRUE;
  END IF;

  IF v_rol <> 'vendedor' THEN
    RETURN FALSE;
  END IF;

  IF v_permisos IS NOT NULL
     AND (v_permisos->'modulos'->p_modulo ? p_accion) THEN
    RETURN (v_permisos->'modulos'->p_modulo->>p_accion)::BOOLEAN;
  END IF;

  IF p_modulo IN ('reservas', 'noticias', 'caja', 'mostrador', 'finanzas', 'inventario') THEN
    RETURN TRUE;
  ELSIF p_modulo = 'configuracion' THEN
    RETURN (p_accion = 'ver');
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_user_permission(TEXT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 1. RLS en clases — INSERT/UPDATE/DELETE para admin, vendedor o permiso
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "clases_insert_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_update_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_delete_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_insert_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_update_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_delete_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_insert_con_permiso" ON clases;
DROP POLICY IF EXISTS "clases_update_con_permiso" ON clases;
DROP POLICY IF EXISTS "clases_delete_con_permiso" ON clases;

CREATE POLICY "clases_insert_con_permiso"
ON clases FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
);

CREATE POLICY "clases_update_con_permiso"
ON clases FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
);

CREATE POLICY "clases_delete_con_permiso"
ON clases FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
);

-- Asegurar permisos a nivel tabla
GRANT SELECT, INSERT, UPDATE, DELETE ON clases TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE clases_id_seq TO authenticated;

COMMIT;
