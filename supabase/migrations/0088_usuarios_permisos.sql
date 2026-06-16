-- Migration 0088_usuarios_permisos.sql
-- Agrega columna de permisos a la tabla de usuarios y actualiza privilegios de update

BEGIN;

-- Agrega la columna permisos con un objeto vacío por defecto
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN usuarios.permisos IS
  'Permisos granulares del usuario. Estructura: {"modulos": {"reservas": {"ver": true, "editar": true}, ...}}';

-- Concede permisos de UPDATE sobre la nueva columna a los usuarios autenticados
-- (la policy usuarios_update_solo_admin restringe que solo el admin de ese club pueda actualizar)
GRANT UPDATE (permisos) ON usuarios TO authenticated;

COMMIT;
