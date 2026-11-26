-- 0177 — Permisos granulares: órdenes de compra y anular/corregir ventas
--
-- Convierte dos operaciones que hoy son admin-only (o están abiertas a
-- cualquier usuario autenticado del club) en permisos configurables por el
-- admin del club, con default APAGADO para vendedores:
--
--   * ordenes_compra.editar → fn_crear_oc / fn_actualizar_oc / fn_cancelar_oc
--     (antes: inventario.editar en crear, admin-only en actualizar/cancelar).
--   * ventas.editar         → fn_anular_venta / fn_corregir_venta
--     (antes: SIN gate — cualquier usuario del club podía anular/corregir).
--
-- La recepción de mercadería (fn_recibir_oc) sigue siendo admin-only: es un
-- asiento contable + ingreso de stock, no forma parte del permiso nuevo.
--
-- Las funciones se recrean copiando su versión vigente y cambiando SOLO el
-- chequeo de permiso; el resto del cuerpo es idéntico.

CREATE OR REPLACE FUNCTION public.fn_crear_oc(
  p_proveedor_id BIGINT,
  p_linea VARCHAR,
  p_fecha_oc DATE,
  p_items JSONB,
  p_condicion_pago VARCHAR DEFAULT 'al_recibir',
  p_fecha_compromiso_pago DATE DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS compras
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_proveedor proveedores;
  v_categoria categorias_gasto;
  v_compra compras;
  v_pids BIGINT[];
  v_bultos INT[];
  v_und_por_bulto INT[];
  v_costos_por_bulto DECIMAL(12,2)[];
  v_i INT;
  v_n INT;
  v_producto productos;
  v_cant INT;
  v_costo_unit DECIMAL(12,2);
  v_subtotal DECIMAL(12,2);
  v_monto_neto_oc DECIMAL(12,2) := 0;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF NOT has_user_permission('ordenes_compra', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para crear órdenes de compra.';
  END IF;

  IF p_linea IS NULL OR p_linea NOT IN ('buffet','shop') THEN
    RAISE EXCEPTION 'La línea de la OC debe ser buffet o shop.';
  END IF;
  IF p_fecha_oc IS NULL THEN
    RAISE EXCEPTION 'La fecha de la OC es obligatoria.';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La OC tiene que tener al menos un producto.';
  END IF;
  IF p_condicion_pago IS NULL
     OR p_condicion_pago NOT IN ('al_dia','a_plazo','al_recibir') THEN
    RAISE EXCEPTION 'Condición de pago inválida (al_dia, a_plazo o al_recibir).';
  END IF;
  IF p_condicion_pago = 'a_plazo' AND p_fecha_compromiso_pago IS NULL THEN
    RAISE EXCEPTION 'Si la condición es "a plazo", indicá la fecha de compromiso de pago.';
  END IF;
  IF p_condicion_pago <> 'a_plazo' AND p_fecha_compromiso_pago IS NOT NULL THEN
    RAISE EXCEPTION 'La fecha de compromiso de pago solo aplica con condición "a plazo".';
  END IF;

  SELECT * INTO v_proveedor
  FROM proveedores
  WHERE id = p_proveedor_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_proveedor.activo THEN
    RAISE EXCEPTION
      'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de crear la OC.',
      v_proveedor.nombre;
  END IF;

  SELECT cg.* INTO v_categoria
  FROM categorias_gasto cg
  JOIN unidades_negocio u ON u.id = cg.unidad_id
  WHERE cg.club_id = v_club_id
    AND u.tipo = p_linea
    AND cg.es_mercaderia = TRUE
    AND cg.activa = TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Tu club no tiene una categoría marcada como mercadería para la unidad de %. Andá a Configuración → Categorías de gasto y marcá una.',
      p_linea;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la OC. Consolidá cada producto en una sola línea.';
  END IF;

  SELECT
    array_agg((x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad_bultos')::INT),
    array_agg((x->>'unidades_por_bulto')::INT),
    array_agg((x->>'costo_por_bulto')::DECIMAL(12,2))
  INTO v_pids, v_bultos, v_und_por_bulto, v_costos_por_bulto
  FROM jsonb_array_elements(p_items) x;

  v_n := array_length(v_pids, 1);
  FOR v_i IN 1..v_n LOOP
    IF v_bultos[v_i] IS NULL OR v_bultos[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad de bultos debe ser mayor a 0 (item %).', v_i;
    END IF;
    IF v_und_por_bulto[v_i] IS NULL OR v_und_por_bulto[v_i] <= 0 THEN
      RAISE EXCEPTION 'Las unidades por bulto deben ser mayor a 0 (item %).', v_i;
    END IF;
    IF v_costos_por_bulto[v_i] IS NULL OR v_costos_por_bulto[v_i] < 0 THEN
      RAISE EXCEPTION 'El costo por bulto debe ser >= 0 (item %).', v_i;
    END IF;
  END LOOP;

  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto % no existe o no pertenece a tu club.', v_pids[v_i];
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede pedir.', v_producto.nombre;
    END IF;
    IF v_producto.linea <> p_linea THEN
      RAISE EXCEPTION
        'El producto "%" es de la línea %, no podés cargarlo en una OC de %.',
        v_producto.nombre, v_producto.linea, p_linea;
    END IF;

    v_monto_neto_oc := v_monto_neto_oc
      + (v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i]);
  END LOOP;

  INSERT INTO compras (
    club_id, proveedor_id, tipo, linea, estado,
    fecha_oc, fecha_recepcion, condicion_pago, fecha_compromiso_pago,
    monto_neto_oc, monto_neto, monto_iva, monto_total, gasto_id,
    observaciones, usuario_id
  ) VALUES (
    v_club_id, v_proveedor.id, 'compra', p_linea, 'pedida',
    p_fecha_oc, NULL, p_condicion_pago, p_fecha_compromiso_pago,
    v_monto_neto_oc, NULL, NULL, NULL, NULL,
    p_observaciones, v_usuario_id
  )
  RETURNING * INTO v_compra;

  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i];

    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit := ROUND(
      v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL,
      2
    );
    v_subtotal := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];

    INSERT INTO compra_items (
      club_id, compra_id, producto_id, producto_nombre,
      cantidad, costo_unitario_compra, subtotal, linea,
      cantidad_bultos, unidades_por_bulto, costo_por_bulto,
      tasa_iva, subtotal_iva, subtotal_total, costo_unitario_ppp
    ) VALUES (
      v_club_id, v_compra.id, v_producto.id, v_producto.nombre,
      v_cant, v_costo_unit, v_subtotal, v_producto.linea,
      v_bultos[v_i], v_und_por_bulto[v_i], v_costos_por_bulto[v_i],
      NULL, NULL, NULL, NULL
    );
  END LOOP;

  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION public.fn_crear_oc(
  BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT
) IS
  'Crea una OC pedida con fecha_oc y montos de recepción en NULL. No mueve stock, costo ni gasto.';

GRANT EXECUTE ON FUNCTION public.fn_crear_oc(
  BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION fn_actualizar_oc(
  p_compra_id BIGINT,
  p_proveedor_id BIGINT,
  p_linea VARCHAR,
  p_fecha_oc DATE,
  p_items JSONB,
  p_condicion_pago VARCHAR DEFAULT 'al_recibir',
  p_fecha_compromiso_pago DATE DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS compras
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_compra compras;
  v_proveedor proveedores;
  v_categoria categorias_gasto;
  v_pids BIGINT[];
  v_bultos INT[];
  v_und_por_bulto INT[];
  v_costos_por_bulto DECIMAL(12,2)[];
  v_i INT;
  v_n INT;
  v_producto productos;
  v_cant INT;
  v_costo_unit DECIMAL(12,2);
  v_subtotal DECIMAL(12,2);
  v_monto_neto_oc DECIMAL(12,2) := 0;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF NOT has_user_permission('ordenes_compra', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para editar órdenes de compra.';
  END IF;

  -- Verificar OC.
  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La OC no existe o no pertenece a tu club.';
  END IF;
  IF v_compra.estado <> 'pedida' THEN
    RAISE EXCEPTION 'Solo se pueden editar OCs en estado "pedida". Esta OC está %.', v_compra.estado;
  END IF;

  -- Validaciones idénticas a fn_crear_oc.
  IF p_linea IS NULL OR p_linea NOT IN ('buffet','shop') THEN
    RAISE EXCEPTION 'La línea de la OC debe ser buffet o shop.';
  END IF;
  IF p_fecha_oc IS NULL THEN
    RAISE EXCEPTION 'La fecha de la OC es obligatoria.';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La OC tiene que tener al menos un producto.';
  END IF;
  IF p_condicion_pago IS NULL
     OR p_condicion_pago NOT IN ('al_dia','a_plazo','al_recibir') THEN
    RAISE EXCEPTION 'Condición de pago inválida.';
  END IF;
  IF p_condicion_pago = 'a_plazo' AND p_fecha_compromiso_pago IS NULL THEN
    RAISE EXCEPTION 'Si la condición es "a plazo", indicá la fecha de compromiso de pago.';
  END IF;
  IF p_condicion_pago <> 'a_plazo' AND p_fecha_compromiso_pago IS NOT NULL THEN
    RAISE EXCEPTION 'La fecha de compromiso de pago solo aplica con condición "a plazo".';
  END IF;

  SELECT * INTO v_proveedor
  FROM proveedores WHERE id = p_proveedor_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_proveedor.activo THEN
    RAISE EXCEPTION 'El proveedor "%" está desactivado.', v_proveedor.nombre;
  END IF;

  SELECT cg.* INTO v_categoria
  FROM categorias_gasto cg
  JOIN unidades_negocio u ON u.id = cg.unidad_id
  WHERE cg.club_id = v_club_id AND u.tipo = p_linea
    AND cg.es_mercaderia = TRUE AND cg.activa = TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Tu club no tiene una categoría marcada como mercadería para la unidad de %.',
      p_linea;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la OC.';
  END IF;

  SELECT
    array_agg((x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad_bultos')::INT),
    array_agg((x->>'unidades_por_bulto')::INT),
    array_agg((x->>'costo_por_bulto')::DECIMAL(12,2))
  INTO v_pids, v_bultos, v_und_por_bulto, v_costos_por_bulto
  FROM jsonb_array_elements(p_items) x;

  v_n := array_length(v_pids, 1);

  FOR v_i IN 1..v_n LOOP
    IF v_bultos[v_i] IS NULL OR v_bultos[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad de bultos debe ser mayor a 0 (item %).', v_i;
    END IF;
    IF v_und_por_bulto[v_i] IS NULL OR v_und_por_bulto[v_i] <= 0 THEN
      RAISE EXCEPTION 'Las unidades por bulto deben ser mayor a 0 (item %).', v_i;
    END IF;
    IF v_costos_por_bulto[v_i] IS NULL OR v_costos_por_bulto[v_i] < 0 THEN
      RAISE EXCEPTION 'El costo por bulto debe ser >= 0 (item %).', v_i;
    END IF;
  END LOOP;

  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos WHERE id = v_pids[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto % no existe o no pertenece a tu club.', v_pids[v_i];
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado.', v_producto.nombre;
    END IF;
    IF v_producto.linea <> p_linea THEN
      RAISE EXCEPTION
        'El producto "%" es de la línea %, no podés cargarlo en una OC de %.',
        v_producto.nombre, v_producto.linea, p_linea;
    END IF;
    v_monto_neto_oc := v_monto_neto_oc + (v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i]);
  END LOOP;

  -- DELETE compra_items vigentes (sin movimientos asociados — la OC
  -- en pedida nunca generó movimientos).
  DELETE FROM compra_items WHERE compra_id = p_compra_id;

  -- INSERT compra_items nuevos.
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];
    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);
    v_subtotal := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];

    INSERT INTO compra_items (
      club_id, compra_id, producto_id, producto_nombre,
      cantidad, costo_unitario_compra, subtotal, linea,
      cantidad_bultos, unidades_por_bulto, costo_por_bulto,
      tasa_iva, subtotal_iva, subtotal_total, costo_unitario_ppp
    ) VALUES (
      v_club_id, p_compra_id, v_producto.id, v_producto.nombre,
      v_cant, v_costo_unit, v_subtotal, v_producto.linea,
      v_bultos[v_i], v_und_por_bulto[v_i], v_costos_por_bulto[v_i],
      NULL, NULL, NULL, NULL
    );
  END LOOP;

  -- UPDATE cabecera.
  UPDATE compras
  SET proveedor_id = v_proveedor.id,
      linea = p_linea,
      fecha_oc = p_fecha_oc,
      condicion_pago = p_condicion_pago,
      fecha_compromiso_pago = p_fecha_compromiso_pago,
      monto_neto_oc = v_monto_neto_oc,
      observaciones = p_observaciones
  WHERE id = p_compra_id;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id;
  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION fn_actualizar_oc(BIGINT, BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT) IS
  'Edita una OC en estado=''pedida''. Reemplaza atómicamente cabecera +
   items. Seguro porque una OC pedida nunca asentó movimientos / gasto /
   costo. Rechaza si la OC está recibida o cancelada. Gate: permiso ordenes_compra.editar.';

GRANT EXECUTE ON FUNCTION fn_actualizar_oc(BIGINT, BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION fn_cancelar_oc(
  p_compra_id BIGINT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS compras
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_compra compras;
BEGIN
  v_club_id := current_club_id();
  IF v_club_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF NOT has_user_permission('ordenes_compra', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para cancelar órdenes de compra.';
  END IF;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La OC no existe o no pertenece a tu club.';
  END IF;
  IF v_compra.estado <> 'pedida' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar OCs en estado "pedida". Esta OC está %.', v_compra.estado;
  END IF;

  UPDATE compras
  SET estado = 'cancelada',
      observaciones = CASE
        WHEN p_motivo IS NULL OR LENGTH(TRIM(p_motivo)) = 0 THEN observaciones
        ELSE COALESCE(observaciones || E'\n', '') || 'Cancelada: ' || TRIM(p_motivo)
      END
  WHERE id = p_compra_id;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id;
  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION fn_cancelar_oc(BIGINT, TEXT) IS
  'Cancela una OC en estado=''pedida'' (la pasa a ''cancelada''). No
   toca stock, costo, ni gasto — la OC nunca los impactó. Irreversible
   en este bloque. Gate: permiso ordenes_compra.editar.';

GRANT EXECUTE ON FUNCTION fn_cancelar_oc(BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_anular_venta(
  p_venta_id BIGINT,
  p_motivo TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_usuario_id UUID := auth.uid();
  v_venta public.ventas;
  v_caja_abierta BIGINT;
  v_efectivo DECIMAL(12,2);
  v_mov_id BIGINT;
BEGIN
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión de club activa.';
  END IF;
  IF NOT has_user_permission('ventas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para anular ventas.';
  END IF;
  IF NULLIF(BTRIM(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Indicá el motivo de la anulación.';
  END IF;

  SELECT * INTO v_venta
  FROM public.ventas
  WHERE id = p_venta_id AND club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la venta en este club.';
  END IF;
  IF NOT v_venta.activa THEN
    RAISE EXCEPTION 'La venta ya está anulada.';
  END IF;

  PERFORM 1
  FROM public.productos p
  JOIN public.venta_items vi ON vi.producto_id = p.id
  WHERE vi.venta_id = p_venta_id AND vi.club_id = v_club_id
    AND p.club_id = v_club_id
  ORDER BY p.id
  FOR UPDATE OF p;

  INSERT INTO public.ventas_correcciones (
    club_id, venta_id, motivo, snapshot_venta, usuario_id
  )
  SELECT v_club_id, p_venta_id, BTRIM(p_motivo),
    jsonb_build_object(
      'venta', to_jsonb(v_venta),
      'items', COALESCE((SELECT jsonb_agg(to_jsonb(vi)) FROM public.venta_items vi
        WHERE vi.venta_id = p_venta_id), '[]'::jsonb),
      'pagos', COALESCE((SELECT jsonb_agg(to_jsonb(vp)) FROM public.venta_pagos vp
        WHERE vp.venta_id = p_venta_id), '[]'::jsonb)
    ), v_usuario_id;

  INSERT INTO public.movimientos_stock (
    club_id, producto_id, cantidad, fuente, venta_id, observaciones, usuario_id
  )
  SELECT vi.club_id, vi.producto_id, vi.cantidad, 'anulacion_venta',
    p_venta_id, 'Reversión de venta #' || p_venta_id || ': ' || BTRIM(p_motivo), v_usuario_id
  FROM public.venta_items vi
  WHERE vi.venta_id = p_venta_id AND vi.club_id = v_club_id;

  INSERT INTO public.venta_pagos_reversiones (
    club_id, venta_id, venta_pago_id, monto, medio_pago, cuenta_id, usuario_id
  )
  SELECT vp.club_id, vp.venta_id, vp.id, vp.monto, vp.medio_pago, vp.cuenta_id, v_usuario_id
  FROM public.venta_pagos vp
  WHERE vp.venta_id = p_venta_id AND vp.club_id = v_club_id;

  SELECT COALESCE(SUM(vp.monto), 0) INTO v_efectivo
  FROM public.venta_pagos vp
  LEFT JOIN public.cuentas c ON c.id = vp.cuenta_id AND c.club_id = v_club_id
  WHERE vp.venta_id = p_venta_id
    AND (
      c.es_caja_fisica = TRUE
      OR (vp.cuenta_id IS NULL AND vp.medio_pago = 'efectivo')
    );

  IF v_efectivo > 0 THEN
    v_caja_abierta := public.current_club_caja_abierta();
    IF v_caja_abierta IS NULL THEN
      RAISE EXCEPTION 'No hay caja abierta para registrar la reversión del efectivo.';
    END IF;
    INSERT INTO public.caja_movimientos_manuales (
      club_id, turno_caja_id, tipo, monto, concepto, usuario_id
    ) VALUES (
      v_club_id, v_caja_abierta, 'ajuste_negativo', v_efectivo,
      'Reversión de la venta #' || p_venta_id || ': ' || BTRIM(p_motivo), v_usuario_id
    ) RETURNING id INTO v_mov_id;
  END IF;

  UPDATE public.ventas SET activa = FALSE
  WHERE id = p_venta_id AND club_id = v_club_id;

  RETURN p_venta_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_anular_venta(BIGINT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_anular_venta(BIGINT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_corregir_venta(
  p_venta_id BIGINT,
  p_motivo TEXT,
  p_items JSONB,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL,
  p_jugador_id BIGINT DEFAULT NULL,
  p_pagos JSONB DEFAULT NULL
)
RETURNS public.ventas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_usuario_id UUID := auth.uid();
  v_productos BIGINT[];
  v_cantidades INT[];
  v_producto public.productos;
  v_stock INT;
  v_i INT;
  v_total DECIMAL(12,2) := 0;
  v_precio DECIMAL(12,2);
  v_costo DECIMAL(12,2);
  v_linea public.venta_items.linea%TYPE;
  v_nombre_producto TEXT;
  v_pagos_total DECIMAL(12,2) := 0;
  v_pago JSONB;
  v_medio VARCHAR(30);
  v_cuenta_id BIGINT;
  v_cuenta_header_id BIGINT;
  v_es_caja BOOLEAN;
  v_tiene_efectivo BOOLEAN := FALSE;
  v_turno_caja_id BIGINT;
  v_turno_caja_pago_id BIGINT;
  v_medios_distintos INT;
  v_medio_header VARCHAR(30);
  v_reemplazo public.ventas;
  v_correccion_id BIGINT;
BEGIN
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión de club activa.';
  END IF;
  IF NOT has_user_permission('ventas', 'editar') THEN
    RAISE EXCEPTION 'No tenés permiso para corregir ventas.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta corregida debe tener al menos un producto.';
  END IF;
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' OR jsonb_array_length(p_pagos) = 0 THEN
    RAISE EXCEPTION 'La venta corregida debe tener al menos un pago.';
  END IF;

  PERFORM public.fn_anular_venta(p_venta_id, p_motivo);
  SELECT id INTO v_correccion_id
  FROM public.ventas_correcciones
  WHERE venta_id = p_venta_id AND club_id = public.current_club_id()
  ORDER BY id DESC LIMIT 1;

  SELECT
    array_agg(producto_id ORDER BY producto_id),
    array_agg(cantidad ORDER BY producto_id)
  INTO v_productos, v_cantidades
  FROM (
    SELECT
      (item->>'producto_id')::BIGINT AS producto_id,
      SUM((item->>'cantidad')::INT)::INT AS cantidad
    FROM jsonb_array_elements(p_items) item
    GROUP BY (item->>'producto_id')::BIGINT
  ) items;

  IF v_productos IS NULL THEN
    RAISE EXCEPTION 'La venta corregida debe tener productos válidos.';
  END IF;
  FOR v_i IN 1..array_length(v_productos, 1) LOOP
    IF v_cantidades[v_i] IS NULL OR v_cantidades[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad de cada producto debe ser mayor a cero.';
    END IF;
  END LOOP;

  PERFORM 1
  FROM public.productos
  WHERE id = ANY(v_productos) AND club_id = v_club_id
  ORDER BY id
  FOR UPDATE;

  FOR v_i IN 1..array_length(v_productos, 1) LOOP
    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_productos[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto seleccionado no existe o no pertenece a tu club.';
    END IF;
    IF NOT v_producto.activo AND NOT EXISTS (
      SELECT 1
      FROM public.venta_items vi
      WHERE vi.venta_id = p_venta_id AND vi.producto_id = v_producto.id
    ) THEN
      RAISE EXCEPTION 'No se pueden agregar productos inactivos a la venta corregida.';
    END IF;

    SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
    FROM public.movimientos_stock
    WHERE producto_id = v_producto.id;
    IF v_stock < v_cantidades[v_i] THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": hay % unidades y querés vender %.',
        v_producto.nombre, v_stock, v_cantidades[v_i];
    END IF;

    SELECT vi.producto_nombre, vi.precio_unitario, vi.costo_unitario, vi.linea
    INTO v_nombre_producto, v_precio, v_costo, v_linea
    FROM public.venta_items vi
    WHERE vi.venta_id = p_venta_id AND vi.producto_id = v_producto.id
    ORDER BY vi.id
    LIMIT 1;
    IF NOT FOUND THEN
      v_nombre_producto := v_producto.nombre;
      v_precio := v_producto.precio;
      v_costo := v_producto.costo;
      v_linea := v_producto.linea;
    END IF;
    v_total := v_total + v_precio * v_cantidades[v_i];
  END LOOP;

  SELECT COALESCE(SUM((pago->>'monto')::DECIMAL(12,2)), 0)
  INTO v_pagos_total
  FROM jsonb_array_elements(p_pagos) pago;
  IF ABS(v_pagos_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'La suma de los pagos ($%) no coincide con el total corregido ($%).',
      v_pagos_total, v_total;
  END IF;
  SELECT COUNT(DISTINCT pago->>'medio_pago')
  INTO v_medios_distintos
  FROM jsonb_array_elements(p_pagos) pago;
  IF v_medios_distintos = 1 THEN
    SELECT pago->>'medio_pago' INTO v_medio_header
    FROM jsonb_array_elements(p_pagos) pago
    LIMIT 1;
  ELSE
    v_medio_header := 'mixto';
  END IF;

  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
    v_medio := v_pago->>'medio_pago';
    IF v_medio IS NULL OR v_medio NOT IN
      ('efectivo', 'transferencia', 'mp', 'tarjeta', 'cuenta_corriente', 'otro') THEN
      RAISE EXCEPTION 'El medio de pago de la venta corregida no es válido.';
    END IF;
    IF (v_pago->>'monto')::DECIMAL(12,2) <= 0 THEN
      RAISE EXCEPTION 'Cada pago debe ser mayor a cero.';
    END IF;
    IF v_medio = 'cuenta_corriente'
        AND COALESCE((v_pago->>'jugador_id')::BIGINT, p_jugador_id) IS NULL THEN
      RAISE EXCEPTION 'Elegí un jugador para el pago a cuenta corriente.';
    END IF;

    v_cuenta_id := NULL;
    v_es_caja := FALSE;
    IF NULLIF(v_pago->>'cuenta_id', '') IS NOT NULL THEN
      v_cuenta_id := (v_pago->>'cuenta_id')::BIGINT;
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = v_cuenta_id AND club_id = v_club_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = v_medio;
    END IF;
    v_es_caja := COALESCE(v_es_caja, FALSE);
    IF v_es_caja OR v_medio = 'efectivo' THEN
      v_tiene_efectivo := TRUE;
    END IF;
    IF jsonb_array_length(p_pagos) = 1 THEN
      v_cuenta_header_id := v_cuenta_id;
    END IF;
  END LOOP;

  IF v_tiene_efectivo THEN
    v_turno_caja_id := public.current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION 'No hay caja abierta para registrar el pago en efectivo.';
    END IF;
  END IF;

  INSERT INTO public.ventas (
    club_id, monto_total, medio_pago, observaciones, usuario_id,
    turno_caja_id, cuenta_id, jugador_id
  ) VALUES (
    v_club_id, v_total, v_medio_header, p_observaciones, v_usuario_id,
    v_turno_caja_id, v_cuenta_header_id, p_jugador_id
  )
  RETURNING * INTO v_reemplazo;

  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
    v_medio := v_pago->>'medio_pago';
    v_cuenta_id := NULL;
    v_es_caja := FALSE;
    IF NULLIF(v_pago->>'cuenta_id', '') IS NOT NULL THEN
      v_cuenta_id := (v_pago->>'cuenta_id')::BIGINT;
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = v_cuenta_id AND club_id = v_club_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = v_medio;
    END IF;
    v_turno_caja_pago_id := NULL;
    IF COALESCE(v_es_caja, FALSE) OR v_medio = 'efectivo' THEN
      v_turno_caja_pago_id := v_turno_caja_id;
    END IF;

    INSERT INTO public.venta_pagos (
      club_id, venta_id, monto, medio_pago, cuenta_id, turno_caja_id,
      usuario_id, jugador_id
    ) VALUES (
      v_club_id, v_reemplazo.id, (v_pago->>'monto')::DECIMAL(12,2),
      v_medio, v_cuenta_id, v_turno_caja_pago_id, v_usuario_id,
      COALESCE((v_pago->>'jugador_id')::BIGINT, p_jugador_id)
    );
  END LOOP;

  FOR v_i IN 1..array_length(v_productos, 1) LOOP
    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_productos[v_i] AND club_id = v_club_id;

    SELECT vi.producto_nombre, vi.precio_unitario, vi.costo_unitario, vi.linea
    INTO v_nombre_producto, v_precio, v_costo, v_linea
    FROM public.venta_items vi
    WHERE vi.venta_id = p_venta_id AND vi.producto_id = v_producto.id
    ORDER BY vi.id
    LIMIT 1;
    IF NOT FOUND THEN
      v_nombre_producto := v_producto.nombre;
      v_precio := v_producto.precio;
      v_costo := v_producto.costo;
      v_linea := v_producto.linea;
    END IF;

    INSERT INTO public.venta_items (
      club_id, venta_id, producto_id, producto_nombre, cantidad,
      precio_unitario, costo_unitario, subtotal, linea
    ) VALUES (
      v_club_id, v_reemplazo.id, v_producto.id, v_nombre_producto,
      v_cantidades[v_i], v_precio, v_costo,
      v_precio * v_cantidades[v_i], v_linea
    );

    INSERT INTO public.movimientos_stock (
      club_id, producto_id, cantidad, fuente, venta_id, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, -v_cantidades[v_i], 'venta',
      v_reemplazo.id, v_usuario_id
    );
  END LOOP;

  UPDATE public.ventas_correcciones
  SET venta_reemplazo_id = v_reemplazo.id
  WHERE id = v_correccion_id;
  RETURN v_reemplazo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_corregir_venta(BIGINT, TEXT, JSONB, VARCHAR, TEXT, BIGINT, BIGINT, JSONB)
  TO authenticated;
REVOKE ALL ON FUNCTION public.fn_corregir_venta(BIGINT, TEXT, JSONB, VARCHAR, TEXT, BIGINT, BIGINT, JSONB)
  FROM PUBLIC;
