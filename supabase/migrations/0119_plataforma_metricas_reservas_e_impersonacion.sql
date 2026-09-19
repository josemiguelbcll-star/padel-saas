-- ============================================================================
-- 0119_plataforma_metricas_reservas_e_impersonacion.sql
-- Métricas de reservas por origen (App MatchGo vs Recepción) e Impersonación
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. SOPORTE DE IMPERSONACIÓN EN plataforma_admins
-- ============================================================================

ALTER TABLE plataforma_admins
  ADD COLUMN IF NOT EXISTS impersonated_club_id BIGINT REFERENCES clubes(id) ON DELETE SET NULL;

COMMENT ON COLUMN plataforma_admins.impersonated_club_id IS
  'Club que el superadmin está administrando en modo impersonación. NULL = en panel de plataforma.';


-- ============================================================================
-- 2. HELPER: current_club_id() actualizado con soporte de impersonación
-- ============================================================================

CREATE OR REPLACE FUNCTION current_club_id()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
BEGIN
  -- 1. Si el caller es superadmin y tiene un club asignado en impersonación:
  IF current_user_is_plataforma_admin() THEN
    SELECT impersonated_club_id INTO v_club_id
    FROM plataforma_admins
    WHERE id = auth.uid();

    IF v_club_id IS NOT NULL THEN
      RETURN v_club_id;
    END IF;
  END IF;

  -- 2. Flujo normal de usuarios del club:
  SELECT club_id INTO v_club_id FROM usuarios WHERE id = auth.uid();
  RETURN v_club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION current_club_id() TO authenticated;


-- ============================================================================
-- 3. HELPER: current_user_rol() actualizado con soporte de superadmin
-- ============================================================================

CREATE OR REPLACE FUNCTION current_user_rol()
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_rol VARCHAR;
BEGIN
  -- Si el caller es superadmin de plataforma, opera con privilegios plenos de 'admin'
  IF current_user_is_plataforma_admin() THEN
    RETURN 'admin';
  END IF;

  SELECT rol INTO v_rol FROM usuarios WHERE id = auth.uid();
  RETURN v_rol;
END;
$$;

GRANT EXECUTE ON FUNCTION current_user_rol() TO authenticated;


-- ============================================================================
-- 4. RPCs DE CONTROL DE IMPERSONACIÓN
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_impersonar_club_plataforma(p_club_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado. Solo los superadministradores pueden impersonar clubes.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clubes WHERE id = p_club_id) THEN
    RAISE EXCEPTION 'El club especificado no existe.';
  END IF;

  UPDATE plataforma_admins
  SET impersonated_club_id = p_club_id
  WHERE id = auth.uid();

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_impersonar_club_plataforma(BIGINT) TO authenticated;


CREATE OR REPLACE FUNCTION fn_dejar_de_impersonar_plataforma()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  UPDATE plataforma_admins
  SET impersonated_club_id = NULL
  WHERE id = auth.uid();

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_dejar_de_impersonar_plataforma() TO authenticated;


-- ============================================================================
-- 5. REDEFINICIÓN: clubes_resumen_plataforma()
--    Agrega métricas de reservas desglosadas por App MatchGo vs Recepción
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
  admin_nombre VARCHAR,
  total_reservas INT,
  reservas_app INT,
  reservas_presenciales INT,
  total_jugadores INT,
  total_ventas_reservas_app DECIMAL(12,2)
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
    p.codigo AS plan_codigo,
    p.nombre AS plan_nombre,
    c.fecha_alta,
    -- Usuarios activos:
    (SELECT COUNT(*)::INT
       FROM usuarios u
       WHERE u.club_id = c.id
         AND u.activo = TRUE),
    -- Canchas:
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
    )::DECIMAL(12,2) AS total_ventas_historico,
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
    )::DECIMAL(12,2) AS total_ventas_mes_actual,
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
    )::VARCHAR AS admin_nombre,
    -- Total Reservas (no canceladas):
    (
      SELECT COUNT(*)::INT
      FROM reservas r
      WHERE r.club_id = c.id AND r.estado <> 'cancelada'
    ) AS total_reservas,
    -- Reservas originadas desde la App / Portal de Jugador MatchGo:
    (
      SELECT COUNT(*)::INT
      FROM reservas r
      WHERE r.club_id = c.id
        AND r.estado <> 'cancelada'
        AND (
          r.usuario_alta_id IS NULL
          OR r.observaciones ILIKE '%aplicación%'
          OR r.observaciones ILIKE '%app%'
          OR r.observaciones ILIKE '%matchgo%'
        )
    ) AS reservas_app,
    -- Reservas creadas presencialmente en recepción por el staff:
    (
      SELECT COUNT(*)::INT
      FROM reservas r
      WHERE r.club_id = c.id
        AND r.estado <> 'cancelada'
        AND NOT (
          r.usuario_alta_id IS NULL
          OR r.observaciones ILIKE '%aplicación%'
          OR r.observaciones ILIKE '%app%'
          OR r.observaciones ILIKE '%matchgo%'
        )
    ) AS reservas_presenciales,
    -- Total Jugadores registrados en el club:
    (
      SELECT COUNT(*)::INT
      FROM jugadores j
      WHERE j.club_id = c.id AND j.activo = TRUE
    ) AS total_jugadores,
    -- Total Cobros por Reservas App MatchGo:
    (
      COALESCE((
        SELECT SUM(CASE WHEN rp.tipo = 'reembolso' THEN -rp.monto ELSE rp.monto END)
        FROM reserva_pagos rp
        JOIN reservas r ON r.id = rp.reserva_id
        WHERE rp.club_id = c.id
          AND (
            r.usuario_alta_id IS NULL
            OR r.observaciones ILIKE '%aplicación%'
            OR r.observaciones ILIKE '%app%'
            OR r.observaciones ILIKE '%matchgo%'
          )
      ), 0)
    )::DECIMAL(12,2) AS total_ventas_reservas_app
  FROM clubes c
  JOIN planes p ON p.id = c.plan_id
  ORDER BY c.nombre ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION clubes_resumen_plataforma() TO authenticated;

COMMIT;
