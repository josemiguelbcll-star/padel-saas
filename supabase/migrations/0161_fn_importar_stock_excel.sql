-- ============================================================================
-- 0161_fn_importar_stock_excel.sql
-- RPC para importación masiva de productos y stock desde Excel
-- Soporta indumentaria con talla y color, líneas buffet/shop y categorías del sistema.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_importar_stock_excel(p_productos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_elem jsonb;
  v_nombre TEXT;
  v_categoria TEXT;
  v_linea TEXT;
  v_precio NUMERIC;
  v_costo NUMERIC;
  v_stock_deseado INT;
  v_talla TEXT;
  v_color TEXT;
  v_producto_id BIGINT;
  v_stock_actual INT;
  v_diferencia INT;
  v_creados INT := 0;
  v_actualizados INT := 0;
  v_stock_ajustado INT := 0;
  v_sin_cambios_stock INT := 0;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT (has_user_permission('mostrador', 'crear') OR current_user_rol() IN ('admin', 'vendedor')) THEN
    RAISE EXCEPTION 'No tenés permisos para importar productos.';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_productos)
  LOOP
    v_nombre := TRIM(COALESCE(v_elem->>'nombre', ''));
    IF v_nombre = '' THEN
      CONTINUE;
    END IF;

    v_categoria := LOWER(TRIM(COALESCE(v_elem->>'categoria', 'otros')));
    v_precio := COALESCE((v_elem->>'precio')::numeric, 0);
    v_costo := (v_elem->>'costo')::numeric;
    v_stock_deseado := COALESCE((v_elem->>'stock')::int, 0);
    v_talla := NULLIF(TRIM(COALESCE(v_elem->>'talla', '')), '');
    v_color := NULLIF(TRIM(COALESCE(v_elem->>'color', '')), '');

    -- Determinar linea según categoría
    IF v_categoria IN ('articulos_padel', 'vestimenta', 'palas', 'accesorios') THEN
      v_linea := 'shop';
    ELSE
      v_linea := 'buffet';
      IF v_categoria NOT IN ('bebidas', 'snacks', 'comidas', 'otros') THEN
        v_categoria := 'otros';
      END IF;
    END IF;

    -- Buscar si ya existe el producto en el club por nombre y talla/color
    SELECT id INTO v_producto_id
    FROM public.productos
    WHERE club_id = v_club_id
      AND LOWER(TRIM(nombre)) = LOWER(v_nombre)
      AND (
        (v_talla IS NULL AND talla IS NULL) OR (LOWER(TRIM(talla)) = LOWER(v_talla))
      )
      AND (
        (v_color IS NULL AND color IS NULL) OR (LOWER(TRIM(color)) = LOWER(v_color))
      )
    LIMIT 1;

    -- Si no coincidió con talla/color y en el input no vinieron talla ni color, buscar por nombre
    IF v_producto_id IS NULL AND v_talla IS NULL AND v_color IS NULL THEN
      SELECT id INTO v_producto_id
      FROM public.productos
      WHERE club_id = v_club_id
        AND LOWER(TRIM(nombre)) = LOWER(v_nombre)
        AND talla IS NULL AND color IS NULL
      LIMIT 1;
    END IF;

    IF v_producto_id IS NOT NULL THEN
      -- Actualizar producto existente
      UPDATE public.productos
      SET
        precio = v_precio,
        costo = COALESCE(v_costo, costo),
        categoria = v_categoria,
        linea = v_linea,
        talla = COALESCE(v_talla, talla),
        color = COALESCE(v_color, color),
        activo = true
      WHERE id = v_producto_id;

      v_actualizados := v_actualizados + 1;
    ELSE
      -- Insertar producto nuevo
      INSERT INTO public.productos (
        club_id,
        nombre,
        linea,
        categoria,
        precio,
        costo,
        stock_minimo,
        activo,
        talla,
        color
      ) VALUES (
        v_club_id,
        v_nombre,
        v_linea,
        v_categoria,
        v_precio,
        v_costo,
        0,
        true,
        v_talla,
        v_color
      ) RETURNING id INTO v_producto_id;

      v_creados := v_creados + 1;
    END IF;

    -- Calcular stock actual a partir de movimientos_stock
    SELECT COALESCE(SUM(cantidad), 0)
    INTO v_stock_actual
    FROM public.movimientos_stock
    WHERE producto_id = v_producto_id;

    v_diferencia := v_stock_deseado - v_stock_actual;

    IF v_diferencia <> 0 THEN
      INSERT INTO public.movimientos_stock (
        club_id,
        producto_id,
        cantidad,
        fuente,
        observaciones,
        usuario_id
      ) VALUES (
        v_club_id,
        v_producto_id,
        v_diferencia,
        'ajuste',
        'Importación de stock desde Excel',
        v_usuario_id
      );

      v_stock_ajustado := v_stock_ajustado + 1;
    ELSE
      v_sin_cambios_stock := v_sin_cambios_stock + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'creados', v_creados,
    'actualizados', v_actualizados,
    'stock_ajustado', v_stock_ajustado,
    'sin_cambios_stock', v_sin_cambios_stock
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_importar_stock_excel(jsonb) TO authenticated;
