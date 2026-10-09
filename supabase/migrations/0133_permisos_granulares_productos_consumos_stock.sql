-- ============================================================================
-- Migration 0133_permisos_granulares_productos_consumos_stock.sql
--
-- 1. Permite a usuarios autorizados (admin o vendedor con permiso de 'configuracion' o 'inventario')
--    crear, modificar y eliminar productos en la tabla `productos`.
--
-- 2. Define como SECURITY DEFINER las RPCs operativas de stock y consumos:
--    - fn_cargar_consumo_turno: para que el vendedor pueda cargar bebidas/pelotas en un turno sin ser bloqueado por RLS de FOR UPDATE.
--    - fn_quitar_consumo_turno: para reponer y quitar consumos de un turno.
--    - fn_cargar_consumo_clase y fn_quitar_consumo_clase.
--    - fn_ajustar_stock y fn_registrar_movimiento_stock: para ajustar y cargar stock con validación granular de permisos.
--
-- 3. Actualiza políticas RLS de canchas, profesores y proveedores para permitir a vendedores con permiso de edición.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. RLS en tabla productos: permitir admin y usuarios con permiso de configuración o inventario
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "productos_insert_solo_admin" ON productos;
DROP POLICY IF EXISTS "productos_update_solo_admin" ON productos;
DROP POLICY IF EXISTS "productos_delete_solo_admin" ON productos;
DROP POLICY IF EXISTS "productos_insert_con_permiso" ON productos;
DROP POLICY IF EXISTS "productos_update_con_permiso" ON productos;
DROP POLICY IF EXISTS "productos_delete_con_permiso" ON productos;

CREATE POLICY "productos_insert_con_permiso"
ON productos FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
);

CREATE POLICY "productos_update_con_permiso"
ON productos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
);

CREATE POLICY "productos_delete_con_permiso"
ON productos FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON productos TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. fn_cargar_consumo_turno como SECURITY DEFINER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR DEFAULT 'general',
  p_reserva_jugador_id BIGINT DEFAULT NULL
)
RETURNS reserva_consumos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva reservas;
  v_producto productos;
  v_consumo reserva_consumos;
  v_jugador_id BIGINT := NULL;
  v_tipo_reparto_final VARCHAR;
  v_stock INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') AND NOT has_user_permission('mostrador', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para cargar consumos al turno.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'No se pueden cargar consumos a un turno cerrado.';
  END IF;

  -- Lock exclusivo del producto
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o está inactivo.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
  END IF;

  -- Debounce anti-doble-submit (2 segundos)
  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE club_id      = v_club_id
    AND reserva_id   = p_reserva_id
    AND producto_id  = v_producto.id
    AND cantidad     = p_cantidad
    AND tipo_reparto = COALESCE(p_tipo_reparto, 'general')
    AND (
      (p_reserva_jugador_id IS NULL AND reserva_jugador_id IS NULL)
      OR reserva_jugador_id = p_reserva_jugador_id
    )
    AND usuario_id   = v_usuario_id
    AND fecha_hora  >= NOW() - INTERVAL '2 seconds'
  ORDER BY fecha_hora DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_consumo;
  END IF;

  -- Calcular stock bajo el lock desde movimientos_stock
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- Asignación a persona puntual
  IF p_reserva_jugador_id IS NOT NULL THEN
    SELECT jugador_id INTO v_jugador_id
    FROM reserva_jugadores
    WHERE id = p_reserva_jugador_id AND reserva_id = p_reserva_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La persona indicada no pertenece a este turno.';
    END IF;
    v_tipo_reparto_final := 'individual';
  ELSE
    v_tipo_reparto_final := COALESCE(p_tipo_reparto, 'general');
    IF v_tipo_reparto_final NOT IN ('general', 'partido') THEN
      v_tipo_reparto_final := 'general';
    END IF;
  END IF;

  -- Insertar consumo
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto, linea,
    reserva_jugador_id, jugador_id
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    v_tipo_reparto_final, v_producto.linea,
    p_reserva_jugador_id, v_jugador_id
  )
  RETURNING * INTO v_consumo;

  -- Movimiento de stock (fuente: consumo_turno)
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_turno',
    NULL, v_consumo.id, v_usuario_id
  );

  RETURN v_consumo;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_cargar_consumo_turno(BIGINT, BIGINT, INT, VARCHAR, BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. fn_quitar_consumo_turno como SECURITY DEFINER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_quitar_consumo_turno(
  p_consumo_id BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_consumo reserva_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') AND NOT has_user_permission('mostrador', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para quitar consumos del turno.';
  END IF;

  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe o no pertenece a tu club.';
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo',
    NULL, NULL,
    format('Reposición por quitado del consumo #%s del turno #%s',
           v_consumo.id, v_consumo.reserva_id),
    v_usuario_id
  );

  DELETE FROM reserva_consumos WHERE id = p_consumo_id;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_quitar_consumo_turno(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. fn_cargar_consumo_clase y fn_quitar_consumo_clase como SECURITY DEFINER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cargar_consumo_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_clase_alumno_id BIGINT DEFAULT NULL
)
RETURNS clase_consumos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_consumo clase_consumos;
  v_stock INT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') AND NOT has_user_permission('mostrador', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para cargar consumos a la clase.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clases WHERE id = p_clase_id AND club_id = v_club_id) THEN
    RAISE EXCEPTION 'La clase no existe.';
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o está inactivo.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, solicitado: %).',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  INSERT INTO clase_consumos (
    club_id, clase_id, fecha, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, linea, usuario_id,
    clase_alumno_id
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_producto.linea, v_usuario_id,
    p_clase_alumno_id
  )
  RETURNING * INTO v_consumo;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    clase_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_producto.id, -p_cantidad, 'consumo_clase',
    v_consumo.id, format('Consumo en clase #%s fecha %s', p_clase_id, p_fecha), v_usuario_id
  );

  RETURN v_consumo;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_cargar_consumo_clase(BIGINT, DATE, BIGINT, INT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION fn_quitar_consumo_clase(
  p_consumo_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_consumo clase_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('reservas', 'editar') AND NOT has_user_permission('mostrador', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para quitar consumos de la clase.';
  END IF;

  SELECT * INTO v_consumo
  FROM clase_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe.';
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    clase_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo_clase',
    v_consumo.id, format('Reposición por eliminación de consumo de clase #%s', v_consumo.id),
    v_usuario_id
  );

  DELETE FROM clase_consumos WHERE id = p_consumo_id;

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_quitar_consumo_clase(BIGINT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. fn_ajustar_stock como SECURITY DEFINER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ajustar_stock(
  p_producto_id BIGINT,
  p_cantidad INT,
  p_razon TEXT
)
RETURNS movimientos_stock
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_stock_actual INT;
  v_stock_resultante INT;
  v_mov movimientos_stock;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('inventario', 'editar') AND NOT has_user_permission('configuracion', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para ajustar el stock de inventario.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad = 0 THEN
    RAISE EXCEPTION 'La cantidad del ajuste no puede ser 0.';
  END IF;
  IF p_razon IS NULL OR LENGTH(TRIM(p_razon)) = 0 THEN
    RAISE EXCEPTION 'La razón del ajuste es obligatoria.';
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock_actual
  FROM movimientos_stock
  WHERE producto_id = p_producto_id;

  v_stock_resultante := v_stock_actual + p_cantidad;
  IF v_stock_resultante < 0 THEN
    RAISE EXCEPTION
      'El ajuste dejaría el stock en negativo (actual: %, ajuste: %, resultante: %). Corregí la cantidad.',
      v_stock_actual, p_cantidad, v_stock_resultante;
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, compra_id, reserva_consumo_id,
    observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, p_cantidad, 'ajuste',
    NULL, NULL, NULL,
    TRIM(p_razon), v_usuario_id
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_ajustar_stock(BIGINT, INT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. fn_registrar_movimiento_stock (Cargar stock) como SECURITY DEFINER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_registrar_movimiento_stock(
  p_producto_id BIGINT,
  p_cantidad INT,
  p_observaciones TEXT
)
RETURNS movimientos_stock
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_producto productos;
  v_mov movimientos_stock;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF NOT has_user_permission('configuracion', 'editar') AND NOT has_user_permission('inventario', 'editar') THEN
    RAISE EXCEPTION 'No tenés permisos para cargar stock.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a cargar debe ser mayor a 0.';
  END IF;

  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente, venta_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, p_producto_id, p_cantidad, 'compra_manual', NULL, p_observaciones, v_usuario_id
  )
  RETURNING * INTO v_mov;

  RETURN v_mov;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_registrar_movimiento_stock(BIGINT, INT, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS en canchas, profesores y proveedores
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "canchas_insert_solo_admin" ON canchas;
DROP POLICY IF EXISTS "canchas_update_solo_admin" ON canchas;
DROP POLICY IF EXISTS "canchas_delete_solo_admin" ON canchas;
DROP POLICY IF EXISTS "canchas_insert_con_permiso" ON canchas;
DROP POLICY IF EXISTS "canchas_update_con_permiso" ON canchas;
DROP POLICY IF EXISTS "canchas_delete_con_permiso" ON canchas;

CREATE POLICY "canchas_insert_con_permiso"
ON canchas FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

CREATE POLICY "canchas_update_con_permiso"
ON canchas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
)
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

CREATE POLICY "canchas_delete_con_permiso"
ON canchas FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

DROP POLICY IF EXISTS "profesores_insert_solo_admin" ON profesores;
DROP POLICY IF EXISTS "profesores_update_solo_admin" ON profesores;
DROP POLICY IF EXISTS "profesores_delete_solo_admin" ON profesores;
DROP POLICY IF EXISTS "profesores_insert_con_permiso" ON profesores;
DROP POLICY IF EXISTS "profesores_update_con_permiso" ON profesores;
DROP POLICY IF EXISTS "profesores_delete_con_permiso" ON profesores;

CREATE POLICY "profesores_insert_con_permiso"
ON profesores FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

CREATE POLICY "profesores_update_con_permiso"
ON profesores FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
)
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

CREATE POLICY "profesores_delete_con_permiso"
ON profesores FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

DROP POLICY IF EXISTS "proveedores_insert_solo_admin" ON proveedores;
DROP POLICY IF EXISTS "proveedores_update_solo_admin" ON proveedores;
DROP POLICY IF EXISTS "proveedores_delete_solo_admin" ON proveedores;
DROP POLICY IF EXISTS "proveedores_insert_con_permiso" ON proveedores;
DROP POLICY IF EXISTS "proveedores_update_con_permiso" ON proveedores;
DROP POLICY IF EXISTS "proveedores_delete_con_permiso" ON proveedores;

CREATE POLICY "proveedores_insert_con_permiso"
ON proveedores FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
);

CREATE POLICY "proveedores_update_con_permiso"
ON proveedores FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
);

CREATE POLICY "proveedores_delete_con_permiso"
ON proveedores FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('inventario', 'editar')
  )
);

-- ----------------------------------------------------------------------------
-- 8. RLS en tarifas y tarifas_clases
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tarifas_insert_solo_admin" ON tarifas;
DROP POLICY IF EXISTS "tarifas_update_solo_admin" ON tarifas;
DROP POLICY IF EXISTS "tarifas_delete_solo_admin" ON tarifas;
DROP POLICY IF EXISTS "tarifas_insert_con_permiso" ON tarifas;
DROP POLICY IF EXISTS "tarifas_update_con_permiso" ON tarifas;
DROP POLICY IF EXISTS "tarifas_delete_con_permiso" ON tarifas;

CREATE POLICY "tarifas_insert_con_permiso"
ON tarifas FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

CREATE POLICY "tarifas_update_con_permiso"
ON tarifas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
)
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

CREATE POLICY "tarifas_delete_con_permiso"
ON tarifas FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

DROP POLICY IF EXISTS "tarifas_clases_insert_solo_admin" ON tarifas_clases;
DROP POLICY IF EXISTS "tarifas_clases_update_solo_admin" ON tarifas_clases;
DROP POLICY IF EXISTS "tarifas_clases_insert_con_permiso" ON tarifas_clases;
DROP POLICY IF EXISTS "tarifas_clases_update_con_permiso" ON tarifas_clases;

CREATE POLICY "tarifas_clases_insert_con_permiso"
ON tarifas_clases FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

CREATE POLICY "tarifas_clases_update_con_permiso"
ON tarifas_clases FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
)
WITH CHECK (
  club_id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

-- ----------------------------------------------------------------------------
-- 9. RLS y GRANT en clubes (horarios, marca y perfil público)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "clubes_update_solo_admin_horarios" ON clubes;
DROP POLICY IF EXISTS "clubes_update_con_permiso" ON clubes;

CREATE POLICY "clubes_update_con_permiso"
ON clubes FOR UPDATE TO authenticated
USING (
  id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
)
WITH CHECK (
  id = current_club_id()
  AND (current_user_rol() = 'admin' OR has_user_permission('configuracion', 'editar'))
);

GRANT UPDATE (
  hora_apertura,
  hora_cierre,
  duracion_turno_default,
  nombre,
  color_primario_hsl,
  logo_path,
  descripcion,
  lat,
  lng,
  instagram,
  website,
  perfil_publico_activo,
  condicion_fiscal
) ON clubes TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. RLS en categorias_gasto
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "categorias_gasto_insert_admin" ON categorias_gasto;
DROP POLICY IF EXISTS "categorias_gasto_update_admin" ON categorias_gasto;
DROP POLICY IF EXISTS "categorias_gasto_insert_con_permiso" ON categorias_gasto;
DROP POLICY IF EXISTS "categorias_gasto_update_con_permiso" ON categorias_gasto;

CREATE POLICY "categorias_gasto_insert_con_permiso"
ON categorias_gasto FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('finanzas', 'editar')
  )
);

CREATE POLICY "categorias_gasto_update_con_permiso"
ON categorias_gasto FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('finanzas', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() = 'admin'
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('finanzas', 'editar')
  )
);

-- ----------------------------------------------------------------------------
-- 11. RLS en clases
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "clases_insert_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_update_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_delete_solo_admin" ON clases;
DROP POLICY IF EXISTS "clases_insert_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_update_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_delete_admin_vendedor" ON clases;
DROP POLICY IF EXISTS "clases_insert_con_permiso" ON clases;
DROP POLICY IF EXISTS "clases_update_con_permiso" ON clases;
DROP POLICY IF EXISTS "clases_delete_con_permiso" ON clases;

CREATE POLICY "clases_insert_con_permiso"
ON clases FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
);

CREATE POLICY "clases_update_con_permiso"
ON clases FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
)
WITH CHECK (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
);

CREATE POLICY "clases_delete_con_permiso"
ON clases FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND (
    current_user_rol() IN ('admin', 'vendedor')
    OR has_user_permission('configuracion', 'editar')
    OR has_user_permission('reservas', 'editar')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON clases TO authenticated;

COMMIT;
