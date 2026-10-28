BEGIN;

CREATE TABLE public.tarifas_clases_opciones (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  tarifa_clase_id BIGINT NOT NULL REFERENCES public.tarifas_clases(id) ON DELETE RESTRICT,
  orden SMALLINT NOT NULL CHECK (orden BETWEEN 1 AND 3),
  nombre VARCHAR(80) NOT NULL CHECK (LENGTH(TRIM(nombre)) > 0),
  monto NUMERIC(12,2) CHECK (monto IS NULL OR monto > 0),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tarifas_clases_opciones_tarifa_orden_unique
    UNIQUE (tarifa_clase_id, orden)
);

CREATE INDEX idx_tarifas_clases_opciones_club_tarifa
  ON public.tarifas_clases_opciones (club_id, tarifa_clase_id);

ALTER TABLE public.tarifas_clases_opciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY tarifas_clases_opciones_select_club
  ON public.tarifas_clases_opciones
  FOR SELECT TO authenticated
  USING (club_id = public.current_club_id());

GRANT SELECT ON public.tarifas_clases_opciones TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tarifas_clases_opciones
  FROM PUBLIC, authenticated;
REVOKE ALL ON SEQUENCE public.tarifas_clases_opciones_id_seq
  FROM PUBLIC, authenticated;

INSERT INTO public.tarifas_clases_opciones (
  club_id, tarifa_clase_id, orden, nombre, monto
)
SELECT club_id, id, 1, 'Opción 1', monto
FROM public.tarifas_clases
UNION ALL
SELECT club_id, id, 2, 'Opción 2', NULL
FROM public.tarifas_clases
UNION ALL
SELECT club_id, id, 3, 'Opción 3', NULL
FROM public.tarifas_clases;

ALTER TABLE public.clase_ocurrencias
  ADD COLUMN tarifa_clase_opcion_id BIGINT
    REFERENCES public.tarifas_clases_opciones(id) ON DELETE RESTRICT,
  ADD COLUMN tarifa_opcion_nombre VARCHAR(80),
  ADD COLUMN tarifa_opcion_monto NUMERIC(12,2);

ALTER TABLE public.clase_ocurrencias
  ADD CONSTRAINT clase_ocurrencias_tarifa_opcion_snapshot_check
  CHECK (
    (tarifa_clase_opcion_id IS NULL
      AND tarifa_opcion_nombre IS NULL
      AND tarifa_opcion_monto IS NULL)
    OR
    (tarifa_clase_opcion_id IS NOT NULL
      AND tarifa_opcion_nombre IS NOT NULL
      AND tarifa_opcion_monto IS NOT NULL
      AND tarifa_opcion_monto > 0)
  );

CREATE OR REPLACE FUNCTION public.fn_crear_tarifa_clase(
  p_profesor_id BIGINT,
  p_nombre VARCHAR,
  p_monto DECIMAL,
  p_opciones JSONB,
  p_desde_hora TIME DEFAULT NULL,
  p_hasta_hora TIME DEFAULT NULL,
  p_dias_semana INTEGER[] DEFAULT NULL,
  p_prioridad INTEGER DEFAULT 0,
  p_vigente_desde DATE DEFAULT NULL
)
RETURNS public.tarifas_clases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tarifa public.tarifas_clases;
BEGIN
  IF auth.uid() IS NULL
     OR public.current_club_id() IS NULL
     OR public.current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear tarifas de clases.';
  END IF;

  IF jsonb_typeof(p_opciones) <> 'array'
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

  IF p_monto IS DISTINCT FROM (
    SELECT x.monto
    FROM jsonb_to_recordset(p_opciones)
      AS x(orden INTEGER, nombre TEXT, monto NUMERIC)
    WHERE x.orden = 1
  ) THEN
    RAISE EXCEPTION 'El monto base debe coincidir con la opción 1.';
  END IF;

  v_tarifa := public.fn_crear_tarifa_clase(
    p_profesor_id,
    p_nombre,
    p_monto,
    p_desde_hora,
    p_hasta_hora,
    p_dias_semana,
    p_prioridad,
    p_vigente_desde
  );

  INSERT INTO public.tarifas_clases_opciones (
    club_id, tarifa_clase_id, orden, nombre, monto
  )
  SELECT
    v_tarifa.club_id,
    v_tarifa.id,
    x.orden::SMALLINT,
    TRIM(x.nombre),
    x.monto
  FROM jsonb_to_recordset(p_opciones)
    AS x(orden INTEGER, nombre TEXT, monto NUMERIC)
  ORDER BY x.orden;

  RETURN v_tarifa;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_crear_tarifa_clase(
  BIGINT, VARCHAR, DECIMAL, JSONB, TIME, TIME, INTEGER[], INTEGER, DATE
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_crear_tarifa_clase(
  BIGINT, VARCHAR, DECIMAL, JSONB, TIME, TIME, INTEGER[], INTEGER, DATE
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_crear_tarifa_clase(
  BIGINT, VARCHAR, DECIMAL, TIME, TIME, INTEGER[], INTEGER, DATE
) FROM PUBLIC, authenticated;

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
  IF jsonb_typeof(p_opciones) <> 'array'
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
  IF v_actual.profesor_id IS NULL THEN
    RAISE EXCEPTION
      'Esta tarifa histórica no está asociada a un profesor y no se puede versionar.';
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
    v_club_id, v_actual.profesor_id, v_actual.nombre, p_monto_nuevo,
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

GRANT EXECUTE ON FUNCTION public.fn_cambiar_precio_tarifa_clase(
  BIGINT, DECIMAL, DATE, JSONB
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_cambiar_precio_tarifa_clase(
  BIGINT, DECIMAL, DATE, JSONB
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_cambiar_precio_tarifa_clase(
  BIGINT, DECIMAL, DATE
) FROM PUBLIC, authenticated;

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
    AND t.profesor_id = v_clase.profesor_id
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
    RAISE EXCEPTION 'La opción no corresponde a una tarifa vigente para este profesor y horario.';
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

CREATE OR REPLACE FUNCTION public.fn_agregar_alumno_clase_con_reparto(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_jugador_id BIGINT,
  p_nombre_libre TEXT
)
RETURNS public.clase_ocurrencia_alumnos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_clase public.clases;
  v_ocurrencia public.clase_ocurrencias;
  v_alumno public.clase_ocurrencia_alumnos;
  v_total NUMERIC(12,2);
  v_cantidad INTEGER;
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
    RAISE EXCEPTION 'No tenés permisos para agregar alumnos a la clase.';
  END IF;
  IF (p_jugador_id IS NULL) = (NULLIF(TRIM(p_nombre_libre), '') IS NULL) THEN
    RAISE EXCEPTION 'Elegí un jugador o ingresá un nombre libre.';
  END IF;
  IF p_jugador_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.jugadores
    WHERE id = p_jugador_id AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION 'El jugador no existe o no pertenece a tu club.';
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
  IF NOT FOUND OR v_ocurrencia.tarifa_clase_opcion_id IS NULL THEN
    RAISE EXCEPTION 'Elegí una opción de tarifa antes de agregar alumnos.';
  END IF;
  IF v_ocurrencia.estado IN ('cancelada', 'liberada', 'pagada') THEN
    RAISE EXCEPTION 'No se pueden agregar alumnos a una clase cerrada o cancelada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.clase_cobros
    WHERE club_id = v_club_id AND clase_id = p_clase_id AND fecha = p_fecha
  ) THEN
    RAISE EXCEPTION 'Anulá los cobros antes de cambiar los alumnos de la clase.';
  END IF;

  v_total := public.fn_total_clase_ocurrencia(p_clase_id, p_fecha);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total elegido para la clase debe ser mayor a 0.';
  END IF;

  INSERT INTO public.clase_ocurrencia_alumnos (
    club_id, clase_id, fecha, jugador_id, nombre_libre, monto_clase
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, p_jugador_id,
    NULLIF(TRIM(p_nombre_libre), ''), 0
  )
  RETURNING * INTO v_alumno;

  SELECT COUNT(*)::INTEGER
  INTO v_cantidad
  FROM public.clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;
  UPDATE public.clase_ocurrencias
  SET cantidad_alumnos = v_cantidad
  WHERE id = v_ocurrencia.id
    AND club_id = v_club_id;

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
      TRUNC(v_total / cantidad, 2) AS base,
      ROUND((v_total - TRUNC(v_total / cantidad, 2) * cantidad) * 100)::INTEGER
        AS centavos_extra
    FROM ordenados
  )
  UPDATE public.clase_ocurrencia_alumnos a
  SET monto_clase = q.base + CASE WHEN q.fila <= q.centavos_extra THEN 0.01 ELSE 0 END
  FROM cuotas q
  WHERE a.id = q.id
    AND a.club_id = v_club_id;

  SELECT *
  INTO v_alumno
  FROM public.clase_ocurrencia_alumnos
  WHERE id = v_alumno.id
    AND club_id = v_club_id;

  RETURN v_alumno;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_quitar_alumno_clase_con_reparto(
  p_clase_alumno_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_alumno public.clase_ocurrencia_alumnos;
  v_ocurrencia public.clase_ocurrencias;
  v_total NUMERIC(12,2);
  v_cantidad INTEGER;
BEGIN
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF COALESCE(
    public.current_user_rol() NOT IN ('admin', 'vendedor'),
    TRUE
  ) THEN
    RAISE EXCEPTION 'No tenés permisos para quitar alumnos de la clase.';
  END IF;

  SELECT *
  INTO v_alumno
  FROM public.clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El alumno de la clase no existe.';
  END IF;

  PERFORM 1
  FROM public.clases
  WHERE id = v_alumno.clase_id
    AND club_id = v_club_id
  FOR UPDATE;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_club_id::TEXT || ':' || v_alumno.clase_id::TEXT || ':' || v_alumno.fecha::TEXT,
      0
    )
  );

  SELECT *
  INTO v_ocurrencia
  FROM public.clase_ocurrencias
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.clase_cobros
    WHERE club_id = v_club_id
      AND clase_id = v_alumno.clase_id
      AND fecha = v_alumno.fecha
  ) THEN
    RAISE EXCEPTION 'Anulá los cobros antes de cambiar los alumnos de la clase.';
  END IF;

  DELETE FROM public.clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id;

  IF v_ocurrencia.tarifa_clase_opcion_id IS NULL THEN
    RETURN;
  END IF;

  v_total := public.fn_total_clase_ocurrencia(v_alumno.clase_id, v_alumno.fecha);

  SELECT COUNT(*)::INTEGER
  INTO v_cantidad
  FROM public.clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha;
  UPDATE public.clase_ocurrencias
  SET cantidad_alumnos = GREATEST(v_cantidad, 1)
  WHERE id = v_ocurrencia.id
    AND club_id = v_club_id;

  IF v_total <= 0 OR v_cantidad = 0 THEN
    RETURN;
  END IF;

  WITH ordenados AS (
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY id) AS fila,
      COUNT(*) OVER () AS cantidad
    FROM public.clase_ocurrencia_alumnos
    WHERE club_id = v_club_id
      AND clase_id = v_alumno.clase_id
      AND fecha = v_alumno.fecha
  ),
  cuotas AS (
    SELECT
      id,
      fila,
      TRUNC(v_total / cantidad, 2) AS base,
      ROUND((v_total - TRUNC(v_total / cantidad, 2) * cantidad) * 100)::INTEGER
        AS centavos_extra
    FROM ordenados
  )
  UPDATE public.clase_ocurrencia_alumnos a
  SET monto_clase = q.base + CASE WHEN q.fila <= q.centavos_extra THEN 0.01 ELSE 0 END
  FROM cuotas q
  WHERE a.id = q.id
    AND a.club_id = v_club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_seleccionar_tarifa_clase_opcion(
  BIGINT, DATE, BIGINT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_seleccionar_tarifa_clase_opcion(
  BIGINT, DATE, BIGINT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_agregar_alumno_clase_con_reparto(
  BIGINT, DATE, BIGINT, TEXT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_agregar_alumno_clase_con_reparto(
  BIGINT, DATE, BIGINT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_quitar_alumno_clase_con_reparto(
  BIGINT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_quitar_alumno_clase_con_reparto(
  BIGINT
) FROM PUBLIC;

COMMIT;
