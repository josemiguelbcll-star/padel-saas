-- ============================================================================
-- Migración 0159: Permitir al admin editar el arqueo de caja (efectivo contado y observaciones)
--                 y reabrir turnos de caja cerrados
-- ============================================================================
BEGIN;

-- 1. RPC: fn_editar_arqueo_caja
CREATE OR REPLACE FUNCTION public.fn_editar_arqueo_caja(
  p_turno_caja_id BIGINT,
  p_nuevo_contado DECIMAL(12,2),
  p_nuevas_observaciones TEXT DEFAULT NULL
)
RETURNS public.turnos_caja
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno public.turnos_caja;
  v_diferencia DECIMAL(12,2);
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede editar el arqueo de caja.';
  END IF;

  IF p_nuevo_contado IS NULL OR p_nuevo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado no puede ser nulo ni negativo.';
  END IF;

  SELECT * INTO v_turno
  FROM public.turnos_caja
  WHERE id = p_turno_caja_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno de caja no encontrado.';
  END IF;

  IF v_turno.cerrada_en IS NULL THEN
    RAISE EXCEPTION 'No se puede editar el arqueo de un turno de caja que aún no fue cerrado.';
  END IF;

  v_diferencia := p_nuevo_contado - v_turno.efectivo_esperado;

  UPDATE public.turnos_caja
  SET
    efectivo_contado = p_nuevo_contado,
    diferencia = v_diferencia,
    observaciones_cierre = p_nuevas_observaciones
  WHERE id = p_turno_caja_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION public.fn_editar_arqueo_caja(BIGINT, DECIMAL, TEXT) IS
  'Permite al administrador corregir el efectivo contado y las observaciones de un arqueo de caja ya cerrado, recalculando la diferencia.';

GRANT EXECUTE ON FUNCTION public.fn_editar_arqueo_caja(BIGINT, DECIMAL, TEXT) TO authenticated;

-- 2. RPC: fn_reabrir_turno_caja
CREATE OR REPLACE FUNCTION public.fn_reabrir_turno_caja(p_turno_caja_id BIGINT)
RETURNS public.turnos_caja
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno public.turnos_caja;
  v_hay_abierta BOOLEAN;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede reabrir un turno de caja.';
  END IF;

  SELECT * INTO v_turno
  FROM public.turnos_caja
  WHERE id = p_turno_caja_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno de caja no encontrado.';
  END IF;

  IF v_turno.cerrada_en IS NULL THEN
    RAISE EXCEPTION 'Este turno de caja ya se encuentra abierto.';
  END IF;

  -- Validar si ya existe otro turno de caja abierto en el club para esa modalidad
  IF v_turno.modalidad = 'por_dia' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.turnos_caja
      WHERE club_id = v_club_id
        AND modalidad = 'por_dia'
        AND cerrada_en IS NULL
    ) INTO v_hay_abierta;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.turnos_caja
      WHERE club_id = v_club_id
        AND modalidad = 'por_vendedor'
        AND vendedor_id = v_turno.vendedor_id
        AND cerrada_en IS NULL
    ) INTO v_hay_abierta;
  END IF;

  IF v_hay_abierta THEN
    RAISE EXCEPTION 'Ya existe una caja abierta actualmente. Cerrá la caja actual antes de reabrir este turno.';
  END IF;

  -- Reabrir reseteando los datos de cierre
  UPDATE public.turnos_caja
  SET
    cerrada_en = NULL,
    usuario_cierre = NULL,
    efectivo_esperado = NULL,
    efectivo_contado = NULL,
    diferencia = NULL,
    observaciones_cierre = NULL
  WHERE id = p_turno_caja_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION public.fn_reabrir_turno_caja(BIGINT) IS
  'Permite al administrador volver a abrir un turno de caja cerrado si no hay otra caja abierta activa.';

GRANT EXECUTE ON FUNCTION public.fn_reabrir_turno_caja(BIGINT) TO authenticated;

COMMIT;
