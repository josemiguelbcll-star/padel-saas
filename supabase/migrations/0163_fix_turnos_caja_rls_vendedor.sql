-- ============================================================================
-- 0163_fix_turnos_caja_rls_vendedor.sql
-- Soluciona error 42501 (RLS violation) al abrir o cerrar caja como vendedor:
-- 1. Actualiza las políticas RLS de turnos_caja para que cualquier usuario
--    autorizado (admin o vendedor) pueda ver, insertar y actualizar las cajas de su club.
-- 2. Define fn_abrir_caja y fn_cerrar_caja como SECURITY DEFINER para evitar
--    conflictos de evaluación de políticas RLS sobre RETURNING *.
-- ============================================================================

BEGIN;

-- ── 1. Políticas RLS en turnos_caja ──────────────────────────────────────────

DROP POLICY IF EXISTS "turnos_caja_select_admin_o_propio_vendedor" ON turnos_caja;
DROP POLICY IF EXISTS "turnos_caja_select_propio_club" ON turnos_caja;

CREATE POLICY "turnos_caja_select_propio_club"
ON turnos_caja FOR SELECT TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR cerrada_en IS NULL
    OR vendedor_id = auth.uid()
    OR usuario_apertura = auth.uid()
    OR usuario_cierre = auth.uid()
    OR (
      current_user_rol() = 'vendedor'
      AND EXISTS (
        SELECT 1
        FROM usuarios u
        WHERE u.id = auth.uid()
          AND u.club_id = current_club_id()
          AND (
            u.permisos #>> '{modulos,caja_arqueos,ver}' = 'true'
            OR u.permisos #>> '{modulos,caja,ver}' = 'true'
          )
      )
    )
  )
);

DROP POLICY IF EXISTS "turnos_caja_insert_admin_o_vendedor" ON turnos_caja;

CREATE POLICY "turnos_caja_insert_admin_o_vendedor"
ON turnos_caja FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin','vendedor')
    OR has_user_permission('caja', 'crear')
    OR has_user_permission('caja', 'editar')
  )
);

DROP POLICY IF EXISTS "turnos_caja_update_admin_o_vendedor" ON turnos_caja;

CREATE POLICY "turnos_caja_update_admin_o_vendedor"
ON turnos_caja FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin','vendedor')
    OR has_user_permission('caja', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin','vendedor')
    OR has_user_permission('caja', 'editar')
  )
);

-- ── 2. fn_abrir_caja como SECURITY DEFINER ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_abrir_caja(p_monto_apertura DECIMAL)
RETURNS turnos_caja
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_modalidad VARCHAR;
  v_vendedor_id UUID;
  v_turno turnos_caja;
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Sin club asignado.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor')
     AND NOT has_user_permission('caja', 'crear')
     AND NOT has_user_permission('caja', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para abrir la caja.';
  END IF;

  IF p_monto_apertura IS NULL OR p_monto_apertura < 0 THEN
    RAISE EXCEPTION 'El monto de apertura es obligatorio y no puede ser negativo.';
  END IF;

  SELECT modalidad_caja INTO v_modalidad
  FROM clubes WHERE id = v_club_id;

  IF v_modalidad = 'por_vendedor' THEN
    v_vendedor_id := auth.uid();
  ELSE
    v_vendedor_id := NULL;
  END IF;

  BEGIN
    INSERT INTO turnos_caja (
      club_id, fecha_jornada, monto_apertura, usuario_apertura,
      modalidad, vendedor_id
    ) VALUES (
      v_club_id,
      (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::DATE,
      p_monto_apertura,
      auth.uid(),
      v_modalidad,
      v_vendedor_id
    )
    RETURNING * INTO v_turno;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya hay una caja abierta. Cerrá la actual antes de abrir una nueva.';
  END;

  RETURN v_turno;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_abrir_caja(DECIMAL) TO authenticated;

-- ── 3. fn_cerrar_caja como SECURITY DEFINER ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_cerrar_caja(
  p_turno_caja_id BIGINT,
  p_efectivo_contado DECIMAL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS turnos_caja
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_caja;
  v_entradas_cobros DECIMAL(12,2);
  v_movimientos_neto DECIMAL(12,2);
  v_otros_ingresos_efectivo DECIMAL(12,2);
  v_gastos_efectivo DECIMAL(12,2);
  v_cuotas_efectivo DECIMAL(12,2);
  v_transferencias_neto DECIMAL(12,2);
  v_esperado DECIMAL(12,2);
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor')
     AND NOT has_user_permission('caja', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para cerrar la caja.';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio y no puede ser negativo.';
  END IF;

  v_club_id := current_club_id();

  SELECT * INTO v_turno
  FROM turnos_caja
  WHERE id = p_turno_caja_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada.';
  END IF;
  IF v_turno.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta caja ya está cerrada.';
  END IF;

  -- ── Entradas de cobros que entran al cajón (es_caja_fisica) ──────
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'reembolso' THEN -monto ELSE monto END
  ), 0)
  INTO v_entradas_cobros
  FROM (
    SELECT monto, tipo
      FROM reserva_pagos
      WHERE turno_caja_id = p_turno_caja_id
        AND cuenta_id IN (SELECT id FROM cuentas
                          WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    UNION ALL
    SELECT vp.monto, 'pago' AS tipo
      FROM venta_pagos vp
      WHERE vp.turno_caja_id = p_turno_caja_id
        AND vp.cuenta_id IN (SELECT id FROM cuentas
                             WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    UNION ALL
    SELECT monto, 'pago' AS tipo
      FROM clase_cobros
      WHERE turno_caja_id = p_turno_caja_id
        AND cuenta_id IN (SELECT id FROM cuentas
                          WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
  ) entradas;

  -- ── Movimientos manuales (neto) ──────────────────────────────────
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'ajuste_positivo' THEN monto ELSE -monto END
  ), 0)
  INTO v_movimientos_neto
  FROM caja_movimientos_manuales
  WHERE turno_caja_id = p_turno_caja_id;

  -- ── Otros ingresos al cajón (SUMAN) ──────────────────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_otros_ingresos_efectivo
  FROM otros_ingresos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Gastos pagados directo del cajón (RESTAN) ────────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_gastos_efectivo
  FROM gastos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Cuotas de gastos pagadas del cajón (RESTAN) ──────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_cuotas_efectivo
  FROM gasto_cuotas
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE);

  -- ── Transferencias que mueven efectivo del cajón ──────────────────
  SELECT COALESCE(SUM(
    (CASE WHEN cuenta_destino_id IN (SELECT id FROM cuentas
          WHERE club_id = v_club_id AND es_caja_fisica = TRUE) THEN monto ELSE 0 END)
    -
    (CASE WHEN cuenta_origen_id  IN (SELECT id FROM cuentas
          WHERE club_id = v_club_id AND es_caja_fisica = TRUE) THEN monto ELSE 0 END)
  ), 0)
  INTO v_transferencias_neto
  FROM transferencias
  WHERE turno_caja_id = p_turno_caja_id;

  v_esperado := v_turno.monto_apertura
              + v_entradas_cobros
              + v_movimientos_neto
              + v_otros_ingresos_efectivo
              - v_gastos_efectivo
              - v_cuotas_efectivo
              + v_transferencias_neto;

  UPDATE turnos_caja
  SET cerrada_en = NOW(),
      usuario_cierre = auth.uid(),
      efectivo_esperado = v_esperado,
      efectivo_contado = p_efectivo_contado,
      diferencia = p_efectivo_contado - v_esperado,
      observaciones_cierre = p_observaciones
  WHERE id = p_turno_caja_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cerrar_caja(BIGINT, DECIMAL, TEXT) TO authenticated;

COMMIT;
