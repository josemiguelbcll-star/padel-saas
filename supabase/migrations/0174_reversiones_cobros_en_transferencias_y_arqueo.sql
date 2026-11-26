-- 0171 — Que un pago anulado desaparezca de Transferencias y del arqueo
--
-- Problema reportado por el club: anulan un pago (turno, consumición o
-- clase) y "se cancela en el turno pero no en el arqueo de caja, esa plata
-- se sigue contando". Tres huecos concretos:
--
--   1. fn_transferencias_dia (0066) lista ventas por `ventas.medio_pago` /
--      `monto_total` SIN filtrar `activa`. Una venta anulada (fn_anular_venta
--      solo marca activa=false) SIGUE apareciendo en Transferencias.
--      Fix: `AND v.activa = TRUE` en la rama de ventas.
--      (reserva_pagos y clase_cobros ya leen filas vivas → el DELETE ya las
--      saca de la lista; no se tocan.)
--
--   2. fn_eliminar_pago_reserva (0154) genera el ajuste_negativo de una caja
--      cerrada SOLO si `medio_pago='efectivo'`. Pero el arqueo cuenta por
--      CUENTA (`cuentas.es_caja_fisica`), no por medio: un cobro con cuenta
--      física y medio distinto (ej. transferencia cuya cuenta default es la
--      caja) entró al arqueo y al borrarlo no generaba ajuste → la plata
--      seguía contando. Fix: mismo criterio que fn_anular_venta — ajustar si
--      la cuenta es física (o cuenta NULL + medio efectivo, datos viejos).
--
--   3. fn_borrar_cobro_clase (0140) es un DELETE pelado: no chequea caja
--      cerrada, no pide motivo, no audita, no genera ajuste. Si el cobro de
--      clase entró a una caja ya cerrada, la plata quedaba contando sin
--      rastro. Fix: mismo patrón que 0154 — caja cerrada ⇒ solo admin +
--      motivo + snapshot en clase_cobros_correcciones + ajuste_negativo en
--      la caja abierta actual si el cobro fue a cuenta física.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Auditoría de correcciones de cobros de clase (espejo de 0154)
-- ----------------------------------------------------------------------------
CREATE TABLE public.clase_cobros_correcciones (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id),
  -- Sin FK a clases/clase_cobros: la auditoría debe sobrevivir al borrado.
  clase_id BIGINT NOT NULL,
  clase_cobro_id BIGINT NOT NULL,
  fecha DATE NOT NULL,
  motivo TEXT NOT NULL,
  snapshot_cobro JSONB NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  medio_pago VARCHAR(30) NOT NULL,
  cuenta_id BIGINT,
  turno_caja_id BIGINT,
  usuario_id UUID NOT NULL REFERENCES auth.users(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clase_cobros_correcciones_club_fecha
  ON public.clase_cobros_correcciones(club_id, fecha_hora);
CREATE INDEX idx_clase_cobros_correcciones_clase
  ON public.clase_cobros_correcciones(clase_id);

ALTER TABLE public.clase_cobros_correcciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY clase_cobros_correcciones_select
  ON public.clase_cobros_correcciones FOR SELECT TO authenticated
  USING (club_id = public.current_club_id());
GRANT SELECT ON public.clase_cobros_correcciones TO authenticated;

COMMENT ON TABLE public.clase_cobros_correcciones IS
  'Auditoría de correcciones (borrados) de cobros de clase que ya habían
   entrado a una caja cerrada. Solo un admin puede hacerlas; requiere motivo.';

-- ----------------------------------------------------------------------------
-- 2. fn_transferencias_dia — excluir ventas anuladas
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transferencias_dia(
  p_desde DATE,
  p_hasta DATE
)
RETURNS TABLE (
  id               TEXT,
  fecha_hora       TIMESTAMPTZ,
  origen           TEXT,
  nombre           TEXT,
  quien_transfirio TEXT,
  monto            NUMERIC,
  cuenta_id        BIGINT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  WITH bounds AS (
    SELECT
      (p_desde::timestamp       AT TIME ZONE 'America/Argentina/Buenos_Aires') AS desde_ts,
      ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') AS hasta_ts
  )
  -- 1. Turnos (reserva_pagos), excluye reembolsos
  SELECT
    'turno:' || rp.id::text,
    rp.fecha_hora,
    'turno'::text,
    COALESCE(j.nombre, rj.nombre_libre, 'Invitado'),
    rp.observaciones,
    rp.monto::numeric,
    rp.cuenta_id
  FROM reserva_pagos rp
  CROSS JOIN bounds b
  LEFT JOIN jugadores j          ON j.id  = rp.jugador_id
  LEFT JOIN reserva_jugadores rj ON rj.id = rp.reserva_jugador_id
  WHERE rp.medio_pago = 'transferencia'
    AND rp.tipo <> 'reembolso'
    AND rp.fecha_hora >= b.desde_ts
    AND rp.fecha_hora <  b.hasta_ts

  UNION ALL
  -- 2. Ventas de mostrador — SOLO activas (las anuladas ya no son
  --    transferencias vigentes; su reversión vive en venta_pagos_reversiones)
  SELECT
    'venta:' || v.id::text,
    v.fecha_hora,
    'venta'::text,
    'Venta mostrador'::text,
    NULL::text,
    v.monto_total::numeric,
    v.cuenta_id
  FROM ventas v
  CROSS JOIN bounds b
  WHERE v.medio_pago = 'transferencia'
    AND v.activa = TRUE
    AND v.fecha_hora >= b.desde_ts
    AND v.fecha_hora <  b.hasta_ts

  UNION ALL
  -- 3. Cobros de clase
  SELECT
    'clase:' || cc.id::text,
    cc.fecha_hora,
    'clase'::text,
    'Cobro de clase'::text,
    NULL::text,
    cc.monto::numeric,
    cc.cuenta_id
  FROM clase_cobros cc
  CROSS JOIN bounds b
  WHERE cc.medio_pago = 'transferencia'
    AND cc.fecha_hora >= b.desde_ts
    AND cc.fecha_hora <  b.hasta_ts

  ORDER BY fecha_hora DESC;
$$;

-- ----------------------------------------------------------------------------
-- 3. fn_eliminar_pago_reserva — ajuste por CUENTA física, no por medio_pago
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_eliminar_pago_reserva(
  p_pago_id BIGINT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pago reserva_pagos;
  v_reserva reservas;
  v_rol TEXT := current_user_rol();
  v_caja_cerrada BOOLEAN := FALSE;
  v_turno_caja turnos_caja;
  v_caja_abierta BIGINT;
  v_nuevo_monto_pagado DECIMAL(12,2) := 0;
  v_nuevo_monto_sena DECIMAL(12,2) := 0;
  v_nuevo_estado VARCHAR(20);
  v_total_pagado_persona DECIMAL(12,2) := 0;
  v_entro_al_cajon BOOLEAN := FALSE;
BEGIN
  IF v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar pagos de reservas.';
  END IF;

  SELECT * INTO v_pago
  FROM reserva_pagos
  WHERE id = p_pago_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pago no existe o no pertenece a tu club.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_pago.reserva_id AND club_id = current_club_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva asociada al pago no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cerrada' THEN
    RAISE EXCEPTION 'No se pueden eliminar pagos de un turno que ya ha sido cerrado.';
  END IF;

  -- ¿El cobro entró a una caja que ya está cerrada?
  IF v_pago.turno_caja_id IS NOT NULL THEN
    SELECT * INTO v_turno_caja
    FROM turnos_caja
    WHERE id = v_pago.turno_caja_id;
    IF FOUND AND v_turno_caja.cerrada_en IS NOT NULL THEN
      v_caja_cerrada := TRUE;
    END IF;
  END IF;

  -- ¿La plata de este cobro entró al cajón físico? El arqueo cuenta por
  -- CUENTA (es_caja_fisica), no por medio_pago — mismo criterio que
  -- fn_anular_venta. Fallback: cuenta NULL + medio efectivo (datos viejos).
  SELECT EXISTS (
    SELECT 1 FROM cuentas c
    WHERE c.id = v_pago.cuenta_id
      AND c.club_id = current_club_id()
      AND c.es_caja_fisica = TRUE
  ) INTO v_entro_al_cajon;
  IF NOT v_entro_al_cajon AND v_pago.cuenta_id IS NULL
     AND v_pago.medio_pago = 'efectivo' THEN
    v_entro_al_cajon := TRUE;
  END IF;

  IF v_caja_cerrada THEN
    IF v_rol <> 'admin' THEN
      RAISE EXCEPTION 'Este cobro ya fue cerrado en caja. Solo un administrador puede corregirlo, indicando el motivo.';
    END IF;
    IF NULLIF(BTRIM(p_motivo), '') IS NULL THEN
      RAISE EXCEPTION 'Indicá el motivo de la corrección.';
    END IF;

    INSERT INTO public.reserva_pagos_correcciones (
      club_id, reserva_id, reserva_pago_id, motivo, snapshot_pago,
      monto, medio_pago, turno_caja_id, usuario_id
    ) VALUES (
      current_club_id(), v_reserva.id, v_pago.id, BTRIM(p_motivo), to_jsonb(v_pago),
      v_pago.monto, v_pago.medio_pago, v_pago.turno_caja_id, auth.uid()
    );

    -- Si la plata entró al cajón, el ajuste negativo va a la caja ABIERTA
    -- actual para que no quede atribuida a una caja que no la recibió.
    IF v_entro_al_cajon THEN
      v_caja_abierta := current_club_caja_abierta();
      IF v_caja_abierta IS NULL THEN
        RAISE EXCEPTION 'No hay caja abierta para registrar la corrección del cobro.';
      END IF;
      INSERT INTO public.caja_movimientos_manuales (
        club_id, turno_caja_id, tipo, monto, concepto, observaciones, usuario_id
      ) VALUES (
        current_club_id(), v_caja_abierta, 'ajuste_negativo', v_pago.monto,
        'Corrección de cobro (reserva #' || v_reserva.id || ')',
        BTRIM(p_motivo), auth.uid()
      );
    END IF;
  END IF;

  DELETE FROM reserva_pagos
  WHERE id = p_pago_id;

  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(CASE WHEN tipo = 'sena' THEN monto ELSE 0 END), 0)
  INTO v_nuevo_monto_pagado, v_nuevo_monto_sena
  FROM reserva_pagos
  WHERE reserva_id = v_reserva.id;

  IF v_reserva.estado NOT IN ('cancelada', 'cerrada', 'jugada') THEN
    IF v_nuevo_monto_pagado >= v_reserva.monto_total AND v_reserva.monto_total > 0 THEN
      v_nuevo_estado := 'pagada';
    ELSIF v_nuevo_monto_pagado > 0 THEN
      v_nuevo_estado := 'senada';
    ELSE
      v_nuevo_estado := 'pendiente';
    END IF;
  ELSE
    v_nuevo_estado := v_reserva.estado;
  END IF;

  UPDATE reservas
  SET
    monto_pagado = LEAST(v_reserva.monto_total, v_nuevo_monto_pagado),
    monto_sena = v_nuevo_monto_sena,
    estado = v_nuevo_estado
  WHERE id = v_reserva.id;

  IF v_pago.reserva_jugador_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado_persona
    FROM reserva_pagos
    WHERE reserva_jugador_id = v_pago.reserva_jugador_id;

    IF v_total_pagado_persona = 0 THEN
      UPDATE reserva_jugadores
      SET cuota_fija = NULL
      WHERE id = v_pago.reserva_jugador_id;
    ELSE
      UPDATE reserva_jugadores
      SET cuota_fija = v_total_pagado_persona
      WHERE id = v_pago.reserva_jugador_id
        AND cuota_fija IS NOT NULL
        AND cuota_fija > v_total_pagado_persona;
    END IF;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. fn_borrar_cobro_clase — guarda de caja cerrada + ajuste + auditoría
-- ----------------------------------------------------------------------------
-- Se dropea la firma de 1 arg (0140) y se crea con p_motivo DEFAULT NULL:
-- el frontend actual (p_cobro_id solo) sigue funcionando; el motivo solo
-- se exige cuando el cobro ya entró a una caja cerrada.
DROP FUNCTION IF EXISTS public.fn_borrar_cobro_clase(BIGINT);

CREATE FUNCTION public.fn_borrar_cobro_clase(
  p_cobro_id BIGINT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := current_club_id();
  v_rol TEXT := current_user_rol();
  v_cobro clase_cobros%ROWTYPE;
  v_caja_cerrada BOOLEAN := FALSE;
  v_turno_caja turnos_caja;
  v_caja_abierta BIGINT;
  v_entro_al_cajon BOOLEAN := FALSE;
  v_total_clase NUMERIC(12,2);
  v_total_cobrado NUMERIC(12,2);
  v_saldo_a_distribuir NUMERIC(12,2);
  v_cantidad_alumnos INTEGER;
  v_alumno RECORD;
  v_cuota_base NUMERIC(12,2);
  v_centavos_extra INTEGER;
  v_indice INTEGER := 0;
BEGIN
  IF v_rol NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para eliminar cobros de clases.';
  END IF;

  SELECT * INTO v_cobro
  FROM clase_cobros
  WHERE id = p_cobro_id
    AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cobro no existe o no pertenece a tu club.';
  END IF;

  -- ¿El cobro entró a una caja que ya está cerrada?
  IF v_cobro.turno_caja_id IS NOT NULL THEN
    SELECT * INTO v_turno_caja
    FROM turnos_caja
    WHERE id = v_cobro.turno_caja_id;
    IF FOUND AND v_turno_caja.cerrada_en IS NOT NULL THEN
      v_caja_cerrada := TRUE;
    END IF;
  END IF;

  -- ¿La plata entró al cajón físico? (cuenta es_caja_fisica, o cuenta NULL
  -- + medio efectivo para datos viejos — mismo criterio que fn_anular_venta)
  SELECT EXISTS (
    SELECT 1 FROM cuentas c
    WHERE c.id = v_cobro.cuenta_id
      AND c.club_id = v_club_id
      AND c.es_caja_fisica = TRUE
  ) INTO v_entro_al_cajon;
  IF NOT v_entro_al_cajon AND v_cobro.cuenta_id IS NULL
     AND v_cobro.medio_pago = 'efectivo' THEN
    v_entro_al_cajon := TRUE;
  END IF;

  IF v_caja_cerrada THEN
    IF v_rol <> 'admin' THEN
      RAISE EXCEPTION 'Este cobro ya fue cerrado en caja. Solo un administrador puede corregirlo, indicando el motivo.';
    END IF;
    IF NULLIF(BTRIM(p_motivo), '') IS NULL THEN
      RAISE EXCEPTION 'Indicá el motivo de la corrección.';
    END IF;

    INSERT INTO public.clase_cobros_correcciones (
      club_id, clase_id, clase_cobro_id, fecha, motivo, snapshot_cobro,
      monto, medio_pago, cuenta_id, turno_caja_id, usuario_id
    ) VALUES (
      v_club_id, v_cobro.clase_id, v_cobro.id, v_cobro.fecha,
      BTRIM(p_motivo), to_jsonb(v_cobro),
      v_cobro.monto, v_cobro.medio_pago, v_cobro.cuenta_id,
      v_cobro.turno_caja_id, auth.uid()
    );

    -- Si la plata entró al cajón, el ajuste negativo va a la caja ABIERTA
    -- actual (la caja original ya está cerrada y no se puede tocar).
    IF v_entro_al_cajon THEN
      v_caja_abierta := current_club_caja_abierta();
      IF v_caja_abierta IS NULL THEN
        RAISE EXCEPTION 'No hay caja abierta para registrar la corrección del cobro.';
      END IF;
      INSERT INTO public.caja_movimientos_manuales (
        club_id, turno_caja_id, tipo, monto, concepto, observaciones, usuario_id
      ) VALUES (
        v_club_id, v_caja_abierta, 'ajuste_negativo', v_cobro.monto,
        'Corrección de cobro de clase (clase #' || v_cobro.clase_id || ')',
        BTRIM(p_motivo), auth.uid()
      );
    END IF;
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

  -- Recalcular cuotas de alumnos (idéntico a la 0140).
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

GRANT EXECUTE ON FUNCTION public.fn_borrar_cobro_clase(BIGINT, TEXT)
  TO authenticated;

COMMIT;
