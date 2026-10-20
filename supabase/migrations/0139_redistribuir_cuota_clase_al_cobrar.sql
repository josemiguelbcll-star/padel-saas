-- ============================================================================
-- 0139_redistribuir_cuota_clase_al_cobrar.sql
--
-- Permite redistribuir entre los demás alumnos la parte de clase incluida
-- en un cobro individual. El cobro y el cambio de cuotas son atómicos.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_rebalancear_cuota_clase(
  p_clase_alumno_id BIGINT,
  p_nueva_cuota DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_alumno clase_ocurrencia_alumnos%ROWTYPE;
  v_otro RECORD;
  v_total_clase NUMERIC(12,2);
  v_cantidad_alumnos INTEGER;
  v_pagado_objetivo NUMERIC(12,2);
  v_pagado_otros NUMERIC(12,2);
  v_nueva_cuota NUMERIC(12,2);
  v_restante NUMERIC(12,2);
  v_cuota_base NUMERIC(12,2);
  v_centavos_extra INTEGER;
  v_indice INTEGER := 0;
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_nueva_cuota IS NULL OR p_nueva_cuota < 0 THEN
    RAISE EXCEPTION 'La cuota debe ser igual o mayor a 0.';
  END IF;

  SELECT * INTO v_alumno
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El alumno de la clase no existe.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_club_id::TEXT || ':' || v_alumno.clase_id::TEXT || ':' || v_alumno.fecha::TEXT,
      0
    )
  );

  SELECT * INTO v_alumno
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id
  FOR UPDATE;

  SELECT COUNT(*)::INTEGER, COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_cantidad_alumnos, v_total_clase
  FROM clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha;

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_pagado_objetivo
  FROM clase_cobros
  WHERE club_id = v_club_id
    AND clase_alumno_id = p_clase_alumno_id;

  SELECT COALESCE(SUM(c.monto_clase), 0)::NUMERIC(12,2)
  INTO v_pagado_otros
  FROM clase_ocurrencia_alumnos a
  JOIN clase_cobros c
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
    RAISE EXCEPTION 'La cuota no puede superar el total de la clase.';
  END IF;

  IF v_nueva_cuota + v_pagado_otros > v_total_clase THEN
    RAISE EXCEPTION
      'La cuota supera el saldo disponible de la clase después de considerar pagos ya registrados.';
  END IF;

  IF v_cantidad_alumnos = 1 THEN
    UPDATE clase_ocurrencia_alumnos
    SET monto_clase = v_total_clase
    WHERE id = p_clase_alumno_id
      AND club_id = v_club_id;
  ELSE
    v_restante := v_total_clase - v_nueva_cuota - v_pagado_otros;
    v_cuota_base := TRUNC(v_restante / (v_cantidad_alumnos - 1), 2);
    v_centavos_extra := ROUND(
      (v_restante - v_cuota_base * (v_cantidad_alumnos - 1)) * 100
    )::INTEGER;

    UPDATE clase_ocurrencia_alumnos
    SET monto_clase = v_nueva_cuota
    WHERE id = p_clase_alumno_id
      AND club_id = v_club_id;

    FOR v_otro IN
      SELECT
        a.id,
        COALESCE(SUM(c.monto_clase), 0)::NUMERIC(12,2) AS monto_pagado
      FROM clase_ocurrencia_alumnos a
      LEFT JOIN clase_cobros c
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
      UPDATE clase_ocurrencia_alumnos
      SET monto_clase = v_otro.monto_pagado + v_cuota_base
        + CASE WHEN v_indice <= v_centavos_extra THEN 0.01 ELSE 0 END
      WHERE id = v_otro.id
        AND club_id = v_club_id;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_cobrar_alumno_clase_redistribuir(
  p_clase_alumno_id BIGINT,
  p_medio_pago VARCHAR,
  p_monto DECIMAL,
  p_monto_clase DECIMAL,
  p_monto_consumo DECIMAL,
  p_observaciones TEXT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS clase_cobros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_alumno clase_ocurrencia_alumnos%ROWTYPE;
  v_cobro clase_cobros;
  v_total_clase NUMERIC(12,2);
  v_pagado_objetivo NUMERIC(12,2);
  v_nueva_cuota NUMERIC(12,2);
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
  END IF;

  IF p_monto_clase IS NULL OR p_monto_clase < 0
     OR p_monto_consumo IS NULL OR p_monto_consumo < 0
     OR ROUND(p_monto_clase + p_monto_consumo, 2) <> ROUND(p_monto, 2) THEN
    RAISE EXCEPTION 'El desglose entre clase y consumo no coincide con el monto cobrado.';
  END IF;

  SELECT * INTO v_alumno
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El alumno de la clase no existe.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_club_id::TEXT || ':' || v_alumno.clase_id::TEXT || ':' || v_alumno.fecha::TEXT,
      0
    )
  );

  SELECT * INTO v_alumno
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id
  FOR UPDATE;

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_total_clase
  FROM clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha;

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_pagado_objetivo
  FROM clase_cobros
  WHERE club_id = v_club_id
    AND clase_alumno_id = p_clase_alumno_id;

  v_nueva_cuota := v_pagado_objetivo + p_monto_clase;
  IF v_nueva_cuota > v_total_clase THEN
    RAISE EXCEPTION
      'El monto supera el total de la clase.';
  END IF;

  IF p_monto_clase > 0 THEN
    PERFORM fn_rebalancear_cuota_clase(p_clase_alumno_id, v_nueva_cuota);
  END IF;

  v_cobro := fn_cobrar_alumno_clase(
    p_clase_alumno_id,
    p_medio_pago,
    p_monto,
    p_monto_clase,
    p_monto_consumo,
    p_observaciones,
    p_cuenta_id
  );

  RETURN v_cobro;
END;
$$;

COMMENT ON FUNCTION fn_cobrar_alumno_clase_redistribuir(
  BIGINT, VARCHAR, DECIMAL, DECIMAL, DECIMAL, TEXT, BIGINT
) IS
  'Registra un cobro individual de clase y redistribuye equitativamente
   entre los demás alumnos la parte de clase del pago. La asignación no
   puede superar el total de cuotas de la ocurrencia y se ejecuta atómicamente.';

COMMENT ON FUNCTION fn_rebalancear_cuota_clase(BIGINT, DECIMAL) IS
  'Actualiza la cuota de un alumno de clase y distribuye el saldo por igual
   entre los demás alumnos, respetando pagos ya registrados y el total de la clase.';

GRANT EXECUTE ON FUNCTION fn_cobrar_alumno_clase_redistribuir(
  BIGINT, VARCHAR, DECIMAL, DECIMAL, DECIMAL, TEXT, BIGINT
) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_rebalancear_cuota_clase(BIGINT, DECIMAL)
  TO authenticated;

COMMIT;
