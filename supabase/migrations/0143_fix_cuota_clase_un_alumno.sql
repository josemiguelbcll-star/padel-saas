-- ============================================================================
-- 0143_fix_cuota_clase_un_alumno.sql
--
-- Respeta el monto individual editado aunque haya un solo alumno. El saldo
-- no asignado permanece pendiente en la ocurrencia.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_rebalancear_cuota_clase(
  p_clase_alumno_id BIGINT,
  p_nueva_cuota DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := current_club_id();
  v_alumno public.clase_ocurrencia_alumnos%ROWTYPE;
  v_otro RECORD;
  v_total_clase NUMERIC(12,2);
  v_total_general_cobrado NUMERIC(12,2);
  v_cantidad_alumnos INTEGER;
  v_pagado_objetivo NUMERIC(12,2);
  v_pagado_otros NUMERIC(12,2);
  v_nueva_cuota NUMERIC(12,2);
  v_restante NUMERIC(12,2);
  v_cuota_base NUMERIC(12,2);
  v_centavos_extra INTEGER;
  v_indice INTEGER := 0;
BEGIN
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF p_nueva_cuota IS NULL OR p_nueva_cuota < 0 THEN
    RAISE EXCEPTION 'La cuota debe ser igual o mayor a 0.';
  END IF;

  SELECT * INTO v_alumno
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

  SELECT * INTO v_alumno
  FROM public.clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id
  FOR UPDATE;

  SELECT COUNT(*)::INTEGER
  INTO v_cantidad_alumnos
  FROM public.clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha;

  v_total_clase := public.fn_total_clase_ocurrencia(
    v_alumno.clase_id, v_alumno.fecha
  );

  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(monto_clase, 0) > 0 OR COALESCE(monto_consumo, 0) > 0
        THEN COALESCE(monto_clase, 0)
      ELSE COALESCE(monto, 0)
    END
  ), 0)::NUMERIC(12,2)
  INTO v_total_general_cobrado
  FROM public.clase_cobros
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha
    AND clase_alumno_id IS NULL;

  v_total_clase := GREATEST(v_total_clase - v_total_general_cobrado, 0);

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_pagado_objetivo
  FROM public.clase_cobros
  WHERE club_id = v_club_id
    AND clase_alumno_id = p_clase_alumno_id;

  SELECT COALESCE(SUM(c.monto_clase), 0)::NUMERIC(12,2)
  INTO v_pagado_otros
  FROM public.clase_ocurrencia_alumnos a
  JOIN public.clase_cobros c
    ON c.clase_alumno_id = a.id
   AND c.club_id = a.club_id
  WHERE a.club_id = v_club_id
    AND a.clase_id = v_alumno.clase_id
    AND a.fecha = v_alumno.fecha
    AND a.id <> p_clase_alumno_id;

  IF p_nueva_cuota < v_pagado_objetivo THEN
    RAISE EXCEPTION
      'La cuota no puede ser menor a lo que este alumno ya pagó por la clase.';
  END IF;

  v_nueva_cuota := p_nueva_cuota;
  IF v_nueva_cuota > v_total_clase THEN
    RAISE EXCEPTION 'La cuota no puede superar el saldo pendiente de la clase.';
  END IF;

  IF v_nueva_cuota + v_pagado_otros > v_total_clase THEN
    RAISE EXCEPTION
      'La cuota supera el saldo disponible de la clase después de considerar pagos ya registrados.';
  END IF;

  UPDATE public.clase_ocurrencia_alumnos
  SET monto_clase = v_nueva_cuota
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id;

  IF v_cantidad_alumnos > 1 THEN
    v_restante := v_total_clase - v_nueva_cuota - v_pagado_otros;
    v_cuota_base := TRUNC(v_restante / (v_cantidad_alumnos - 1), 2);
    v_centavos_extra := ROUND(
      (v_restante - v_cuota_base * (v_cantidad_alumnos - 1)) * 100
    )::INTEGER;

    FOR v_otro IN
      SELECT
        a.id,
        COALESCE(SUM(c.monto_clase), 0)::NUMERIC(12,2) AS monto_pagado
      FROM public.clase_ocurrencia_alumnos a
      LEFT JOIN public.clase_cobros c
        ON c.clase_alumno_id = a.id
       AND c.club_id = a.club_id
      WHERE a.club_id = v_club_id
        AND a.clase_id = v_alumno.clase_id
        AND a.fecha = v_alumno.fecha
        AND a.id <> p_clase_alumno_id
      GROUP BY a.id
      ORDER BY a.id
    LOOP
      v_indice := v_indice + 1;
      UPDATE public.clase_ocurrencia_alumnos
      SET monto_clase = v_otro.monto_pagado + v_cuota_base
        + CASE WHEN v_indice <= v_centavos_extra THEN 0.01 ELSE 0 END
      WHERE id = v_otro.id
        AND club_id = v_club_id;
    END LOOP;
  END IF;
END;
$$;

COMMIT;
