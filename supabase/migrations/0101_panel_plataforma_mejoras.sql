-- ============================================================================
-- 0101_panel_plataforma_mejoras.sql
-- Panel de Plataforma — Mejoras: ventas, editar info, y eliminar club.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. REDEFINICIÓN: clubes_resumen_plataforma()
--    Agrega slug, total_ventas_historico, total_ventas_mes_actual.
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
  total_ventas_mes_actual DECIMAL(12,2)
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
    )::DECIMAL(12,2)
  FROM clubes c
  JOIN planes p ON p.id = c.plan_id
  ORDER BY c.nombre ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION clubes_resumen_plataforma() TO authenticated;


-- ============================================================================
-- 2. RPC: fn_editar_club_info(p_club_id, p_nombre, p_slug)
--    Permite editar nombre y slug del club (gate superadmin).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_editar_club_info(
  p_club_id BIGINT,
  p_nombre VARCHAR,
  p_slug VARCHAR
)
RETURNS clubes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club clubes;
BEGIN
  -- Gate
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  -- Validar unique slug
  IF EXISTS (
    SELECT 1 FROM clubes WHERE slug = p_slug AND id != p_club_id
  ) THEN
    RAISE EXCEPTION 'Ya existe un club con ese slug.';
  END IF;

  -- Validar formato del slug
  IF p_slug !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'El slug debe contener solo letras minúsculas, números y guiones.';
  END IF;

  UPDATE clubes
  SET nombre = p_nombre,
      slug = p_slug
  WHERE id = p_club_id
  RETURNING * INTO v_club;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Club no encontrado.';
  END IF;

  RETURN v_club;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_editar_club_info(BIGINT, VARCHAR, VARCHAR) TO authenticated;


-- ============================================================================
-- 3. RPC: fn_eliminar_club_plataforma(p_club_id)
--    Elimina permanentemente un club y toda su información operativa y usuarios.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_eliminar_club_plataforma(
  p_club_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gate
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  -- 1. Eliminar datos operativos
  DELETE FROM reserva_consumos WHERE club_id = p_club_id;
  DELETE FROM reserva_cobros WHERE club_id = p_club_id;
  DELETE FROM reserva_pagos WHERE club_id = p_club_id;
  DELETE FROM reservas_jugadores WHERE club_id = p_club_id;
  DELETE FROM reservas WHERE club_id = p_club_id;
  
  DELETE FROM venta_items WHERE club_id = p_club_id;
  DELETE FROM ventas WHERE club_id = p_club_id;
  DELETE FROM movimientos_stock WHERE club_id = p_club_id;
  
  DELETE FROM compra_items WHERE club_id = p_club_id;
  DELETE FROM compras WHERE club_id = p_club_id;
  DELETE FROM cuotas_gasto WHERE club_id = p_club_id;
  DELETE FROM gasto_cuotas WHERE club_id = p_club_id;
  DELETE FROM gastos WHERE club_id = p_club_id;
  DELETE FROM gastos_recurrentes WHERE club_id = p_club_id;
  DELETE FROM otros_ingresos WHERE club_id = p_club_id;
  
  DELETE FROM turnos_fijos_bloqueos WHERE club_id = p_club_id;
  DELETE FROM turnos_fijos WHERE club_id = p_club_id;
  
  DELETE FROM clase_alumnos WHERE club_id = p_club_id;
  DELETE FROM clase_cobros WHERE club_id = p_club_id;
  DELETE FROM clases WHERE club_id = p_club_id;
  DELETE FROM profesores WHERE club_id = p_club_id;
  
  DELETE FROM movimientos_caja WHERE club_id = p_club_id;
  DELETE FROM turnos_caja WHERE club_id = p_club_id;
  DELETE FROM transferencias WHERE club_id = p_club_id;
  DELETE FROM movimientos_cuenta WHERE club_id = p_club_id;
  DELETE FROM medio_cuenta_default WHERE club_id = p_club_id;
  DELETE FROM cuentas WHERE club_id = p_club_id;
  
  DELETE FROM unidades_negocio WHERE club_id = p_club_id;
  DELETE FROM categorias_gasto WHERE club_id = p_club_id;
  DELETE FROM productos WHERE club_id = p_club_id;
  DELETE FROM proveedores WHERE club_id = p_club_id;
  DELETE FROM tarifas WHERE club_id = p_club_id;
  DELETE FROM canchas WHERE club_id = p_club_id;
  DELETE FROM franjas_turno WHERE club_id = p_club_id;
  DELETE FROM anulaciones WHERE club_id = p_club_id;
  
  DELETE FROM club_fotos WHERE club_id = p_club_id;
  DELETE FROM noticias_feed WHERE club_id = p_club_id;
  DELETE FROM club_posts WHERE club_id = p_club_id;
  DELETE FROM promociones WHERE club_id = p_club_id;
  DELETE FROM desafios WHERE club_id = p_club_id;
  DELETE FROM jugador_app_club_link WHERE club_id = p_club_id;
  DELETE FROM club_mercadopago_config WHERE club_id = p_club_id;
  DELETE FROM club_perfil_publico WHERE club_id = p_club_id;

  -- 2. Eliminar de auth.users (cascada a usuarios)
  DELETE FROM auth.users WHERE id IN (SELECT id FROM usuarios WHERE club_id = p_club_id);
  DELETE FROM usuarios WHERE club_id = p_club_id;

  -- 3. Eliminar club
  DELETE FROM clubes WHERE id = p_club_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_eliminar_club_plataforma(BIGINT) TO authenticated;

COMMIT;
