-- ============================================================================
-- 0010_producto_costo.sql
-- Buffet — agregar costo a productos + snapshot en venta_items + margen
--
-- Primer paso del módulo de rentabilidad / EERR por unidad de negocio
-- (ver "Visión de producto: rentabilidad y EERR por unidad de negocio"
-- en CLAUDE.md). Permite calcular el margen del buffet sobre cada
-- venta: margen = (precio_unitario − costo_unitario) × cantidad.
--
-- Esta migración hace cuatro cosas:
--
--   1. Agrega productos.costo (DECIMAL NULL — ver decisión de NULL abajo).
--   2. Agrega venta_items.costo_unitario (DECIMAL NULL, snapshot al cierre).
--   3. Re-crea la vista vw_productos_con_stock con DROP + CREATE para
--      garantizar que la nueva columna `costo` viaje en el `p.*`.
--   4. CREATE OR REPLACE fn_cerrar_venta: misma signatura, mismo flujo,
--      sólo agrega `costo_unitario = v_producto.costo` al INSERT del item.
--
-- Decisión clave — costo y costo_unitario son NULLABLE (no DEFAULT 0):
-- ─────────────────────────────────────────────────────────────────────
-- Si fueran 0 por default, todos los productos pre-existentes (que
-- nunca tuvieron costo cargado) darían margen = precio (100%), y los
-- reportes de rentabilidad mostrarían un EERR falsamente inflado.
-- Con NULL, el sistema distingue "no cargado" de "cuesta 0 real": los
-- reportes pueden mostrar "—" o "sin costo" en vez de un margen
-- mentiroso. Para un módulo contable, la sinceridad del dato manda.
-- El CHECK (costo >= 0) permite NULL implícitamente (en SQL, CHECK
-- pasa cuando la expresión es TRUE o NULL; sólo falla cuando es FALSE).
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). No toca el
-- trigger anti-borrar productos, ni las RLS, ni los CHECKs estructurales
-- de movimientos_stock. fn_registrar_movimiento_stock no se toca (la
-- carga manual de inventario no toma costo en Capa 1; eso será del
-- módulo de compras futuro, junto con el bot de WhatsApp).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. productos.costo
--    NULLABLE para distinguir "no cargado" de "cuesta cero real". El
--    CHECK >= 0 permite NULL (CHECK falla sólo en FALSE, no en NULL).
-- ============================================================================
ALTER TABLE productos
  ADD COLUMN costo DECIMAL(12,2) CHECK (costo >= 0);

COMMENT ON COLUMN productos.costo IS
  'Último costo conocido del producto (lo que le cuesta al club comprarlo).
   NULL = no cargado (la UI/reportes deben mostrar "—" o "sin costo", NO
   asumir 0). Cuando se vende, fn_cerrar_venta snapshotea este valor en
   venta_items.costo_unitario para que el margen histórico no cambie al
   actualizar costos futuros.';


-- ============================================================================
-- 2. venta_items.costo_unitario
--    NULLABLE por la misma razón: una venta hecha cuando el producto no
--    tenía costo cargado deja la línea con costo_unitario=NULL ("margen
--    no calculable"), no con un 0 que mentiría diciendo "margen=100%".
-- ============================================================================
ALTER TABLE venta_items
  ADD COLUMN costo_unitario DECIMAL(12,2) CHECK (costo_unitario >= 0);

COMMENT ON COLUMN venta_items.costo_unitario IS
  'Snapshot del costo del producto al momento de la venta. NULL = el
   producto no tenía costo cargado en ese momento; el margen de esta
   línea es "no calculable" (los reportes deben excluirla del cálculo
   de margen o mostrarla aparte). Para líneas con valor, margen de la
   línea = (precio_unitario - costo_unitario) * cantidad.';


-- ============================================================================
-- 3. Re-crear vw_productos_con_stock
--    `SELECT p.*` en una vista a veces "fija" las columnas al momento de
--    CREATE. DROP + CREATE garantiza que la columna `costo` se incluya
--    en el SELECT, sin depender de la versión de Postgres.
-- ============================================================================
DROP VIEW vw_productos_con_stock;

CREATE VIEW vw_productos_con_stock
WITH (security_invoker = true)
AS
SELECT
  p.*,
  COALESCE(SUM(m.cantidad), 0)::INT AS stock_actual
FROM productos p
LEFT JOIN movimientos_stock m ON m.producto_id = p.id
GROUP BY p.id;

GRANT SELECT ON vw_productos_con_stock TO authenticated;

COMMENT ON VIEW vw_productos_con_stock IS
  'Productos + stock_actual (suma de movimientos). Re-creada en la 0010
   para que `p.*` incluya la nueva columna `costo`. security_invoker=true
   asegura que las RLS de productos y movimientos_stock aplican al
   usuario consultante.';


-- ============================================================================
-- 4. CREATE OR REPLACE fn_cerrar_venta
--    Misma signatura → la GRANT EXECUTE existente persiste sin tocar.
--    Único cambio vs la versión 0009: el INSERT en venta_items ahora
--    incluye `costo_unitario = v_producto.costo` (snapshot al cierre).
--    Si v_producto.costo es NULL, la línea queda con costo_unitario=NULL.
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

  -- Header de la venta.
  INSERT INTO ventas (club_id, monto_total, medio_pago, observaciones, usuario_id)
  VALUES (v_club_id, v_total, p_medio_pago, p_observaciones, v_usuario_id)
  RETURNING * INTO v_venta;

  -- Items + movimientos. ÚNICA DIFERENCIA vs 0009: snapshot del costo
  -- en costo_unitario. Si el producto no tenía costo cargado, queda NULL
  -- (margen no calculable para esa línea — los reportes lo manejan).
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    INSERT INTO venta_items (
      club_id, venta_id, producto_id, producto_nombre,
      cantidad, precio_unitario, costo_unitario, subtotal
    ) VALUES (
      v_club_id, v_venta.id, v_producto.id, v_producto.nombre,
      v_cants[v_i], v_producto.precio, v_producto.costo,
      v_producto.precio * v_cants[v_i]
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

COMMENT ON FUNCTION fn_cerrar_venta IS
  'Cierre atómico de venta del buffet. INSERT en ventas + venta_items
   (con snapshot de precio_unitario y costo_unitario) + movimientos_stock
   (salida fuente=''venta'') en una sola transacción. SELECT FOR UPDATE
   por producto en orden ASC para evitar oversold concurrente y deadlocks.
   Si producto.costo es NULL, la línea queda con costo_unitario=NULL
   (margen "no calculable").';


COMMIT;

-- ============================================================================
-- Fin de la migración 0010_producto_costo.sql
-- ============================================================================
