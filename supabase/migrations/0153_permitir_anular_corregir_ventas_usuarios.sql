-- Permite a todos los usuarios autenticados del club anular y corregir ventas
-- Remueve la restricción exclusiva a 'admin' para que vendedores y cajeros del club
-- puedan gestionar el historial de ventas, anularlas y corregirlas.

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

