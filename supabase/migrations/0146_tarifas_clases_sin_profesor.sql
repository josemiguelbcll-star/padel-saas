BEGIN;

ALTER TABLE public.tarifas_clases
  DROP CONSTRAINT IF EXISTS tarifas_clases_profesor_requerido,
  DROP CONSTRAINT IF EXISTS tarifas_clases_profesor_club_fk;

DROP INDEX IF EXISTS public.idx_tarifas_clases_profesor_resolucion;

UPDATE public.tarifas_clases
SET profesor_id = NULL
WHERE profesor_id IS NOT NULL;

ALTER TABLE public.tarifas_clases
  ADD CONSTRAINT tarifas_clases_sin_profesor
  CHECK (profesor_id IS NULL);

COMMENT ON COLUMN public.tarifas_clases.profesor_id IS
  'Columna heredada de 0142; las tarifas de clase ya no se asignan a profesores.';

CREATE OR REPLACE FUNCTION public.fn_limitar_franjas_clases_activas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cantidad INTEGER;
BEGIN
  IF NOT NEW.activa THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.activa
     AND OLD.club_id = NEW.club_id
     AND OLD.lineage_id = NEW.lineage_id THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('tarifas_clases:' || NEW.club_id::TEXT, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.tarifas_clases
    WHERE club_id = NEW.club_id
      AND lineage_id = NEW.lineage_id
      AND activa = TRUE
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(DISTINCT lineage_id)::INTEGER
  INTO v_cantidad
  FROM public.tarifas_clases
  WHERE club_id = NEW.club_id
    AND activa = TRUE
    AND lineage_id <> NEW.lineage_id;

  IF v_cantidad >= 3 THEN
    RAISE EXCEPTION
      'El club ya tiene tres franjas de clase activas. Desactivá una antes de crear o reactivar otra.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_limitar_franjas_clases_activas()
  FROM PUBLIC, authenticated;

CREATE TRIGGER tarifas_clases_limite_activas
  BEFORE INSERT OR UPDATE OF activa, club_id, lineage_id
  ON public.tarifas_clases
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_limitar_franjas_clases_activas();

CREATE OR REPLACE FUNCTION public.fn_crear_tarifa_clase(
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
  v_club_id BIGINT := public.current_club_id();
  v_tarifa public.tarifas_clases;
  v_vigente_desde DATE;
  v_new_id BIGINT;
BEGIN
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF public.current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear tarifas de clases.';
  END IF;
  IF p_nombre IS NULL OR LENGTH(TRIM(p_nombre)) = 0 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;
  IF (p_desde_hora IS NULL) <> (p_hasta_hora IS NULL)
     OR (p_desde_hora IS NOT NULL AND p_desde_hora >= p_hasta_hora) THEN
    RAISE EXCEPTION 'Configurá un rango horario válido o dejá ambas horas vacías.';
  END IF;

  v_vigente_desde := COALESCE(p_vigente_desde, CURRENT_DATE);
  v_new_id := nextval('public.tarifas_clases_id_seq');

  INSERT INTO public.tarifas_clases (
    id, club_id, profesor_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa, vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_new_id, v_club_id, NULL, TRIM(p_nombre), p_monto,
    p_desde_hora, p_hasta_hora, p_dias_semana, COALESCE(p_prioridad, 0),
    TRUE, v_vigente_desde, NULL, v_new_id
  )
  RETURNING * INTO v_tarifa;

  RETURN v_tarifa;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cambiar_precio_tarifa_clase(
  p_lineage_id BIGINT,
  p_monto_nuevo DECIMAL,
  p_vigente_desde DATE,
  p_opciones JSONB
)
RETURNS public.tarifas_clases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_actual public.tarifas_clases;
  v_nueva public.tarifas_clases;
BEGIN
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF public.current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cambiar precios.';
  END IF;
  IF p_vigente_desde IS NULL OR p_vigente_desde < CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha debe ser hoy o futura.';
  END IF;
  IF p_opciones IS NULL
     OR jsonb_typeof(p_opciones) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_opciones) <> 3
     OR (
       SELECT COUNT(DISTINCT x.orden)
       FROM jsonb_to_recordset(p_opciones)
         AS x(orden INTEGER, nombre TEXT, monto NUMERIC)
       WHERE x.orden BETWEEN 1 AND 3
         AND LENGTH(TRIM(x.nombre)) BETWEEN 1 AND 80
         AND x.monto > 0
     ) <> 3 THEN
    RAISE EXCEPTION 'Configurá las tres opciones con nombre y monto mayor a 0.';
  END IF;
  IF p_monto_nuevo IS DISTINCT FROM (
    SELECT x.monto
    FROM jsonb_to_recordset(p_opciones)
      AS x(orden INTEGER, nombre TEXT, monto NUMERIC)
    WHERE x.orden = 1
  ) THEN
    RAISE EXCEPTION 'El monto base debe coincidir con la opción 1.';
  END IF;

  SELECT *
  INTO v_actual
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
  IF v_actual.vigente_desde = p_vigente_desde THEN
    RAISE EXCEPTION
      'Ya hay una versión vigente desde el %; cancelá o modificá el aumento programado.',
      p_vigente_desde;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_opciones)
      AS x(orden INTEGER, nombre TEXT, monto NUMERIC)
    LEFT JOIN public.tarifas_clases_opciones actual
      ON actual.tarifa_clase_id = v_actual.id
     AND actual.orden = x.orden
    WHERE actual.id IS NULL
       OR actual.nombre IS DISTINCT FROM TRIM(x.nombre)
       OR actual.monto IS DISTINCT FROM x.monto
  ) THEN
    RAISE EXCEPTION 'Los tres precios son iguales a los actuales.';
  END IF;

  UPDATE public.tarifas_clases
  SET vigente_hasta = p_vigente_desde - 1
  WHERE id = v_actual.id;

  INSERT INTO public.tarifas_clases (
    club_id, profesor_id, nombre, monto, desde_hora, hasta_hora,
    dias_semana, prioridad, activa, vigente_desde, vigente_hasta, lineage_id
  ) VALUES (
    v_club_id, NULL, v_actual.nombre, p_monto_nuevo,
    v_actual.desde_hora, v_actual.hasta_hora, v_actual.dias_semana,
    v_actual.prioridad, v_actual.activa, p_vigente_desde, NULL, p_lineage_id
  )
  RETURNING * INTO v_nueva;

  INSERT INTO public.tarifas_clases_opciones (
    club_id, tarifa_clase_id, orden, nombre, monto
  )
  SELECT
    v_nueva.club_id,
    v_nueva.id,
    x.orden::SMALLINT,
    TRIM(x.nombre),
    x.monto
  FROM jsonb_to_recordset(p_opciones)
    AS x(orden INTEGER, nombre TEXT, monto NUMERIC)
  ORDER BY x.orden;

  RETURN v_nueva;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_seleccionar_tarifa_clase_opcion(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_opcion_id BIGINT
)
RETURNS public.clase_ocurrencias
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_clase public.clases;
  v_tarifa public.tarifas_clases;
  v_opcion public.tarifas_clases_opciones;
  v_ocurrencia public.clase_ocurrencias;
  v_cantidad INTEGER;
  v_cobros INTEGER;
BEGIN
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'La fecha de la clase es obligatoria.';
  END IF;
  IF COALESCE(
    public.current_user_rol() NOT IN ('admin', 'vendedor'),
    TRUE
  ) THEN
    RAISE EXCEPTION 'No tenés permisos para cambiar la tarifa de la clase.';
  END IF;

  SELECT *
  INTO v_clase
  FROM public.clases
  WHERE id = p_clase_id
    AND club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Clase no encontrada.';
  END IF;
  IF v_clase.es_recurrente IS FALSE
     AND v_clase.fecha_clase IS DISTINCT FROM p_fecha THEN
    RAISE EXCEPTION 'La tarifa solo se puede elegir en la fecha programada de esta clase.';
  END IF;
  IF v_clase.es_recurrente IS NOT FALSE
     AND v_clase.dias_semana IS NOT NULL
     AND NOT (EXTRACT(ISODOW FROM p_fecha)::INTEGER = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION 'La clase no está programada para esta fecha.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_club_id::TEXT || ':' || p_clase_id::TEXT || ':' || p_fecha::TEXT, 0)
  );

  SELECT *
  INTO v_ocurrencia
  FROM public.clase_ocurrencias
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha
  FOR UPDATE;

  IF FOUND AND v_ocurrencia.estado IN ('cancelada', 'liberada', 'pagada') THEN
    RAISE EXCEPTION 'No se puede cambiar la tarifa de una clase cerrada, cancelada o liberada.';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_cobros
  FROM public.clase_cobros
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;
  IF v_cobros > 0 THEN
    RAISE EXCEPTION 'No se puede cambiar la tarifa después de registrar cobros.';
  END IF;

  SELECT t.*
  INTO v_tarifa
  FROM public.tarifas_clases t
  JOIN public.tarifas_clases_opciones o
    ON o.tarifa_clase_id = t.id
   AND o.club_id = t.club_id
  WHERE o.id = p_opcion_id
    AND o.club_id = v_club_id
    AND t.profesor_id IS NULL
    AND t.activa = TRUE
    AND t.vigente_desde <= p_fecha
    AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= p_fecha)
    AND (t.dias_semana IS NULL OR EXTRACT(ISODOW FROM p_fecha)::INTEGER = ANY(t.dias_semana))
    AND (
      (t.desde_hora IS NULL AND t.hasta_hora IS NULL)
      OR (
        v_clase.hora_inicio >= t.desde_hora
        AND v_clase.hora_inicio < t.hasta_hora
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La opción no corresponde a una franja activa para la fecha, día y horario de esta clase.';
  END IF;

  SELECT *
  INTO v_opcion
  FROM public.tarifas_clases_opciones
  WHERE id = p_opcion_id
    AND club_id = v_club_id;
  IF NOT FOUND OR v_opcion.monto IS NULL OR v_opcion.monto <= 0 THEN
    RAISE EXCEPTION 'La opción de tarifa no tiene un monto configurado.';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_cantidad
  FROM public.clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;

  INSERT INTO public.clase_ocurrencias (
    club_id, clase_id, fecha, cantidad_alumnos, monto_total, estado,
    creado_por, tarifa_clase_opcion_id, tarifa_opcion_nombre, tarifa_opcion_monto
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, GREATEST(v_cantidad, 1), v_opcion.monto,
    'pendiente', auth.uid(), v_opcion.id, v_opcion.nombre, v_opcion.monto
  )
  ON CONFLICT (clase_id, fecha)
  DO UPDATE SET
    cantidad_alumnos = GREATEST(v_cantidad, 1),
    monto_total = EXCLUDED.monto_total,
    tarifa_clase_opcion_id = EXCLUDED.tarifa_clase_opcion_id,
    tarifa_opcion_nombre = EXCLUDED.tarifa_opcion_nombre,
    tarifa_opcion_monto = EXCLUDED.tarifa_opcion_monto
  RETURNING * INTO v_ocurrencia;

  IF v_cantidad > 0 THEN
    WITH ordenados AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY id) AS fila,
        COUNT(*) OVER () AS cantidad
      FROM public.clase_ocurrencia_alumnos
      WHERE club_id = v_club_id
        AND clase_id = p_clase_id
        AND fecha = p_fecha
    ),
    cuotas AS (
      SELECT
        id,
        fila,
        TRUNC(v_opcion.monto / cantidad, 2) AS base,
        ROUND(
          (v_opcion.monto - TRUNC(v_opcion.monto / cantidad, 2) * cantidad) * 100
        )::INTEGER AS centavos_extra
      FROM ordenados
    )
    UPDATE public.clase_ocurrencia_alumnos a
    SET monto_clase = q.base + CASE WHEN q.fila <= q.centavos_extra THEN 0.01 ELSE 0 END
    FROM cuotas q
    WHERE a.id = q.id
      AND a.club_id = v_club_id;
  END IF;

  RETURN v_ocurrencia;
END;
$$;

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
  v_club_id BIGINT := public.current_club_id();
  v_total NUMERIC(12,2);
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

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_total
  FROM public.clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;

  RETURN COALESCE(v_total, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cobrar_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_monto DECIMAL,
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
  v_ocurrencia public.clase_ocurrencias;
  v_club_id BIGINT := public.current_club_id();
  v_usuario_id UUID := auth.uid();
  v_cobro public.clase_cobros;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
BEGIN
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  SELECT *
  INTO v_clase
  FROM public.clases
  WHERE id = p_clase_id
    AND club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece a tu club.';
  END IF;
  IF v_clase.es_recurrente IS FALSE
     AND v_clase.fecha_clase IS DISTINCT FROM p_fecha THEN
    RAISE EXCEPTION 'La fecha no corresponde a esta clase.';
  END IF;
  IF v_clase.es_recurrente IS NOT FALSE
     AND v_clase.dias_semana IS NOT NULL
     AND NOT (EXTRACT(ISODOW FROM p_fecha)::INTEGER = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION 'La clase no se dicta el % — revisá los días configurados.', p_fecha;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_club_id::TEXT || ':' || p_clase_id::TEXT || ':' || p_fecha::TEXT, 0)
  );

  SELECT *
  INTO v_ocurrencia
  FROM public.clase_ocurrencias
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha
  FOR UPDATE;
  IF NOT FOUND OR v_ocurrencia.tarifa_clase_opcion_id IS NULL
     OR COALESCE(v_ocurrencia.monto_total, 0) <= 0 THEN
    RAISE EXCEPTION 'Elegí una opción de tarifa antes de cobrar la clase.';
  END IF;
  IF v_ocurrencia.estado IN ('cancelada', 'liberada', 'pagada') THEN
    RAISE EXCEPTION 'No se puede cobrar una clase cerrada, cancelada o liberada.';
  END IF;

  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica
    INTO v_es_caja
    FROM public.cuentas
    WHERE id = p_cuenta_id
      AND club_id = v_club_id;
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
    v_turno_caja_id := public.current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  INSERT INTO public.clase_cobros (
    club_id, clase_id, fecha, monto, medio_pago, observaciones, usuario_id,
    turno_caja_id, cuenta_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, p_monto, p_medio_pago, p_observaciones,
    v_usuario_id, v_turno_caja_id, v_cuenta_id
  )
  RETURNING * INTO v_cobro;

  RETURN v_cobro;
END;
$$;

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
  v_monto NUMERIC(12,2);
BEGIN
  v_monto := public.fn_total_clase_ocurrencia(p_clase_id, p_fecha);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'Elegí una opción de tarifa antes de cobrar la clase.';
  END IF;

  RETURN public.fn_cobrar_clase(
    p_clase_id, p_fecha, v_monto, p_medio_pago, p_observaciones, p_cuenta_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cambiar_precio_tarifa_clase(
  BIGINT, DECIMAL, DATE, JSONB
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cambiar_precio_tarifa_clase(
  BIGINT, DECIMAL, DATE, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_seleccionar_tarifa_clase_opcion(
  BIGINT, DATE, BIGINT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_seleccionar_tarifa_clase_opcion(
  BIGINT, DATE, BIGINT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_cobrar_clase(
  BIGINT, DATE, DECIMAL, VARCHAR, TEXT, BIGINT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cobrar_clase(
  BIGINT, DATE, DECIMAL, VARCHAR, TEXT, BIGINT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cobrar_clase(
  BIGINT, DATE, VARCHAR, TEXT, BIGINT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cobrar_clase(
  BIGINT, DATE, VARCHAR, TEXT, BIGINT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_total_clase_ocurrencia(BIGINT, DATE)
  TO authenticated;

COMMIT;
