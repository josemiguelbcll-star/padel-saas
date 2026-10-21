-- ============================================================================
-- 0141_fix_fn_crear_oc_fecha_y_esquema.sql
--
-- Corrige fn_crear_oc redefinida en 0129: usa columnas heredadas que ya no
-- existen desde 0041 (compras.fecha) y no respeta la coherencia de una OC
-- pedida (monto_neto/monto_total deben quedar NULL hasta la recepción).
-- ============================================================================

BEGIN;

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
  IF NOT has_user_permission('inventario', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para crear órdenes de compra.';
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

COMMIT;
