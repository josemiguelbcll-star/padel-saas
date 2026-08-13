-- ============================================================================
-- 0091_resetear_datos_club.sql
-- RPC para borrado masivo / reset de datos de prueba para un club nuevo o
-- en reconfiguración.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_resetear_datos_club(
  p_club_id BIGINT,
  p_limpiar_catalogo BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_is_superadmin BOOLEAN := FALSE;
  v_is_club_admin BOOLEAN := FALSE;
  v_resumen JSONB;
  
  v_cnt_reservas INT := 0;
  v_cnt_ventas INT := 0;
  v_cnt_compras INT := 0;
  v_cnt_gastos INT := 0;
  v_cnt_cajas INT := 0;
  v_cnt_clases INT := 0;
  v_cnt_turnos_fijos INT := 0;
  v_cnt_productos INT := 0;
  v_cnt_canchas INT := 0;
BEGIN
  v_caller_auth_id := auth.uid();

  -- Check si caller es superadmin
  IF v_caller_auth_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM plataforma_admins
      WHERE id = v_caller_auth_id AND activo = TRUE
    ) INTO v_is_superadmin;
  END IF;

  -- Check si caller es admin del club
  IF v_caller_auth_id IS NOT NULL AND NOT v_is_superadmin THEN
    SELECT EXISTS (
      SELECT 1 FROM usuarios
      WHERE id = v_caller_auth_id
        AND club_id = p_club_id
        AND rol = 'admin'
        AND activo = TRUE
    ) INTO v_is_club_admin;
  END IF;

  IF NOT v_is_superadmin AND NOT v_is_club_admin THEN
    RAISE EXCEPTION 'No autorizado para resetear datos de este club.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 1. Eliminar reservas y consumos/cobros
  SELECT COUNT(*) INTO v_cnt_reservas FROM reservas WHERE club_id = p_club_id;
  DELETE FROM reserva_consumos WHERE club_id = p_club_id;
  DELETE FROM reserva_cobros WHERE club_id = p_club_id;
  DELETE FROM reservas_jugadores WHERE club_id = p_club_id;
  DELETE FROM reservas WHERE club_id = p_club_id;

  -- 2. Eliminar ventas (buffet/shop) y movimientos de stock
  SELECT COUNT(*) INTO v_cnt_ventas FROM ventas WHERE club_id = p_club_id;
  DELETE FROM venta_items WHERE club_id = p_club_id;
  DELETE FROM ventas WHERE club_id = p_club_id;
  DELETE FROM movimientos_stock WHERE club_id = p_club_id;

  -- 3. Eliminar compras, gastos y otros ingresos
  SELECT COUNT(*) INTO v_cnt_compras FROM compras WHERE club_id = p_club_id;
  SELECT COUNT(*) INTO v_cnt_gastos FROM gastos WHERE club_id = p_club_id;
  DELETE FROM compra_items WHERE club_id = p_club_id;
  DELETE FROM compras WHERE club_id = p_club_id;
  DELETE FROM cuotas_gasto WHERE club_id = p_club_id;
  DELETE FROM gastos WHERE club_id = p_club_id;
  DELETE FROM gastos_recurrentes WHERE club_id = p_club_id;
  DELETE FROM otros_ingresos WHERE club_id = p_club_id;

  -- 4. Eliminar turnos fijos
  SELECT COUNT(*) INTO v_cnt_turnos_fijos FROM turnos_fijos WHERE club_id = p_club_id;
  DELETE FROM turnos_fijos_bloqueos WHERE club_id = p_club_id;
  DELETE FROM turnos_fijos WHERE club_id = p_club_id;

  -- 5. Eliminar clases y cobros
  SELECT COUNT(*) INTO v_cnt_clases FROM clases WHERE club_id = p_club_id;
  DELETE FROM clase_alumnos WHERE club_id = p_club_id;
  DELETE FROM clase_cobros WHERE club_id = p_club_id;
  DELETE FROM clases WHERE club_id = p_club_id;

  -- 6. Eliminar cajas, transferencias y movimientos de cuenta
  SELECT COUNT(*) INTO v_cnt_cajas FROM cajas WHERE club_id = p_club_id;
  DELETE FROM movimientos_caja WHERE club_id = p_club_id;
  DELETE FROM cajas WHERE club_id = p_club_id;
  DELETE FROM transferencias WHERE club_id = p_club_id;
  DELETE FROM movimientos_cuenta WHERE club_id = p_club_id;

  -- 7. Limpieza opcional de catálogo (productos, proveedores, tarifas, canchas)
  IF p_limpiar_catalogo THEN
    SELECT COUNT(*) INTO v_cnt_productos FROM productos WHERE club_id = p_club_id;
    SELECT COUNT(*) INTO v_cnt_canchas FROM canchas WHERE club_id = p_club_id;

    DELETE FROM productos WHERE club_id = p_club_id;
    DELETE FROM proveedores WHERE club_id = p_club_id;
    DELETE FROM tarifas WHERE club_id = p_club_id;
    DELETE FROM canchas WHERE club_id = p_club_id;
  END IF;

  v_resumen := jsonb_build_object(
    'ok', true,
    'reservas_borradas', v_cnt_reservas,
    'ventas_borradas', v_cnt_ventas,
    'compras_borradas', v_cnt_compras,
    'gastos_borrados', v_cnt_gastos,
    'cajas_borradas', v_cnt_cajas,
    'clases_borradas', v_cnt_clases,
    'turnos_fijos_borrados', v_cnt_turnos_fijos,
    'catalogo_limpiado', p_limpiar_catalogo,
    'productos_borrados', v_cnt_productos,
    'canchas_borradas', v_cnt_canchas
  );

  RETURN v_resumen;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_resetear_datos_club(BIGINT, BOOLEAN) TO authenticated;
