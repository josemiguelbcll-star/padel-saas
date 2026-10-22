-- ============================================================================
-- 0142_tarifas_clases_por_profesor.sql
--
-- Las tarifas de alquiler para clases quedan asociadas a un profesor.
-- Las tarifas legadas sin profesor se conservan, pero no se usan como fallback.
-- ============================================================================

BEGIN;

ALTER TABLE public.profesores
  ADD CONSTRAINT profesores_id_club_unique UNIQUE (id, club_id);

ALTER TABLE public.tarifas_clases
  ADD COLUMN profesor_id BIGINT;

ALTER TABLE public.tarifas_clases
  ADD CONSTRAINT tarifas_clases_profesor_requerido
  CHECK (profesor_id IS NOT NULL) NOT VALID;

ALTER TABLE public.tarifas_clases
  ADD CONSTRAINT tarifas_clases_profesor_club_fk
  FOREIGN KEY (profesor_id, club_id)
  REFERENCES public.profesores (id, club_id);

COMMENT ON COLUMN public.tarifas_clases.profesor_id IS
  'Profesor al que pertenece esta tarifa. Las filas históricas sin profesor
   se conservan, pero no aplican al resolver tarifas de clases.';

CREATE INDEX idx_tarifas_clases_profesor_resolucion
  ON public.tarifas_clases (club_id, profesor_id, vigente_desde)
  WHERE activa = TRUE;

DROP FUNCTION IF EXISTS public.fn_crear_tarifa_clase(
  VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
);

CREATE FUNCTION public.fn_crear_tarifa_clase(
  p_profesor_id BIGINT,
  p_nombre VARCHAR,
  p_monto DECIMAL,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT 0,
  p_vigente_desde DATE DEFAULT NULL
)
RETURNS public.tarifas_clases
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_tarifa public.tarifas_clases;
  v_vigente_desde DATE;
  v_new_id BIGINT;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear tarifas de clases.';
  END IF;
  IF p_profesor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profesores
    WHERE id = p_profesor_id
      AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION 'Elegí un profesor de tu club para la tarifa.';
  END IF;
  IF p_nombre IS NULL OR LENGTH(TRIM(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  v_vigente_desde := COALESCE(p_vigente_desde, CURRENT_DATE);
  v_new_id := nextval('public.tarifas_clases_id_seq');

  INSERT INTO public.tarifas_clases (
    id, club_id, profesor_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa, vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_new_id, v_club_id, p_profesor_id, TRIM(p_nombre), p_monto,
    p_desde_hora, p_hasta_hora, p_dias_semana, p_prioridad, TRUE,
    v_vigente_desde, NULL, v_new_id
  )
  RETURNING * INTO v_tarifa;

  RETURN v_tarifa;
END;
$$;

COMMENT ON FUNCTION public.fn_crear_tarifa_clase(
  BIGINT, VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
) IS
  'Crea una franja de alquiler de clase para un profesor del club. Usa
   nextval para mantener id = lineage_id en un único INSERT.';

GRANT EXECUTE ON FUNCTION public.fn_crear_tarifa_clase(
  BIGINT, VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_cambiar_precio_tarifa_clase(
  p_lineage_id BIGINT,
  p_monto_nuevo DECIMAL,
  p_vigente_desde DATE
)
RETURNS public.tarifas_clases
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_actual public.tarifas_clases;
  v_nueva public.tarifas_clases;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar precios.';
  END IF;
  IF p_monto_nuevo IS NULL OR p_monto_nuevo <= 0 THEN
    RAISE EXCEPTION 'El monto nuevo debe ser mayor a 0.';
  END IF;
  IF p_vigente_desde IS NULL THEN
    RAISE EXCEPTION 'La fecha desde la que rige el precio nuevo es obligatoria.';
  END IF;
  IF p_vigente_desde < CURRENT_DATE THEN
    RAISE EXCEPTION
      'La fecha debe ser hoy o futura (no se permite reescribir historia).';
  END IF;

  SELECT * INTO v_actual
  FROM public.tarifas_clases
  WHERE club_id = v_club_id
    AND lineage_id = p_lineage_id
    AND vigente_desde <= p_vigente_desde
    AND (vigente_hasta IS NULL OR vigente_hasta >= p_vigente_desde)
  ORDER BY vigente_desde DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No hay versión del linaje % vigente en la fecha %. Verificá el linaje y la fecha.',
      p_lineage_id, p_vigente_desde;
  END IF;
  IF v_actual.profesor_id IS NULL THEN
    RAISE EXCEPTION
      'Esta tarifa histórica no está asociada a un profesor y no se puede versionar.';
  END IF;
  IF v_actual.monto = p_monto_nuevo THEN
    RAISE EXCEPTION
      'El precio nuevo es igual al actual ($%). No tiene sentido versionar.',
      v_actual.monto;
  END IF;
  IF v_actual.vigente_desde = p_vigente_desde THEN
    RAISE EXCEPTION
      'Ya hay una versión vigente desde el % con monto $%. Para corregirla, cancelá el aumento programado.',
      v_actual.vigente_desde, v_actual.monto;
  END IF;

  UPDATE public.tarifas_clases
  SET vigente_hasta = p_vigente_desde - 1
  WHERE id = v_actual.id;

  INSERT INTO public.tarifas_clases (
    club_id, profesor_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa, vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_club_id, v_actual.profesor_id, v_actual.nombre, p_monto_nuevo,
    v_actual.desde_hora, v_actual.hasta_hora, v_actual.dias_semana,
    v_actual.prioridad, v_actual.activa, p_vigente_desde, NULL, p_lineage_id
  )
  RETURNING * INTO v_nueva;

  RETURN v_nueva;
END;
$$;

COMMENT ON FUNCTION public.fn_cambiar_precio_tarifa_clase(
  BIGINT, DECIMAL, DATE
) IS
  'Versiona atómicamente una franja de clase preservando su profesor y
   metadata. Rechaza tarifas históricas sin profesor.';

GRANT EXECUTE ON FUNCTION public.fn_cambiar_precio_tarifa_clase(
  BIGINT, DECIMAL, DATE
) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_resolver_tarifa_clase(
  p_fecha DATE,
  p_hora TIME,
  p_profesor_id BIGINT
)
RETURNS TABLE (tarifa_id BIGINT, monto DECIMAL(12,2))
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_profesor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.id, t.monto
  FROM public.tarifas_clases t
  WHERE t.club_id = current_club_id()
    AND t.profesor_id = p_profesor_id
    AND t.activa = TRUE
    AND t.vigente_desde <= p_fecha
    AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= p_fecha)
    AND (
      t.dias_semana IS NULL
      OR EXTRACT(ISODOW FROM p_fecha)::INT = ANY(t.dias_semana)
    )
    AND (
      (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
      OR (p_hora >= t.desde_hora AND p_hora < t.hasta_hora)
    )
  ORDER BY t.prioridad DESC, t.id DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.fn_resolver_tarifa_clase(DATE, TIME, BIGINT) IS
  'Resuelve el alquiler de cancha para la tarifa del profesor indicado.
   No usa tarifas sin profesor como fallback.';

GRANT EXECUTE ON FUNCTION public.fn_resolver_tarifa_clase(DATE, TIME, BIGINT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_cobrar_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS public.clase_cobros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clase public.clases;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cobro public.clase_cobros;
  v_turno_caja_id BIGINT := NULL;
  v_tarifa_resuelta RECORD;
  v_monto DECIMAL(12,2);
  v_dia_nombre TEXT;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica INTO v_es_caja
    FROM public.cuentas
    WHERE id = p_cuenta_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
    FROM public.medio_cuenta_default mcd
    JOIN public.cuentas c ON c.id = mcd.cuenta_id
    WHERE mcd.club_id = v_club_id
      AND mcd.medio_pago = p_medio_pago;
  END IF;
  v_es_caja := COALESCE(v_es_caja, FALSE);

  IF v_es_caja THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  SELECT * INTO v_clase
  FROM public.clases
  WHERE id = p_clase_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece a tu club.';
  END IF;
  IF NOT (EXTRACT(ISODOW FROM p_fecha)::INT = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION
      'La clase no se dicta el % — revisá los días configurados.', p_fecha;
  END IF;

  SELECT tarifa_id, monto INTO v_tarifa_resuelta
  FROM public.fn_resolver_tarifa_clase(
    p_fecha, v_clase.hora_inicio, v_clase.profesor_id
  );

  IF v_tarifa_resuelta.tarifa_id IS NULL THEN
    v_dia_nombre := CASE EXTRACT(ISODOW FROM p_fecha)::INT
      WHEN 1 THEN 'lunes'
      WHEN 2 THEN 'martes'
      WHEN 3 THEN 'miércoles'
      WHEN 4 THEN 'jueves'
      WHEN 5 THEN 'viernes'
      WHEN 6 THEN 'sábados'
      WHEN 7 THEN 'domingos'
    END;
    RAISE EXCEPTION
      'No hay tarifa configurada para el profesor de esta clase, los % a las %. Configurala en Configuración → Tarifas → Clases.',
      v_dia_nombre, to_char(v_clase.hora_inicio, 'HH24:MI');
  END IF;

  v_monto := v_tarifa_resuelta.monto;

  INSERT INTO public.clase_cobros (
    club_id, clase_id, fecha, monto, medio_pago, observaciones, usuario_id,
    turno_caja_id, cuenta_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, v_monto, p_medio_pago, p_observaciones,
    v_usuario_id, v_turno_caja_id, v_cuenta_id
  )
  RETURNING * INTO v_cobro;

  RETURN v_cobro;
END;
$$;

COMMENT ON FUNCTION public.fn_cobrar_clase(
  BIGINT, DATE, VARCHAR, TEXT, BIGINT
) IS
  'Registra el cobro del alquiler de una clase con la tarifa vigente del
   profesor asociado. Conserva el snapshot del monto y la integración con caja.';

GRANT EXECUTE ON FUNCTION public.fn_cobrar_clase(
  BIGINT, DATE, VARCHAR, TEXT, BIGINT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_total_clase_ocurrencia(
  p_clase_id BIGINT,
  p_fecha DATE
)
RETURNS NUMERIC(12,2)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := current_club_id();
  v_total NUMERIC(12,2);
  v_hora TIME;
  v_profesor_id BIGINT;
BEGIN
  SELECT monto_total
  INTO v_total
  FROM public.clase_ocurrencias
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;

  IF COALESCE(v_total, 0) > 0 THEN
    RETURN v_total;
  END IF;

  SELECT hora_inicio, profesor_id
  INTO v_hora, v_profesor_id
  FROM public.clases
  WHERE club_id = v_club_id
    AND id = p_clase_id;

  IF v_hora IS NOT NULL AND v_profesor_id IS NOT NULL THEN
    SELECT monto
    INTO v_total
    FROM public.fn_resolver_tarifa_clase(p_fecha, v_hora, v_profesor_id);

    IF COALESCE(v_total, 0) > 0 THEN
      RETURN v_total;
    END IF;
  END IF;

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_total
  FROM public.clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;

  RETURN COALESCE(v_total, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_total_clase_ocurrencia(BIGINT, DATE)
  TO authenticated;

DROP FUNCTION IF EXISTS public.fn_resolver_tarifa_clase(DATE, TIME);

COMMIT;
