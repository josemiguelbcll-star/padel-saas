-- 0085: Agregar permisos personalizados a usuarios
-- Permite a los admins asignar permisos específicos a los vendedores

BEGIN;

-- 1. Agregar columna permisos a la tabla usuarios
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS permisos text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN usuarios.permisos IS
  'Array de permisos personalizados asignados a la cuenta. Los admins tienen todos implícitamente.';

-- 2. Conceder permisos de UPDATE sobre la nueva columna a los usuarios autenticados
-- En la migración 0018 se revocó el UPDATE general y se concedió a nivel de columna:
-- (nombre, rol, activo, email). Ahora agregamos la columna permisos.
GRANT UPDATE (nombre, rol, activo, email, permisos) ON usuarios TO authenticated;

COMMIT;
