-- ============================================================================
-- Migración 0168: Permiso granular para editar/anular Cuentas por Pagar
-- ============================================================================
-- Admin conserva acceso total. Los vendedores solo pueden editar o anular
-- deudas si el admin les concede cuentas_por_pagar.editar. El permiso queda
-- denegado por defecto en has_user_permission cuando no está configurado.
--
-- La edición puntual de una cuota modifica monto + vencimiento y ajusta el
-- monto del gasto madre por la diferencia, manteniendo:
--   SUM(gasto_cuotas.monto WHERE gasto_id = X) = gastos.monto
--
-- La anulación sigue siendo soft-delete auditado y conserva las guardas
-- existentes (no cuotas pagadas, no gastos de órdenes de compra).
-- ============================================================================

BEGIN;

-- Los UPDATE directos respetan el mismo permiso que las RPC de edición.
DROP POLICY IF EXISTS "gastos_update_admin_o_vendedor" ON public.gastos;
CREATE POLICY "gastos_update_admin_o_permiso_cxp"
ON public.gastos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('cuentas_por_pagar', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('cuentas_por_pagar', 'editar')
  )
);

DROP POLICY IF EXISTS "gasto_cuotas_update" ON public.gasto_cuotas;
CREATE POLICY "gasto_cuotas_update_admin_o_permiso_cxp"
ON public.gasto_cuotas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('cuentas_por_pagar', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('cuentas_por_pagar', 'editar')
  )
);

-- El pago y la anulación de un pago tienen sus propias validaciones de caja y
-- permisos dentro de las RPC. Ejecutarlas como SECURITY DEFINER permite
-- mantener ese flujo sin abrir UPDATE directo sobre gasto_cuotas.
-- Desde 0058, la firma vigente agrega p_cuenta_id BIGINT (con DEFAULT NULL).
ALTER FUNCTION public.fn_pagar_cuota(BIGINT, DATE, VARCHAR, BIGINT) SECURITY DEFINER;
ALTER FUNCTION public.fn_anular_pago_cuota(BIGINT, VARCHAR, TEXT) SECURITY DEFINER;

-- Edición de gastos: mismo cuerpo vigente de 0105, con autorización granular.
CREATE OR REPLACE FUNCTION public.fn_actualizar_gasto(
  p_gasto_id BIGINT,
  p_categoria_id BIGINT,
  p_monto DECIMAL,
  p_fecha_gasto DATE,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_proveedor_id BIGINT DEFAULT NULL,
  p_proveedor_nombre VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL
)
RETURNS public.gastos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_gasto public.gastos;
  v_categoria public.categorias_gasto;
  v_unidad public.unidades_negocio;
  v_proveedor_nombre VARCHAR;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
  v_turno_caja_id BIGINT := NULL;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('cuentas_por_pagar', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para editar cuentas por pagar.';
  END IF;

  SELECT * INTO v_gasto
  FROM public.gastos
  WHERE id = p_gasto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto no existe o no pertenece a tu club.';
  END IF;

  -- Para vendedores, esta RPC solo puede corregir una deuda sin pagos,
  -- fuera de órdenes de compra y con cuota única. Las cuotas múltiples se
  -- editan individualmente desde Cuentas por Pagar.
  IF current_user_rol() <> 'admin' AND NOT current_user_is_plataforma_admin() THEN
    IF v_gasto.fecha_pago IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.gasto_cuotas gc
         WHERE gc.gasto_id = p_gasto_id AND gc.fecha_pago IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'Solo podés editar gastos pendientes y sin pagos.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.compras c
      WHERE c.gasto_id = p_gasto_id AND c.club_id = v_club_id
    ) THEN
      RAISE EXCEPTION 'Los gastos de órdenes de compra se corrigen desde la orden de compra.';
    END IF;

    IF (
      SELECT COUNT(*) FROM public.gasto_cuotas gc
      WHERE gc.gasto_id = p_gasto_id AND gc.club_id = v_club_id
    ) <> 1 THEN
      RAISE EXCEPTION 'Editá cada cuota por separado desde Cuentas por Pagar.';
    END IF;

    IF p_fecha_pago IS NOT NULL OR p_medio_pago IS NOT NULL OR p_cuenta_id IS NOT NULL THEN
      RAISE EXCEPTION 'Registrá los pagos desde la acción Pagar de Cuentas por Pagar.';
    END IF;
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  IF p_fecha_gasto IS NULL THEN
    RAISE EXCEPTION 'La fecha del gasto es obligatoria.';
  END IF;

  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION 'Debés indicar fecha de pago y medio de pago conjuntamente.';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro','cuenta_corriente') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  SELECT * INTO v_categoria
  FROM public.categorias_gasto
  WHERE id = p_categoria_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría indicada no existe.';
  END IF;

  SELECT * INTO v_unidad
  FROM public.unidades_negocio
  WHERE id = v_categoria.unidad_id AND club_id = v_club_id;

  IF p_proveedor_id IS NOT NULL THEN
    SELECT nombre INTO v_proveedor_nombre
    FROM public.proveedores
    WHERE id = p_proveedor_id AND club_id = v_club_id;
  ELSE
    v_proveedor_nombre := NULLIF(TRIM(COALESCE(p_proveedor_nombre, '')), '');
  END IF;

  IF p_fecha_pago IS NOT NULL THEN
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = p_cuenta_id AND club_id = v_club_id;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;

    IF COALESCE(v_es_caja, FALSE) THEN
      v_turno_caja_id := v_gasto.turno_caja_id;
      IF v_turno_caja_id IS NULL THEN
        v_turno_caja_id := current_club_caja_abierta();
      END IF;
    END IF;
  END IF;

  UPDATE public.gastos
  SET categoria_id = v_categoria.id,
      categoria_nombre = v_categoria.nombre,
      unidad_id = v_unidad.id,
      unidad_nombre = v_unidad.nombre,
      unidad_tipo = v_unidad.tipo,
      proveedor_id = p_proveedor_id,
      proveedor = v_proveedor_nombre,
      monto = p_monto,
      fecha_gasto = p_fecha_gasto,
      fecha_pago = p_fecha_pago,
      medio_pago = p_medio_pago,
      cuenta_id = v_cuenta_id,
      turno_caja_id = v_turno_caja_id,
      observaciones = p_observaciones
  WHERE id = p_gasto_id
  RETURNING * INTO v_gasto;

  UPDATE public.gasto_cuotas
  SET monto = p_monto,
      fecha_vencimiento = COALESCE(p_fecha_pago, p_fecha_gasto),
      fecha_pago = p_fecha_pago,
      medio_pago = p_medio_pago,
      cuenta_id = v_cuenta_id,
      turno_caja_id = v_turno_caja_id
  WHERE gasto_id = p_gasto_id AND numero_cuota = 1 AND total_cuotas = 1;

  RETURN v_gasto;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_actualizar_gasto(
  BIGINT, BIGINT, DECIMAL, DATE, DATE, VARCHAR, BIGINT, VARCHAR, TEXT, BIGINT
) TO authenticated;

-- Anulación auditada de una deuda, con las guardas contables vigentes de 0048.
CREATE OR REPLACE FUNCTION public.fn_anular_gasto(
  p_gasto_id BIGINT,
  p_motivo_tipo VARCHAR,
  p_motivo_detalle TEXT DEFAULT NULL
)
RETURNS public.anulaciones
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_gasto public.gastos;
  v_motivo_detalle TEXT;
  v_anulacion public.anulaciones;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('cuentas_por_pagar', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para anular cuentas por pagar.';
  END IF;

  IF p_motivo_tipo IS NULL OR p_motivo_tipo NOT IN (
    'error_monto','error_carga_duplicado','error_medio_pago','devolucion_proveedor','otro'
  ) THEN
    RAISE EXCEPTION 'Motivo de anulación inválido.';
  END IF;

  v_motivo_detalle := NULLIF(TRIM(COALESCE(p_motivo_detalle, '')), '');
  IF p_motivo_tipo = 'otro' AND v_motivo_detalle IS NULL THEN
    RAISE EXCEPTION 'Si el motivo es "otro", contá brevemente qué pasó en el detalle.';
  END IF;

  SELECT * INTO v_gasto
  FROM public.gastos
  WHERE id = p_gasto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El gasto no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_gasto.activo THEN
    RAISE EXCEPTION 'Este gasto ya está anulado.';
  END IF;

  PERFORM 1 FROM public.gasto_cuotas
  WHERE gasto_id = p_gasto_id AND club_id = v_club_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.gasto_cuotas
    WHERE gasto_id = p_gasto_id AND club_id = v_club_id AND fecha_pago IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Este gasto tiene cuotas pagadas. Anulá primero el/los pagos (desde Cuentas por Pagar) y después el gasto.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.compras
    WHERE gasto_id = p_gasto_id AND club_id = v_club_id
  ) THEN
    RAISE EXCEPTION
      'Este gasto proviene de una orden de compra. Para corregirlo, anulá la compra (acción no disponible todavía).';
  END IF;

  UPDATE public.gastos SET activo = FALSE WHERE id = p_gasto_id;

  INSERT INTO public.anulaciones (
    club_id, entidad_tipo, gasto_id, gasto_cuota_id,
    motivo_tipo, motivo_detalle,
    monto, fecha_original, medio_pago_original,
    caja_original_id, caja_original_cerrada, caja_movimiento_id,
    usuario_id
  ) VALUES (
    v_club_id, 'gasto', p_gasto_id, NULL,
    p_motivo_tipo, v_motivo_detalle,
    v_gasto.monto, v_gasto.fecha_gasto, NULL,
    NULL, NULL, NULL,
    v_usuario_id
  )
  RETURNING * INTO v_anulacion;

  RETURN v_anulacion;
END;
$$;

COMMENT ON FUNCTION public.fn_anular_gasto(BIGINT, VARCHAR, TEXT) IS
  'Anula un gasto con rastro auditable. Requiere cuentas_por_pagar.editar;
   rechaza cuotas pagadas y gastos originados en órdenes de compra.';

GRANT EXECUTE ON FUNCTION public.fn_anular_gasto(BIGINT, VARCHAR, TEXT)
  TO authenticated;

-- Edición de una cuota pendiente, preservando el total agregado del gasto.
CREATE OR REPLACE FUNCTION public.fn_actualizar_cuota_cxp(
  p_cuota_id BIGINT,
  p_monto NUMERIC,
  p_fecha_vencimiento DATE
)
RETURNS public.gasto_cuotas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_gasto_id BIGINT;
  v_gasto public.gastos;
  v_cuota public.gasto_cuotas;
BEGIN
  v_club_id := current_club_id();

  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('cuentas_por_pagar', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para editar cuentas por pagar.';
  END IF;

  SELECT gc.gasto_id INTO v_gasto_id
  FROM public.gasto_cuotas gc
  WHERE gc.id = p_cuota_id AND gc.club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuota no existe o no pertenece a tu club.';
  END IF;

  SELECT * INTO v_gasto
  FROM public.gastos g
  WHERE g.id = v_gasto_id AND g.club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_gasto.activo THEN
    RAISE EXCEPTION 'El gasto no existe, no pertenece a tu club o está anulado.';
  END IF;

  SELECT * INTO v_cuota
  FROM public.gasto_cuotas gc
  WHERE gc.id = p_cuota_id AND gc.gasto_id = v_gasto_id AND gc.club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuota no existe o no pertenece a tu club.';
  END IF;
  IF v_cuota.fecha_pago IS NOT NULL THEN
    RAISE EXCEPTION 'Solo se pueden editar cuotas pendientes.';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a 0.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.compras c
    WHERE c.gasto_id = v_gasto_id AND c.club_id = v_club_id
  ) THEN
    RAISE EXCEPTION 'Las cuotas de órdenes de compra se corrigen desde la orden de compra.';
  END IF;

  UPDATE public.gastos g
  SET monto = g.monto + (p_monto - v_cuota.monto)
  WHERE g.id = v_gasto_id AND g.club_id = v_club_id;

  UPDATE public.gasto_cuotas gc
  SET monto = p_monto,
      fecha_vencimiento = p_fecha_vencimiento
  WHERE gc.id = p_cuota_id AND gc.gasto_id = v_gasto_id
  RETURNING * INTO v_cuota;

  RETURN v_cuota;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_actualizar_cuota_cxp(BIGINT, NUMERIC, DATE)
  TO authenticated;

COMMIT;
