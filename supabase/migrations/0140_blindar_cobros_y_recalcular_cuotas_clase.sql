-- ============================================================================
-- 0140_blindar_cobros_y_recalcular_cuotas_clase.sql
--
-- Serializa los cobros de una ocurrencia, limita el total cobrado al total
-- de la clase y recalcula las cuotas cuando se anula un cobro.
-- ============================================================================

BEGIN;

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
BEGIN
  SELECT monto_total
  INTO v_total
  FROM clase_ocurrencias
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;

  IF COALESCE(v_total, 0) > 0 THEN
    RETURN v_total;
  END IF;

  SELECT hora_inicio
  INTO v_hora
  FROM clases
  WHERE club_id = v_club_id
    AND id = p_clase_id;

  IF v_hora IS NOT NULL THEN
    SELECT monto
    INTO v_total
    FROM fn_resolver_tarifa_clase(p_fecha, v_hora);

    IF COALESCE(v_total, 0) > 0 THEN
      RETURN v_total;
    END IF;
  END IF;

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_total
  FROM clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = p_clase_id
    AND fecha = p_fecha;

  RETURN COALESCE(v_total, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_total_clase_ocurrencia(BIGINT, DATE)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_validar_total_cobros_clase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_clase NUMERIC(12,2);
  v_total_cobrado NUMERIC(12,2);
  v_monto_clase_nuevo NUMERIC(12,2);
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.club_id <> OLD.club_id
       OR NEW.clase_id <> OLD.clase_id
       OR NEW.fecha <> OLD.fecha
     ) THEN
    RAISE EXCEPTION 'No se puede mover un cobro a otra clase u ocurrencia.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.monto IS NOT DISTINCT FROM OLD.monto
     AND NEW.monto_clase IS NOT DISTINCT FROM OLD.monto_clase
     AND NEW.monto_consumo IS NOT DISTINCT FROM OLD.monto_consumo
     AND NEW.clase_alumno_id IS NOT DISTINCT FROM OLD.clase_alumno_id THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM clases
  WHERE id = NEW.clase_id
    AND club_id = NEW.club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece al club del cobro.';
  END IF;

  IF NEW.clase_alumno_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM clase_ocurrencia_alumnos
    WHERE id = NEW.clase_alumno_id
      AND club_id = NEW.club_id
      AND clase_id = NEW.clase_id
      AND fecha = NEW.fecha
  ) THEN
    RAISE EXCEPTION 'El alumno no pertenece a la ocurrencia de esta clase.';
  END IF;

  v_total_clase := fn_total_clase_ocurrencia(NEW.clase_id, NEW.fecha);

  v_monto_clase_nuevo := CASE
    WHEN NEW.clase_alumno_id IS NOT NULL THEN COALESCE(NEW.monto_clase, 0)
    WHEN COALESCE(NEW.monto_clase, 0) > 0
      OR COALESCE(NEW.monto_consumo, 0) > 0
      THEN COALESCE(NEW.monto_clase, 0)
    ELSE COALESCE(NEW.monto, 0)
  END;

  SELECT COALESCE(SUM(
    CASE
      WHEN clase_alumno_id IS NOT NULL THEN COALESCE(monto_clase, 0)
      WHEN COALESCE(monto_clase, 0) > 0
        OR COALESCE(monto_consumo, 0) > 0
        THEN COALESCE(monto_clase, 0)
      ELSE COALESCE(monto, 0)
    END
  ), 0)::NUMERIC(12,2)
  INTO v_total_cobrado
  FROM clase_cobros
  WHERE club_id = NEW.club_id
    AND clase_id = NEW.clase_id
    AND fecha = NEW.fecha
    AND id <> COALESCE(NEW.id, 0);

  IF v_monto_clase_nuevo > 0
     AND (v_total_clase <= 0
       OR v_total_cobrado + v_monto_clase_nuevo > v_total_clase) THEN
    RAISE EXCEPTION
      'El cobro supera el saldo pendiente de la clase. Total: %, ya cobrado: %, nuevo cobro: %.',
      v_total_clase, v_total_cobrado, v_monto_clase_nuevo;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validar_total_cobros_clase() FROM PUBLIC;

DROP TRIGGER IF EXISTS clase_cobros_validar_total ON public.clase_cobros;
CREATE TRIGGER clase_cobros_validar_total
  BEFORE INSERT OR UPDATE ON public.clase_cobros
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validar_total_cobros_clase();

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
  v_alumno clase_ocurrencia_alumnos%ROWTYPE;
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
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El alumno de la clase no existe.';
  END IF;

  PERFORM 1
  FROM clases
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
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id
  FOR UPDATE;

  SELECT COUNT(*)::INTEGER
  INTO v_cantidad_alumnos
  FROM clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha;

  v_total_clase := fn_total_clase_ocurrencia(v_alumno.clase_id, v_alumno.fecha);

  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(monto_clase, 0) > 0 OR COALESCE(monto_consumo, 0) > 0
        THEN COALESCE(monto_clase, 0)
      ELSE COALESCE(monto, 0)
    END
  ), 0)::NUMERIC(12,2)
  INTO v_total_general_cobrado
  FROM clase_cobros
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha
    AND clase_alumno_id IS NULL;

  v_total_clase := GREATEST(v_total_clase - v_total_general_cobrado, 0);

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
    RAISE EXCEPTION 'La cuota no puede superar el saldo pendiente de la clase.';
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

CREATE OR REPLACE FUNCTION public.fn_cobrar_alumno_clase_redistribuir(
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
  v_club_id BIGINT := current_club_id();
  v_alumno clase_ocurrencia_alumnos%ROWTYPE;
  v_cobro clase_cobros;
  v_total_clase NUMERIC(12,2);
  v_total_general_cobrado NUMERIC(12,2);
  v_pagado_objetivo NUMERIC(12,2);
  v_nueva_cuota NUMERIC(12,2);
BEGIN
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

  PERFORM 1
  FROM clases
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
  FROM clase_ocurrencia_alumnos
  WHERE id = p_clase_alumno_id
    AND club_id = v_club_id
  FOR UPDATE;

  v_total_clase := fn_total_clase_ocurrencia(v_alumno.clase_id, v_alumno.fecha);

  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(monto_clase, 0) > 0 OR COALESCE(monto_consumo, 0) > 0
        THEN COALESCE(monto_clase, 0)
      ELSE COALESCE(monto, 0)
    END
  ), 0)::NUMERIC(12,2)
  INTO v_total_general_cobrado
  FROM clase_cobros
  WHERE club_id = v_club_id
    AND clase_id = v_alumno.clase_id
    AND fecha = v_alumno.fecha
    AND clase_alumno_id IS NULL;

  v_total_clase := GREATEST(v_total_clase - v_total_general_cobrado, 0);

  SELECT COALESCE(SUM(monto_clase), 0)::NUMERIC(12,2)
  INTO v_pagado_objetivo
  FROM clase_cobros
  WHERE club_id = v_club_id
    AND clase_alumno_id = p_clase_alumno_id;

  v_nueva_cuota := v_pagado_objetivo + p_monto_clase;
  IF v_nueva_cuota > v_total_clase THEN
    RAISE EXCEPTION 'El monto supera el saldo pendiente de la clase.';
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

CREATE OR REPLACE FUNCTION public.fn_borrar_cobro_clase(
  p_cobro_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := current_club_id();
  v_cobro clase_cobros%ROWTYPE;
  v_total_clase NUMERIC(12,2);
  v_total_cobrado NUMERIC(12,2);
  v_saldo_a_distribuir NUMERIC(12,2);
  v_cantidad_alumnos INTEGER;
  v_alumno RECORD;
  v_cuota_base NUMERIC(12,2);
  v_centavos_extra INTEGER;
  v_indice INTEGER := 0;
BEGIN
  IF current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar cobros de clases.';
  END IF;

  SELECT * INTO v_cobro
  FROM clase_cobros
  WHERE id = p_cobro_id
    AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cobro no existe o no pertenece a tu club.';
  END IF;

  PERFORM 1
  FROM clases
  WHERE id = v_cobro.clase_id
    AND club_id = v_club_id
  FOR UPDATE;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_club_id::TEXT || ':' || v_cobro.clase_id::TEXT || ':' || v_cobro.fecha::TEXT,
      0
    )
  );

  DELETE FROM clase_cobros
  WHERE id = p_cobro_id
    AND club_id = v_club_id;

  v_total_clase := fn_total_clase_ocurrencia(v_cobro.clase_id, v_cobro.fecha);

  SELECT COALESCE(SUM(
    CASE
      WHEN clase_alumno_id IS NOT NULL THEN COALESCE(monto_clase, 0)
      WHEN COALESCE(monto_clase, 0) > 0
        OR COALESCE(monto_consumo, 0) > 0
        THEN COALESCE(monto_clase, 0)
      ELSE COALESCE(monto, 0)
    END
  ), 0)::NUMERIC(12,2)
  INTO v_total_cobrado
  FROM clase_cobros
  WHERE club_id = v_club_id
    AND clase_id = v_cobro.clase_id
    AND fecha = v_cobro.fecha;

  v_saldo_a_distribuir := GREATEST(v_total_clase - v_total_cobrado, 0);

  SELECT COUNT(*)::INTEGER
  INTO v_cantidad_alumnos
  FROM clase_ocurrencia_alumnos
  WHERE club_id = v_club_id
    AND clase_id = v_cobro.clase_id
    AND fecha = v_cobro.fecha;

  IF v_cantidad_alumnos > 0 THEN
    v_cuota_base := TRUNC(v_saldo_a_distribuir / v_cantidad_alumnos, 2);
    v_centavos_extra := ROUND(
      (v_saldo_a_distribuir - v_cuota_base * v_cantidad_alumnos) * 100
    )::INTEGER;

    FOR v_alumno IN
      SELECT
        a.id,
        COALESCE(SUM(c.monto_clase), 0)::NUMERIC(12,2) AS monto_pagado
      FROM clase_ocurrencia_alumnos a
      LEFT JOIN clase_cobros c
        ON c.clase_alumno_id = a.id
       AND c.club_id = a.club_id
      WHERE a.club_id = v_club_id
        AND a.clase_id = v_cobro.clase_id
        AND a.fecha = v_cobro.fecha
      GROUP BY a.id
      ORDER BY a.id
    LOOP
      v_indice := v_indice + 1;
      UPDATE clase_ocurrencia_alumnos
      SET monto_clase = v_alumno.monto_pagado + v_cuota_base
        + CASE WHEN v_indice <= v_centavos_extra THEN 0.01 ELSE 0 END
      WHERE id = v_alumno.id
        AND club_id = v_club_id;
    END LOOP;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_borrar_cobro_clase(BIGINT)
  TO authenticated;

COMMIT;
