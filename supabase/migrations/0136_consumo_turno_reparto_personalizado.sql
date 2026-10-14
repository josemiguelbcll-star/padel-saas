-- Permite dividir un consumo entre una selección de 2 a 4 personas.
-- Las filas existentes conservan su comportamiento con el array vacío.
ALTER TABLE public.reserva_consumos
  ADD COLUMN reserva_jugadores_ids BIGINT[] NOT NULL DEFAULT '{}',
  ADD COLUMN solicitud_id UUID UNIQUE;

COMMENT ON COLUMN public.reserva_consumos.reserva_jugadores_ids IS
  'Personas seleccionadas para dividir este consumo en partes iguales. Vacío para repartos generales y asignaciones individuales históricas.';
COMMENT ON COLUMN public.reserva_consumos.solicitud_id IS
  'Clave de idempotencia opcional para incrementos manuales deliberados desde el detalle del turno.';

DROP FUNCTION public.fn_cargar_consumo_turno(BIGINT, BIGINT, INT, VARCHAR, BIGINT);

CREATE FUNCTION public.fn_cargar_consumo_turno(
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
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a un turno cerrado.';
  END IF;

  IF COALESCE(cardinality(p_reserva_jugadores_ids), 0) > 0 THEN
    IF p_reserva_jugador_id IS NOT NULL THEN
      RAISE EXCEPTION 'Elegí una persona individual o un grupo, no ambos.';
    END IF;

    IF COALESCE(p_tipo_reparto, 'general') <> 'general' THEN
      RAISE EXCEPTION 'El reparto personalizado debe ser general.';
    END IF;

    IF cardinality(p_reserva_jugadores_ids) NOT BETWEEN 2 AND 4 THEN
      RAISE EXCEPTION 'El reparto personalizado requiere entre 2 y 4 personas.';
    END IF;

    SELECT COUNT(DISTINCT persona_id)::INT
    INTO v_cantidad_personas
    FROM unnest(p_reserva_jugadores_ids) AS seleccion(persona_id);

    IF v_cantidad_personas <> cardinality(p_reserva_jugadores_ids) THEN
      RAISE EXCEPTION 'La selección de personas no puede tener duplicados ni valores vacíos.';
    END IF;

    SELECT COUNT(*)::INT
    INTO v_cantidad_personas
    FROM public.reserva_jugadores
    WHERE reserva_id = p_reserva_id
      AND club_id = v_club_id
      AND id = ANY(p_reserva_jugadores_ids);

    IF v_cantidad_personas <> cardinality(p_reserva_jugadores_ids) THEN
      RAISE EXCEPTION 'Todas las personas seleccionadas deben pertenecer a este turno.';
    END IF;

    SELECT ARRAY_AGG(persona_id ORDER BY persona_id)
    INTO v_personas_ids
    FROM unnest(p_reserva_jugadores_ids) AS seleccion(persona_id);
  END IF;

  SELECT * INTO v_producto
  FROM public.productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o está inactivo.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
  END IF;

  SELECT * INTO v_consumo
  FROM public.reserva_consumos
  WHERE solicitud_id = p_solicitud_id
    AND p_solicitud_id IS NOT NULL
    AND club_id = v_club_id
    AND reserva_id = p_reserva_id
  LIMIT 1;

  IF FOUND THEN
    RETURN v_consumo;
  END IF;

  SELECT * INTO v_consumo
  FROM public.reserva_consumos
  WHERE club_id = v_club_id
    AND reserva_id = p_reserva_id
    AND producto_id = v_producto.id
    AND cantidad = p_cantidad
    AND tipo_reparto = COALESCE(p_tipo_reparto, 'general')
    AND (
      (p_reserva_jugador_id IS NULL AND reserva_jugador_id IS NULL)
      OR reserva_jugador_id = p_reserva_jugador_id
    )
    AND reserva_jugadores_ids = v_personas_ids
    AND usuario_id = v_usuario_id
    AND p_solicitud_id IS NULL
    AND fecha_hora >= NOW() - INTERVAL '2 seconds'
  ORDER BY fecha_hora DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_consumo;
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM public.movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  IF p_reserva_jugador_id IS NOT NULL THEN
    SELECT jugador_id INTO v_jugador_id
    FROM public.reserva_jugadores
    WHERE id = p_reserva_jugador_id
      AND reserva_id = p_reserva_id
      AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La persona indicada no pertenece a este turno.';
    END IF;
    v_tipo_reparto_final := 'individual';
  ELSE
    v_tipo_reparto_final := COALESCE(p_tipo_reparto, 'general');
    IF v_tipo_reparto_final NOT IN ('general', 'partido') THEN
      v_tipo_reparto_final := 'general';
    END IF;
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

CREATE OR REPLACE FUNCTION public.fn_prevenir_borrar_persona_con_consumo_asignado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reserva_consumos
    WHERE club_id = OLD.club_id
      AND reserva_id = OLD.reserva_id
      AND (
        reserva_jugador_id = OLD.id
        OR OLD.id = ANY(reserva_jugadores_ids)
      )
  ) THEN
    RAISE EXCEPTION 'No se puede quitar a esta persona: tiene consumos asignados. Quitá primero esos consumos.';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER reserva_jugadores_consumos_asignados_delete
  BEFORE DELETE ON public.reserva_jugadores
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevenir_borrar_persona_con_consumo_asignado();