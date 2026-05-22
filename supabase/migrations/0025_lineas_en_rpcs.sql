-- ============================================================================
-- 0025_lineas_en_rpcs.sql
-- Líneas Buffet/Shop — Bloque 2 (integración con las RPCs de venta y
-- carga de consumos del turno).
--
-- =====================================================================
-- QUÉ HACE ESTA MIGRACIÓN
-- =====================================================================
-- Dos cambios quirúrgicos (mismo patrón que la 0023 con turno_caja_id):
--
-- 1) fn_cerrar_venta:
--    - El INSERT a venta_items agrega la columna `linea`, copiando
--      `v_producto.linea` (snapshot al momento de la venta).
--    - Sin restricción de línea: el POS acepta mezclar buffet y shop
--      en un mismo carrito y cobrarlo en una venta.
--
-- 2) fn_cargar_consumo_turno:
--    - Bloque NUEVO que rechaza productos de shop con mensaje
--      accionable: "Los artículos de shop no se cargan a la cuenta
--      del turno; vendelos en el mostrador." Restricción server-side
--      (el frontend también filtra — doble defensa).
--    - El INSERT a reserva_consumos agrega la columna `linea`,
--      copiando `v_producto.linea`. En la práctica siempre vale
--      'buffet' (el check de arriba bloquea shop), pero se persiste
--      por consistencia con el patrón snapshot.
--
-- =====================================================================
-- QUÉ NO CAMBIA
-- =====================================================================
-- - SIGNATURAS de las 2 funciones (parámetros + tipo de retorno).
--   El frontend NO se entera.
-- - Lógica original: locks, validaciones, cálculos, INSERTs adicionales
--   (venta_items, movimientos_stock, header de venta), UPDATEs. Solo
--   se agrega la columna `linea` al INSERT principal de cada una
--   (más, en fn_cargar_consumo_turno, el bloque de rechazo shop).
-- - El INSERT a `ventas` (header) de fn_cerrar_venta NO se toca: la
--   línea es del item, no de la venta. Una venta puede mezclar líneas
--   en sus items.
-- ============================================================================

BEGIN;

-- ============================================================================
-- RPC 1/2: fn_cerrar_venta (versión vigente en 0023)
--
-- Cambios respecto de 0023:
--   ⭐ INSERT en venta_items agrega columna `linea` con v_producto.linea.
--
-- Resto IDÉNTICO al de 0023 (validaciones del medio, atado a caja,
-- consolidación de ítems, lock de productos, validación de stock,
-- header de venta, items con snapshot de costo, movimientos_stock).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cerrar_venta(
  p_items JSONB,
  p_medio_pago VARCHAR,
  p_observaciones TEXT
)
RETURNS ventas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_venta ventas;
  v_producto productos;
  v_stock INT;
  v_total DECIMAL(12,2) := 0;
  v_pids BIGINT[];
  v_cants INT[];
  v_i INT;
  v_turno_caja_id BIGINT := NULL;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta tiene que tener al menos un producto.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  IF p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ATADO A CAJA (regla de oro del efectivo — 0023). Sin cambios.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  -- Consolidar ítems duplicados por producto_id (ver comentario en 0009).
  SELECT
    array_agg(producto_id ORDER BY producto_id),
    array_agg(cantidad ORDER BY producto_id)
  INTO v_pids, v_cants
  FROM (
    SELECT
      (x->>'producto_id')::BIGINT AS producto_id,
      SUM((x->>'cantidad')::INT)::INT AS cantidad
    FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT
  ) c;

  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    IF v_cants[v_i] IS NULL OR v_cants[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
    END IF;
  END LOOP;

  -- Lock exclusivo de los productos involucrados, en orden ASC de id
  -- (ver justificación de deadlock-avoidance en el comentario de 0009).
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- Validar cada producto + acumular total.
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto seleccionado no existe o no pertenece a tu club.';
    END IF;

    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede vender.', v_producto.nombre;
    END IF;

    SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
    FROM movimientos_stock
    WHERE producto_id = v_producto.id;

    IF v_stock < v_cants[v_i] THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": hay % unidades, querés vender %.',
        v_producto.nombre, v_stock, v_cants[v_i];
    END IF;

    v_total := v_total + (v_producto.precio * v_cants[v_i]);
  END LOOP;

  -- Header de la venta (sin cambios respecto de 0023).
  INSERT INTO ventas (
    club_id, monto_total, medio_pago, observaciones, usuario_id,
    turno_caja_id
  )
  VALUES (
    v_club_id, v_total, p_medio_pago, p_observaciones, v_usuario_id,
    v_turno_caja_id
  )
  RETURNING * INTO v_venta;

  -- Items + movimientos.
  -- ⭐ NUEVO 0025: el INSERT en venta_items agrega la columna `linea`
  --    con v_producto.linea (snapshot al momento de la venta).
  --    venta_items y movimientos_stock no tienen medio_pago ni
  --    turno_caja_id (no aplican). movimientos_stock IDÉNTICO al de 0023.
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    INSERT INTO venta_items (
      club_id, venta_id, producto_id, producto_nombre,
      cantidad, precio_unitario, costo_unitario, subtotal,
      linea                                                    -- ⭐ NUEVO 0025
    ) VALUES (
      v_club_id, v_venta.id, v_producto.id, v_producto.nombre,
      v_cants[v_i], v_producto.precio, v_producto.costo,
      v_producto.precio * v_cants[v_i],
      v_producto.linea                                         -- ⭐ NUEVO 0025
    );

    INSERT INTO movimientos_stock (
      club_id, producto_id, cantidad, fuente, venta_id, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, -v_cants[v_i], 'venta', v_venta.id, v_usuario_id
    );
  END LOOP;

  RETURN v_venta;
END;
$$;


-- ============================================================================
-- RPC 2/2: fn_cargar_consumo_turno (versión vigente en 0015)
--
-- Cambios respecto de 0015:
--   ⭐ Bloque NUEVO: rechaza productos de linea='shop' con mensaje
--      accionable. Ubicado después de validar que el producto existe
--      y está activo, antes del cálculo de stock (falla rápido sin
--      gastar la query de stock).
--   ⭐ INSERT en reserva_consumos agrega columna `linea` con
--      v_producto.linea (en la práctica siempre 'buffet' por el
--      check de arriba, pero se persiste por consistencia snapshot).
--
-- Resto IDÉNTICO al de 0015 (validaciones de sesión / cantidad /
-- tipo_reparto / reserva, lock del producto, validación de activo,
-- cálculo de stock, INSERT en movimientos_stock).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT,
  p_tipo_reparto VARCHAR
)
RETURNS reserva_consumos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva reservas;
  v_producto productos;
  v_stock INT;
  v_consumo reserva_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.';
  END IF;

  IF p_tipo_reparto IS NULL
     OR p_tipo_reparto NOT IN ('partido', 'general') THEN
    RAISE EXCEPTION 'Tipo de reparto inválido (esperado: partido o general).';
  END IF;

  -- Verificar reserva: existe, del club, no cancelada.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION
      'No se pueden cargar consumos a una reserva cancelada.';
  END IF;

  -- Lock exclusivo del producto: serializa con ventas y otras cargas
  -- concurrentes que toquen el stock del mismo producto.
  SELECT * INTO v_producto
  FROM productos
  WHERE id = p_producto_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_producto.activo THEN
    RAISE EXCEPTION
      'El producto "%" está desactivado, no se puede vender.',
      v_producto.nombre;
  END IF;

  -- ⭐ NUEVO 0025 — RESTRICCIÓN DE LÍNEA SHOP.
  -- Los artículos de shop no se "consumen jugando" — se venden en el
  -- mostrador (fn_cerrar_venta). Falla rápido antes del cálculo de
  -- stock. Doble defensa: el frontend (ConsumosCatalogo) también
  -- filtra a línea=buffet, pero esto cierra la puerta server-side.
  IF v_producto.linea = 'shop' THEN
    RAISE EXCEPTION
      'Los artículos de shop no se cargan a la cuenta del turno; vendelos en el mostrador.';
  END IF;
  -- ⭐ FIN BLOQUE NUEVO

  -- Calcular stock bajo el lock.
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION
      'Stock insuficiente de "%": hay % unidades, querés cargar %.',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- ⭐ NUEVO 0025: INSERT incluye la columna `linea` con v_producto.linea.
  -- Siempre 'buffet' en la práctica por el check de arriba; se persiste
  -- por consistencia con el patrón snapshot. Resto IDÉNTICO al de 0015.
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto,
    linea                                                      -- ⭐ NUEVO 0025
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    p_tipo_reparto,
    v_producto.linea                                           -- ⭐ NUEVO 0025
  )
  RETURNING * INTO v_consumo;

  -- INSERT movimiento de salida atado al consumo nuevo (sin cambios).
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


COMMIT;

-- ============================================================================
-- Fin de la migración 0025_lineas_en_rpcs.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Las 2 funciones siguen con la misma signatura ----------
-- SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS ret
-- FROM pg_proc
-- WHERE proname IN ('fn_cerrar_venta','fn_cargar_consumo_turno');
-- -- args y ret deberían ser IDÉNTICOS a antes de la 0025.

-- ---------- B. Cargar producto de SHOP al turno → debe RECHAZAR ----------
-- En consola del browser (logueado como admin/vendedor del club):
--   await window.supabase.rpc('fn_cargar_consumo_turno', {
--     p_reserva_id: <ID de una reserva activa>,
--     p_producto_id: <ID de Pelotas Bull Padel — el de linea=shop>,
--     p_cantidad: 1,
--     p_tipo_reparto: 'partido'
--   });
-- → error: 'Los artículos de shop no se cargan a la cuenta del turno; vendelos en el mostrador.'

-- ---------- C. Cargar producto de BUFFET al turno → debe FUNCIONAR ----------
-- Mismo escenario con un producto de buffet (cualquier bebida, snack, etc).
-- → OK. Verificar que la fila en reserva_consumos tiene linea='buffet':
--   SELECT id, producto_nombre, linea FROM reserva_consumos ORDER BY id DESC LIMIT 1;

-- ---------- D. Venta MIXTA (buffet + shop) → debe FUNCIONAR ----------
-- Una venta con un producto de buffet Y uno de shop en el mismo carrito:
--   await window.supabase.rpc('fn_cerrar_venta', {
--     p_items: [
--       { producto_id: <id de buffet>, cantidad: 1 },
--       { producto_id: <id de shop>, cantidad: 1 }
--     ],
--     p_medio_pago: 'transferencia',
--     p_observaciones: 'TEST mixta'
--   });
-- → OK. Verificar que venta_items tiene 2 filas con linea distinta:
--   SELECT vi.producto_nombre, vi.linea
--   FROM venta_items vi
--   WHERE vi.venta_id = <id de la venta>
--   ORDER BY vi.id;
-- -- 2 filas: una con linea='buffet', otra con linea='shop'.
-- ============================================================================
