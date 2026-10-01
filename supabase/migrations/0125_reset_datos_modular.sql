-- ============================================================================
-- 0125_reset_datos_modular.sql
-- Reset granular / modular de datos de club. Permite al administrador elegir
-- específicamente qué módulos limpiar (reservas, buffet, clases, jugadores, finanzas, catálogo).
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_resetear_datos_club_modular(
  p_club_id BIGINT,
  p_reset_reservas BOOLEAN DEFAULT FALSE,
  p_reset_buffet BOOLEAN DEFAULT FALSE,
  p_reset_clases BOOLEAN DEFAULT FALSE,
  p_reset_jugadores BOOLEAN DEFAULT FALSE,
  p_reset_finanzas BOOLEAN DEFAULT FALSE,
  p_reset_productos BOOLEAN DEFAULT FALSE,
  p_reset_canchas BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_auth_id UUID;
  v_is_superadmin BOOLEAN := FALSE;
  v_is_club_admin BOOLEAN := FALSE;
  v_resumen JSONB := '{}'::JSONB;
BEGIN
  v_caller_auth_id := auth.uid();

  -- 1. Check si caller es superadmin
  IF v_caller_auth_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM plataforma_admins
      WHERE id = v_caller_auth_id AND activo = TRUE
    ) INTO v_is_superadmin;
  END IF;

  -- 2. Check si caller es admin del club
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

  -- ==========================================================================
  -- A. RESERVAS Y TURNOS
  -- ==========================================================================
  IF p_reset_reservas THEN
    DELETE FROM reserva_consumos WHERE club_id = p_club_id;
    DELETE FROM reserva_pagos WHERE club_id = p_club_id;
    DELETE FROM reserva_jugadores WHERE club_id = p_club_id;
    DELETE FROM reservas WHERE club_id = p_club_id;
    DELETE FROM turnos_fijos_bloqueos WHERE club_id = p_club_id;
    DELETE FROM turnos_fijos WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{reservas}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- B. BUFFET Y VENTAS / STOCK
  -- ==========================================================================
  IF p_reset_buffet THEN
    DELETE FROM venta_items WHERE club_id = p_club_id;
    DELETE FROM ventas WHERE club_id = p_club_id;
    DELETE FROM compra_items WHERE club_id = p_club_id;
    DELETE FROM compras WHERE club_id = p_club_id;
    DELETE FROM movimientos_stock WHERE club_id = p_club_id;
    DELETE FROM reserva_consumos WHERE club_id = p_club_id;
    DELETE FROM clase_consumos WHERE club_id = p_club_id;

    IF p_reset_productos THEN
      DELETE FROM productos WHERE club_id = p_club_id;
      DELETE FROM proveedores WHERE club_id = p_club_id;
      v_resumen := jsonb_set(v_resumen, '{productos}', 'true'::jsonb);
    END IF;

    v_resumen := jsonb_set(v_resumen, '{buffet}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- C. CLASES Y ALUMNOS
  -- ==========================================================================
  IF p_reset_clases THEN
    DELETE FROM clase_cobros WHERE club_id = p_club_id;
    DELETE FROM clase_consumos WHERE club_id = p_club_id;
    DELETE FROM clase_ocurrencia_alumnos WHERE club_id = p_club_id;
    DELETE FROM clase_alumnos_fijos WHERE club_id = p_club_id;
    DELETE FROM clase_ocurrencias WHERE club_id = p_club_id;
    DELETE FROM clases WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{clases}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- D. FINANZAS, GASTOS Y CAJAS
  -- ==========================================================================
  IF p_reset_finanzas THEN
    DELETE FROM gasto_cuotas WHERE club_id = p_club_id;
    DELETE FROM gastos WHERE club_id = p_club_id;
    DELETE FROM gastos_recurrentes WHERE club_id = p_club_id;
    DELETE FROM otros_ingresos WHERE club_id = p_club_id;
    DELETE FROM movimientos_caja WHERE club_id = p_club_id;
    DELETE FROM transferencias WHERE club_id = p_club_id;
    DELETE FROM movimientos_cuenta WHERE club_id = p_club_id;
    DELETE FROM turnos_caja WHERE club_id = p_club_id;
    DELETE FROM cajas WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{finanzas}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- E. JUGADORES
  -- ==========================================================================
  IF p_reset_jugadores THEN
    -- Desvincular referencias si quedan reservas o pagos activos
    UPDATE reserva_jugadores SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE reserva_pagos SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE reservas SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE clase_cobros SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE clase_ocurrencia_alumnos SET jugador_id = NULL WHERE club_id = p_club_id;
    UPDATE clase_alumnos_fijos SET jugador_id = NULL WHERE club_id = p_club_id;
    
    -- Eliminar movimientos de cuenta corriente si la tabla existe
    BEGIN
      DELETE FROM jugador_movimientos_cuenta WHERE club_id = p_club_id;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;

    DELETE FROM jugadores WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{jugadores}', 'true'::jsonb);
  END IF;

  -- ==========================================================================
  -- F. CANCHAS Y TARIFAS
  -- ==========================================================================
  IF p_reset_canchas THEN
    DELETE FROM franjas_turno WHERE club_id = p_club_id;
    DELETE FROM tarifas WHERE club_id = p_club_id;
    DELETE FROM canchas WHERE club_id = p_club_id;

    v_resumen := jsonb_set(v_resumen, '{canchas}', 'true'::jsonb);
  END IF;

  v_resumen := jsonb_set(v_resumen, '{ok}', 'true'::jsonb);
  RETURN v_resumen;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_resetear_datos_club_modular(BIGINT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

-- Mantener fn_resetear_datos_club como wrapper para compatibilidad
CREATE OR REPLACE FUNCTION fn_resetear_datos_club(
  p_club_id BIGINT,
  p_limpiar_catalogo BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN fn_resetear_datos_club_modular(
    p_club_id := p_club_id,
    p_reset_reservas := TRUE,
    p_reset_buffet := TRUE,
    p_reset_clases := TRUE,
    p_reset_jugadores := TRUE,
    p_reset_finanzas := TRUE,
    p_reset_productos := p_limpiar_catalogo,
    p_reset_canchas := p_limpiar_catalogo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_resetear_datos_club(BIGINT, BOOLEAN) TO authenticated;
