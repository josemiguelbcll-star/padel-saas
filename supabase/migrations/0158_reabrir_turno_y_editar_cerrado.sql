-- ============================================================================
-- Migración 0158: Permitir a administradores reabrir turnos cerrados
--                 y permitir a administradores editar consumos en turnos cerrados
-- ============================================================================
BEGIN;

-- 1. RPC: fn_reabrir_turno
CREATE OR REPLACE FUNCTION public.fn_reabrir_turno(p_reserva_id BIGINT)
RETURNS public.reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_reserva public.reservas;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador del club puede reabrir un turno cerrado.';
  END IF;

  SELECT * INTO v_reserva
  FROM public.reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede reabrir un turno cancelado.';
  END IF;

  IF v_reserva.cerrado_en IS NULL THEN
    RAISE EXCEPTION 'El turno no está cerrado.';
  END IF;

  UPDATE public.reservas
  SET cerrado_en = NULL
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION public.fn_reabrir_turno(BIGINT) IS
  'Permite al administrador del club volver a abrir un turno que ya había sido cerrado, permitiendo realizar ediciones, correcciones y cobros adicionales.';

GRANT EXECUTE ON FUNCTION public.fn_reabrir_turno(BIGINT) TO authenticated;

-- 2. Actualizar fn_cargar_consumo_turno para permitir al admin cargar consumos incluso si cerrado_en IS NOT NULL
CREATE OR REPLACE FUNCTION public.fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR DEFAULT 'general',
  p_reserva_jugador_id BIGINT DEFAULT NULL,
  p_reserva_jugadores_ids BIGINT[] DEFAULT NULL,
  p_solicitud_id UUID DEFAULT NULL
)
RETURNS public.reserva_consumos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva public.reservas;
  v_producto public.productos;
  v_consumo public.reserva_consumos;
  v_jugador_id BIGINT := NULL;
  v_tipo_reparto_final VARCHAR;
  v_stock INT;
  v_personas_ids BIGINT[] := '{}';
  v_cantidad_personas INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar')
     AND NOT has_user_permission('mostrador', 'editar')
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cargar consumos al turno.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_reserva
  FROM public.reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  -- ⭐ Si el turno está cerrado, SOLO el admin puede cargar consumos
  IF v_reserva.cerrado_en IS NOT NULL AND current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a un turno cerrado.';
  END IF;

  SELECT * INTO v_producto
  FROM public.productos
  WHERE id = p_producto_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto está inactivo.';
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM public.movimientos_stock
  WHERE producto_id = p_producto_id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  IF p_solicitud_id IS NOT NULL THEN
    SELECT * INTO v_consumo
    FROM public.reserva_consumos
    WHERE solicitud_id = p_solicitud_id;

    IF FOUND THEN
      RETURN v_consumo;
    END IF;
  END IF;

  v_tipo_reparto_final := COALESCE(p_tipo_reparto, 'general');

  IF p_reserva_jugador_id IS NOT NULL THEN
    SELECT jugador_id INTO v_jugador_id
    FROM public.reserva_jugadores
    WHERE id = p_reserva_jugador_id
      AND reserva_id = p_reserva_id
      AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La persona no pertenece a esta reserva.';
    END IF;
  END IF;

  IF p_reserva_jugadores_ids IS NOT NULL AND cardinality(p_reserva_jugadores_ids) > 0 THEN
    SELECT COUNT(*)::INT INTO v_cantidad_personas
    FROM public.reserva_jugadores
    WHERE id = ANY(p_reserva_jugadores_ids)
      AND reserva_id = p_reserva_id
      AND club_id = v_club_id;

    IF v_cantidad_personas <> cardinality(p_reserva_jugadores_ids) THEN
      RAISE EXCEPTION 'Una o más personas no pertenecen a esta reserva.';
    END IF;

    v_personas_ids := p_reserva_jugadores_ids;
  END IF;

  INSERT INTO public.reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto, linea,
    reserva_jugador_id, jugador_id, reserva_jugadores_ids, solicitud_id
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    v_tipo_reparto_final, v_producto.linea,
    p_reserva_jugador_id, v_jugador_id, v_personas_ids, p_solicitud_id
  )
  RETURNING * INTO v_consumo;

  INSERT INTO public.movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_turno',
    NULL, v_consumo.id, v_usuario_id
  );

  RETURN v_consumo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cargar_consumo_turno(
  BIGINT, BIGINT, INT, VARCHAR, BIGINT, BIGINT[], UUID
) TO authenticated;

-- 3. Actualizar fn_quitar_consumo_turno para permitir al admin quitar consumos en turno cerrado
CREATE OR REPLACE FUNCTION public.fn_quitar_consumo_turno(
  p_consumo_id BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_consumo public.reserva_consumos;
  v_reserva public.reservas;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') 
     AND NOT has_user_permission('mostrador', 'editar') 
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para quitar consumos del turno.';
  END IF;

  SELECT * INTO v_consumo
  FROM public.reserva_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe o no pertenece a tu club.';
  END IF;

  SELECT * INTO v_reserva
  FROM public.reservas
  WHERE id = v_consumo.reserva_id;

  -- ⭐ Si el turno está cerrado, SOLO el admin puede quitar consumos
  IF v_reserva.cerrado_en IS NOT NULL AND current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'No se pueden quitar consumos de un turno cerrado.';
  END IF;

  INSERT INTO public.movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo',
    NULL, NULL,
    format('Reposición por quitado del consumo #%s del turno #%s',
           v_consumo.id, v_consumo.reserva_id),
    v_usuario_id
  );

  DELETE FROM public.reserva_consumos WHERE id = p_consumo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_quitar_consumo_turno(BIGINT) TO authenticated;

COMMIT;
