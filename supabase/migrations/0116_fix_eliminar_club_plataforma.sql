-- ==============================================================================
-- MIGRACIÓN 0116: Fix fn_eliminar_club_plataforma y fn_resetear_datos_club
-- ==============================================================================

-- 1. Redefinir fn_eliminar_club_plataforma con orden estricto de claves foráneas
CREATE OR REPLACE FUNCTION public.fn_eliminar_club_plataforma(
  p_club_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gate de seguridad: solo administradores de plataforma
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  -- 1. Eliminar datos transaccionales de reservas
  DELETE FROM public.reserva_consumos WHERE club_id = p_club_id;
  DELETE FROM public.reserva_pagos WHERE club_id = p_club_id;
  DELETE FROM public.reservas WHERE club_id = p_club_id;
  DELETE FROM public.turnos_fijos WHERE club_id = p_club_id;
  
  -- 2. Eliminar jugadores registrados del club y sus links
  DELETE FROM public.jugadores WHERE club_id = p_club_id;
  DELETE FROM public.jugador_app_club_link WHERE club_id = p_club_id;

  -- 3. Ventas y stock
  DELETE FROM public.venta_items WHERE club_id = p_club_id;
  DELETE FROM public.ventas WHERE club_id = p_club_id;
  DELETE FROM public.movimientos_stock WHERE club_id = p_club_id;
  
  -- 4. Compras y gastos (primero cuotas, luego gastos)
  DELETE FROM public.compra_items WHERE club_id = p_club_id;
  DELETE FROM public.compras WHERE club_id = p_club_id;
  DELETE FROM public.gasto_cuotas WHERE club_id = p_club_id;
  DELETE FROM public.gastos WHERE club_id = p_club_id;
  DELETE FROM public.gastos_recurrentes WHERE club_id = p_club_id;
  DELETE FROM public.otros_ingresos WHERE club_id = p_club_id;
  
  -- 5. Clases y profesores
  DELETE FROM public.clase_cobros WHERE club_id = p_club_id;
  DELETE FROM public.clases WHERE club_id = p_club_id;
  DELETE FROM public.profesores WHERE club_id = p_club_id;
  
  -- 6. Caja y transferencias
  DELETE FROM public.turnos_caja WHERE club_id = p_club_id;
  DELETE FROM public.transferencias WHERE club_id = p_club_id;
  DELETE FROM public.medio_cuenta_default WHERE club_id = p_club_id;
  DELETE FROM public.cuentas WHERE club_id = p_club_id;
  
  -- 7. Catálogos: PRIMERO categorias_gasto, LUEGO unidades_negocio
  DELETE FROM public.categorias_gasto WHERE club_id = p_club_id;
  DELETE FROM public.unidades_negocio WHERE club_id = p_club_id;
  
  DELETE FROM public.productos WHERE club_id = p_club_id;
  DELETE FROM public.proveedores WHERE club_id = p_club_id;
  DELETE FROM public.tarifas WHERE club_id = p_club_id;
  DELETE FROM public.franjas_turno WHERE club_id = p_club_id;
  DELETE FROM public.canchas WHERE club_id = p_club_id;
  DELETE FROM public.anulaciones WHERE club_id = p_club_id;
  
  -- 8. Social, fotos, posts y mercadopago
  DELETE FROM public.club_fotos WHERE club_id = p_club_id;
  DELETE FROM public.noticias_feed WHERE club_id = p_club_id;
  DELETE FROM public.club_posts WHERE club_id = p_club_id;
  DELETE FROM public.promociones WHERE club_id = p_club_id;
  DELETE FROM public.desafios WHERE club_id = p_club_id;
  DELETE FROM public.club_mercadopago_config WHERE club_id = p_club_id;

  -- 9. Usuarios del club y auth
  DELETE FROM auth.users WHERE id IN (SELECT id FROM public.usuarios WHERE club_id = p_club_id);
  DELETE FROM public.usuarios WHERE club_id = p_club_id;

  -- 10. Eliminar el club
  DELETE FROM public.clubes WHERE id = p_club_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_eliminar_club_plataforma(BIGINT) TO authenticated;


-- 2. Redefinir fn_resetear_datos_club con orden estricto
CREATE OR REPLACE FUNCTION public.fn_resetear_datos_club(
  p_club_id BIGINT,
  p_limpiar_catalogo BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gate: debe ser admin del club o admin de plataforma
  IF NOT current_user_is_plataforma_admin() AND NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND club_id = p_club_id AND rol IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'No autorizado para resetear los datos del club.';
  END IF;

  -- 1. Tablas transaccionales
  DELETE FROM public.reserva_consumos WHERE club_id = p_club_id;
  DELETE FROM public.reserva_pagos WHERE club_id = p_club_id;
  DELETE FROM public.reservas WHERE club_id = p_club_id;
  DELETE FROM public.turnos_fijos WHERE club_id = p_club_id;
  
  DELETE FROM public.venta_items WHERE club_id = p_club_id;
  DELETE FROM public.ventas WHERE club_id = p_club_id;
  DELETE FROM public.movimientos_stock WHERE club_id = p_club_id;
  
  DELETE FROM public.compra_items WHERE club_id = p_club_id;
  DELETE FROM public.compras WHERE club_id = p_club_id;
  DELETE FROM public.gasto_cuotas WHERE club_id = p_club_id;
  DELETE FROM public.gastos WHERE club_id = p_club_id;
  DELETE FROM public.gastos_recurrentes WHERE club_id = p_club_id;
  DELETE FROM public.otros_ingresos WHERE club_id = p_club_id;
  
  DELETE FROM public.clase_cobros WHERE club_id = p_club_id;
  DELETE FROM public.clases WHERE club_id = p_club_id;
  
  DELETE FROM public.turnos_caja WHERE club_id = p_club_id;
  DELETE FROM public.transferencias WHERE club_id = p_club_id;
  DELETE FROM public.anulaciones WHERE club_id = p_club_id;

  -- 2. Catálogo opcional
  IF p_limpiar_catalogo THEN
    DELETE FROM public.jugadores WHERE club_id = p_club_id;
    DELETE FROM public.productos WHERE club_id = p_club_id;
    DELETE FROM public.proveedores WHERE club_id = p_club_id;
    DELETE FROM public.tarifas WHERE club_id = p_club_id;
    DELETE FROM public.canchas WHERE club_id = p_club_id;
    DELETE FROM public.categorias_gasto WHERE club_id = p_club_id;
    DELETE FROM public.unidades_negocio WHERE club_id = p_club_id;
    DELETE FROM public.profesores WHERE club_id = p_club_id;
    DELETE FROM public.cuentas WHERE club_id = p_club_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'club_id', p_club_id,
    'catalogo_limpiado', p_limpiar_catalogo
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_resetear_datos_club(BIGINT, BOOLEAN) TO authenticated;
