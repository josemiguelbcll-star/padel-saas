-- ============================================================================
-- 0112_plataforma_admin_credentials_y_usuarios.sql
-- Visualización de administradores y gestión de claves desde panel plataforma
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. REDEFINICIÓN: clubes_resumen_plataforma()
--    Agrega admin_email y admin_nombre para visualización directa en lista.
-- ============================================================================
DROP FUNCTION IF EXISTS clubes_resumen_plataforma();

CREATE OR REPLACE FUNCTION clubes_resumen_plataforma()
RETURNS TABLE (
  id BIGINT,
  nombre VARCHAR,
  slug VARCHAR,
  logo_path VARCHAR,
  estado VARCHAR,
  plan_id BIGINT,
  plan_codigo VARCHAR,
  plan_nombre VARCHAR,
  fecha_alta TIMESTAMPTZ,
  cantidad_usuarios INT,
  cantidad_canchas INT,
  total_ventas_historico DECIMAL(12,2),
  total_ventas_mes_actual DECIMAL(12,2),
  admin_email VARCHAR,
  admin_nombre VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.nombre,
    c.slug,
    c.logo_path,
    c.estado,
    c.plan_id,
    p.codigo,
    p.nombre,
    c.fecha_alta,
    (SELECT COUNT(*)::INT
       FROM usuarios u
       WHERE u.club_id = c.id
         AND u.activo = TRUE),
    (SELECT COUNT(*)::INT
       FROM canchas k
       WHERE k.club_id = c.id),
    -- Ventas Histórico:
    (
      COALESCE((
        SELECT SUM(CASE WHEN rp.tipo = 'reembolso' THEN -rp.monto ELSE rp.monto END)
        FROM reserva_pagos rp
        WHERE rp.club_id = c.id
      ), 0) +
      COALESCE((
        SELECT SUM(cc.monto)
        FROM clase_cobros cc
        WHERE cc.club_id = c.id
      ), 0) +
      COALESCE((
        SELECT SUM(v.monto_total)
        FROM ventas v
        WHERE v.club_id = c.id
      ), 0) +
      COALESCE((
        SELECT SUM(oi.monto)
        FROM otros_ingresos oi
        WHERE oi.club_id = c.id AND oi.activo = TRUE
      ), 0)
    )::DECIMAL(12,2),
    -- Ventas Mes Actual:
    (
      COALESCE((
        SELECT SUM(CASE WHEN rp.tipo = 'reembolso' THEN -rp.monto ELSE rp.monto END)
        FROM reserva_pagos rp
        WHERE rp.club_id = c.id AND rp.fecha_hora >= DATE_TRUNC('month', CURRENT_DATE)
      ), 0) +
      COALESCE((
        SELECT SUM(cc.monto)
        FROM clase_cobros cc
        WHERE cc.club_id = c.id AND cc.fecha_hora >= DATE_TRUNC('month', CURRENT_DATE)
      ), 0) +
      COALESCE((
        SELECT SUM(v.monto_total)
        FROM ventas v
        WHERE v.club_id = c.id AND v.fecha_hora >= DATE_TRUNC('month', CURRENT_DATE)
      ), 0) +
      COALESCE((
        SELECT SUM(oi.monto)
        FROM otros_ingresos oi
        WHERE oi.club_id = c.id AND oi.activo = TRUE AND oi.fecha_alta >= DATE_TRUNC('month', CURRENT_DATE)
      ), 0)
    )::DECIMAL(12,2),
    -- Admin principal (email y nombre):
    (
      SELECT u.email
      FROM usuarios u
      WHERE u.club_id = c.id
      ORDER BY (u.rol = 'admin') DESC, u.activo DESC, u.fecha_alta ASC
      LIMIT 1
    )::VARCHAR AS admin_email,
    (
      SELECT u.nombre
      FROM usuarios u
      WHERE u.club_id = c.id
      ORDER BY (u.rol = 'admin') DESC, u.activo DESC, u.fecha_alta ASC
      LIMIT 1
    )::VARCHAR AS admin_nombre
  FROM clubes c
  JOIN planes p ON p.id = c.plan_id
  ORDER BY c.nombre ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION clubes_resumen_plataforma() TO authenticated;


-- ============================================================================
-- 2. RPC: fn_usuarios_club_plataforma(p_club_id)
--    Retorna todos los usuarios de un club para el superadmin de plataforma.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_usuarios_club_plataforma(p_club_id BIGINT)
RETURNS TABLE (
  id UUID,
  club_id BIGINT,
  nombre VARCHAR,
  rol VARCHAR,
  email VARCHAR,
  activo BOOLEAN,
  fecha_alta TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.club_id,
    u.nombre,
    u.rol,
    u.email,
    u.activo,
    u.fecha_alta
  FROM usuarios u
  WHERE u.club_id = p_club_id
  ORDER BY (u.rol = 'admin') DESC, u.activo DESC, u.fecha_alta ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_usuarios_club_plataforma(BIGINT) TO authenticated;


-- ============================================================================
-- 3. RPC: fn_cambiar_password_usuario_plataforma(p_user_id, p_nueva_password)
--    Permite al superadmin asignar o resetear la contraseña de un usuario/admin.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cambiar_password_usuario_plataforma(
  p_user_id UUID,
  p_nueva_password VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
BEGIN
  -- 1. Validar que el caller sea superadmin activo de plataforma
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado. Solo el superadmin puede modificar contraseñas de clubes.';
  END IF;

  -- 2. Validar longitud de la contraseña
  IF LENGTH(p_nueva_password) < 6 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres.';
  END IF;

  -- 3. Actualizar la contraseña en auth.users
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_nueva_password, extensions.gen_salt('bf')),
      updated_at = NOW()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado en el sistema de autenticación.';
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cambiar_password_usuario_plataforma(UUID, VARCHAR) TO authenticated;

COMMIT;
