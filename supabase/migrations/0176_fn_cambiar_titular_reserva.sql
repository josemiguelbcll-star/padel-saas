-- ============================================================================
-- 0176_fn_cambiar_titular_reserva.sql
-- Permite corregir el titular de una reserva existente.
--
-- El titular vive en DOS lugares que deben quedar coherentes:
--   1. reservas.jugador_id            → titular/"dueño" (grilla, WhatsApp).
--   2. reserva_jugadores.es_titular   → persona del turno que ARRSTRA la
--      cuota del alquiler, los pagos por persona (reserva_jugador_id) y los
--      consumos repartidos. Por eso NO se borra y recrea la fila: se
--      actualiza SU identidad in-place y se conserva su id → pagos,
--      cuota_fija y repartos quedan intactos.
--
-- Soporta titular con ficha (jugador_id) o nombre libre, igual que la
-- creación. Si la reserva no tiene fila titular (datos legacy), la crea.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cambiar_titular_reserva(
  p_reserva_id BIGINT,
  p_jugador_id BIGINT DEFAULT NULL,
  p_nombre_libre TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_reserva record;
  v_nombre_libre TEXT;
  v_filas INT;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar')
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cambiar el titular de una reserva.';
  END IF;

  v_nombre_libre := NULLIF(TRIM(COALESCE(p_nombre_libre, '')), '');

  IF p_jugador_id IS NULL AND v_nombre_libre IS NULL THEN
    RAISE EXCEPTION 'Elegí un titular: una ficha de jugador o un nombre.';
  END IF;

  SELECT id, club_id, estado INTO v_reserva
  FROM public.reservas
  WHERE id = p_reserva_id;

  IF v_reserva.id IS NULL OR v_reserva.club_id <> v_club_id THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cambiar el titular de una reserva cancelada.';
  END IF;

  -- Si viene ficha, validar que el jugador exista en el club.
  IF p_jugador_id IS NOT NULL THEN
    PERFORM 1 FROM public.jugadores
    WHERE id = p_jugador_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El jugador elegido no existe o no pertenece a tu club.';
    END IF;

    -- El nuevo titular no puede estar ya como acompañante/jugador del
    -- mismo turno (quedaría duplicado). Hay que quitarlo primero.
    IF EXISTS (
      SELECT 1 FROM public.reserva_jugadores
      WHERE reserva_id = p_reserva_id
        AND es_titular = FALSE
        AND jugador_id = p_jugador_id
    ) THEN
      RAISE EXCEPTION 'Ese jugador ya está en el turno como acompañante. Quitalo primero para asignarlo como titular.';
    END IF;
  END IF;

  -- Actualizar la fila titular existente (conserva id → pagos/cuotas).
  UPDATE public.reserva_jugadores
  SET
    jugador_id = p_jugador_id,
    nombre_libre = CASE WHEN p_jugador_id IS NOT NULL THEN NULL ELSE v_nombre_libre END,
    tipo = 'jugador'
  WHERE reserva_id = p_reserva_id
    AND es_titular = TRUE;

  GET DIAGNOSTICS v_filas = ROW_COUNT;

  -- Reserva legacy sin fila titular: crearla.
  IF v_filas = 0 THEN
    INSERT INTO public.reserva_jugadores (
      club_id, reserva_id, jugador_id, nombre_libre, es_titular, tipo
    ) VALUES (
      v_club_id, p_reserva_id, p_jugador_id,
      CASE WHEN p_jugador_id IS NOT NULL THEN NULL ELSE v_nombre_libre END,
      TRUE, 'jugador'
    );
  END IF;

  -- Reservas.jugador_id = titular de la reserva (grilla, WhatsApp).
  -- NULL cuando el titular es nombre libre.
  UPDATE public.reservas
  SET jugador_id = p_jugador_id
  WHERE id = p_reserva_id;

  RETURN jsonb_build_object(
    'reserva_id', p_reserva_id,
    'jugador_id', p_jugador_id,
    'nombre_libre', CASE WHEN p_jugador_id IS NOT NULL THEN NULL ELSE v_nombre_libre END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cambiar_titular_reserva(BIGINT, BIGINT, TEXT) TO authenticated;

COMMIT;
