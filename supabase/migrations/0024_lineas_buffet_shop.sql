-- ============================================================================
-- 0024_lineas_buffet_shop.sql
-- Productos: separación en dos líneas (Buffet / Shop) — modelo + datos.
--
-- =====================================================================
-- CONTEXTO
-- =====================================================================
-- Hoy `productos.categoria` es un enum singular (bebida/snack/otro)
-- pensado solo para buffet. Pasamos a un modelo de DOS LÍNEAS:
--
--   - linea = 'buffet' (comida y bebida que se "consume jugando")
--     · categorias: bebidas, snacks, comidas, otros
--   - linea = 'shop'   (artículos de pádel, vestimenta, etc.)
--     · categorias: articulos_padel, vestimenta, palas, accesorios
--
-- El POS sigue siendo UNO solo (carrito mezcla líneas). La cuenta del
-- turno solo acepta línea='buffet' (un grip no se "consume jugando";
-- se vende en el mostrador). La restricción server-side va en la 0025
-- (fn_cargar_consumo_turno).
--
-- Cada ítem de venta/consumo guarda la línea como SNAPSHOT — mismo
-- patrón que producto_nombre/precio_unitario: si en el futuro el admin
-- reclasifica un producto, el histórico de ventas NO cambia.
--
-- =====================================================================
-- DATOS EXISTENTES
-- =====================================================================
-- Migración de los productos existentes:
--   - Todos quedan en `linea = 'buffet'` por DEFAULT (retroactividad).
--   - Categorías singulares → plurales: bebida→bebidas, snack→snacks,
--     otro→otros.
--   - Reclasificación puntual del único producto de shop hoy: "Pelotas
--     Bull Padel 2 Un." pasa a linea='shop' + categoria='articulos_padel'
--     (con RAISE NOTICE del conteo de filas afectadas — si afecta 0 o
--     más de 1, se ve en logs).
--
-- venta_items y reserva_consumos existentes quedan con `linea='buffet'`
-- en su nuevo snapshot — antes del cambio no existía shop, así que
-- todo lo histórico es correctamente buffet.
--
-- =====================================================================
-- ORDEN DE OPERACIONES (crítico)
-- =====================================================================
--   1. ADD COLUMN productos.linea (default 'buffet').
--   2. DROP CHECK viejo de productos.categoria (con detección dinámica
--      del nombre — no asumimos productos_categoria_check). Sin este
--      paso, los UPDATEs siguientes fallan porque cambian categoria a
--      valores que no están en el enum viejo.
--   3. UPDATE singulares → plurales (en linea='buffet').
--   4. UPDATE Bull Padel → linea='shop', categoria='articulos_padel'.
--   5. ADD CHECK nuevo compuesto (categoria-según-linea).
--   6. ALTER venta_items + reserva_consumos con columna linea.
--   7. DROP + CREATE VIEW vw_productos_con_stock (porque p.* se
--      expande al crear la vista, no se actualiza solo).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ADD COLUMN productos.linea (default 'buffet')
-- ============================================================================
--    Todos los productos existentes quedan en buffet automáticamente.
--    El CHECK enum lo agregamos inline acá (línea aislada, fácil de
--    auditar). El CHECK COMPUESTO categoría-según-línea va en el paso 5.
-- ============================================================================
ALTER TABLE productos
  ADD COLUMN linea VARCHAR(20) NOT NULL DEFAULT 'buffet'
  CHECK (linea IN ('buffet','shop'));

COMMENT ON COLUMN productos.linea IS
  'Unidad de negocio: buffet (comida/bebida consumibles en partido) o
   shop (artículos de pádel, vestimenta, etc.). Determina dónde se
   muestra el producto en la UI y qué categorías son válidas. Solo
   linea=buffet puede cargarse a la cuenta del turno
   (restricción server-side en fn_cargar_consumo_turno).';


-- ============================================================================
-- 2. DROP CHECK viejo de productos.categoria
-- ============================================================================
--    Detección dinámica del nombre del constraint (no asumir
--    productos_categoria_check aunque Postgres normalmente nombre así
--    los CHECK inline). Si no lo encuentra, RAISE — la migración falla
--    de forma controlada y el COMMIT se rollbackea entero.
-- ============================================================================
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'productos'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%categoria%bebida%snack%otro%';

  IF v_constraint_name IS NULL THEN
    RAISE EXCEPTION
      'No se encontró el CHECK viejo de categoria (IN bebida/snack/otro) en productos. Verificá con: SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = ''productos''::regclass AND contype = ''c'';';
  END IF;

  EXECUTE format('ALTER TABLE productos DROP CONSTRAINT %I', v_constraint_name);
  RAISE NOTICE 'CHECK viejo dropeado: %', v_constraint_name;
END $$;


-- ============================================================================
-- 3. UPDATE categorías viejas (singulares) a nuevas (plurales)
-- ============================================================================
--    Mapeo 1:1. Después de DROP del CHECK viejo, los UPDATEs no
--    fallan; antes del ADD del CHECK nuevo, los valores intermedios
--    (plurales que no están en ningún enum activo) no se validan
--    contra nada — aceptable porque toda la migración corre en una
--    sola transacción.
-- ============================================================================
UPDATE productos SET categoria = 'bebidas' WHERE categoria = 'bebida';
UPDATE productos SET categoria = 'snacks'  WHERE categoria = 'snack';
UPDATE productos SET categoria = 'otros'   WHERE categoria = 'otro';


-- ============================================================================
-- 4. Reclasificar "Pelotas Bull Padel 2 Un." a shop + articulos_padel
-- ============================================================================
--    LIKE case-insensitive con prefix 'pelotas bull padel'. RAISE
--    NOTICE con el conteo: si afecta 0 (alguien lo renombró) o más de
--    1 (caso raro), se ve en los logs y el admin sabe que tiene que
--    revisar manualmente desde Studio.
-- ============================================================================
DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE productos
  SET linea = 'shop', categoria = 'articulos_padel'
  WHERE LOWER(nombre) LIKE 'pelotas bull padel%';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Reclasificación Bull Padel a (shop, articulos_padel): % fila(s) afectada(s) (esperado: 1)', v_count;
END $$;


-- ============================================================================
-- 5. ADD CHECK nuevo compuesto categoria-según-línea
-- ============================================================================
--    Enumera explícitamente las combinaciones válidas. Si en el
--    futuro se agrega una línea o categoría, este CHECK se reescribe.
--    Si en algún momento las categorías se vuelven editables desde
--    UI, migramos a tabla `categorias_producto (linea, codigo)` con
--    FK compuesto — hoy sería over-engineering.
--
--    Validación de datos:
--    Si por algún motivo quedara un producto con combinación inválida
--    (no debería, por los pasos anteriores), el ADD CHECK falla y la
--    migración entera rollbackea. Defense in depth.
-- ============================================================================
ALTER TABLE productos
  ADD CONSTRAINT productos_categoria_segun_linea CHECK (
    (linea = 'buffet' AND categoria IN ('bebidas','snacks','comidas','otros'))
    OR
    (linea = 'shop'   AND categoria IN ('articulos_padel','vestimenta','palas','accesorios'))
  );

COMMENT ON CONSTRAINT productos_categoria_segun_linea ON productos IS
  'Categorías permitidas según línea:
     buffet → bebidas | snacks | comidas | otros
     shop   → articulos_padel | vestimenta | palas | accesorios';


-- ============================================================================
-- 6. ALTER venta_items + reserva_consumos: snapshot de línea
-- ============================================================================
--    Mismo patrón snapshot que producto_nombre/precio_unitario en
--    ambas tablas. DEFAULT 'buffet' cubre las filas históricas (antes
--    del cambio no existía shop, todo era buffet).
--
--    fn_cerrar_venta y fn_cargar_consumo_turno copian v_producto.linea
--    a este snapshot en cada INSERT — eso se hace en la 0025.
-- ============================================================================
ALTER TABLE venta_items
  ADD COLUMN linea VARCHAR(20) NOT NULL DEFAULT 'buffet'
  CHECK (linea IN ('buffet','shop'));

COMMENT ON COLUMN venta_items.linea IS
  'Snapshot de productos.linea al momento de la venta. Si el producto
   cambia de línea después, este snapshot conserva la línea histórica.
   Lo escribe fn_cerrar_venta (0025).';

ALTER TABLE reserva_consumos
  ADD COLUMN linea VARCHAR(20) NOT NULL DEFAULT 'buffet'
  CHECK (linea IN ('buffet','shop'));

COMMENT ON COLUMN reserva_consumos.linea IS
  'Snapshot de productos.linea al momento del consumo. En la práctica
   siempre vale ''buffet'' (fn_cargar_consumo_turno rechaza shop desde
   la 0025), pero se persiste por consistencia con el patrón snapshot.';


-- ============================================================================
-- 7. Recrear vw_productos_con_stock
-- ============================================================================
--    Postgres expande `SELECT p.*` al momento de crear la vista, NO
--    a runtime. Sin DROP + CREATE, la vista NO incluye la columna
--    `linea` recién agregada.
--
--    El cuerpo de la vista es IDÉNTICO al de la 0010 (último CREATE)
--    — sin modificaciones de lógica, solo la reexpansión.
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
  'Productos + stock_actual (suma de movimientos_stock). Recreada en
   la 0024 para que p.* incluya la columna linea. security_invoker=true
   hace que la RLS del caller aplique al SELECT subyacente (productos
   filtra por club_id correctamente).';


COMMIT;

-- ============================================================================
-- Fin de la migración 0024_lineas_buffet_shop.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Columna linea + CHECK compuesto en productos ----------
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'productos'
--   AND column_name = 'linea';
-- -- Debería listar: linea, character varying, 'buffet'::character varying, NO
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'productos'::regclass AND contype = 'c'
-- ORDER BY conname;
-- -- Debería listar:
-- --   productos_categoria_segun_linea  CHECK (compuesto con OR)
-- --   productos_linea_check            CHECK (linea IN ...)
-- -- Y NO debería estar el viejo productos_categoria_check.

-- ---------- B. Productos reclasificados ----------
-- SELECT id, nombre, linea, categoria FROM productos ORDER BY id;
-- -- Bull Padel debería estar en (shop, articulos_padel).
-- -- Resto en buffet con categoría plural (bebidas/snacks/otros/comidas).

-- ---------- C. Vista actualizada con linea ----------
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='vw_productos_con_stock'
-- ORDER BY ordinal_position;
-- -- Debe incluir `linea` entre las columnas listadas.

-- ---------- D. Snapshots en venta_items y reserva_consumos ----------
-- SELECT column_name, column_default FROM information_schema.columns
-- WHERE table_schema='public' AND column_name='linea'
--   AND table_name IN ('venta_items','reserva_consumos');
-- -- 2 filas, ambas con default 'buffet'.

-- ---------- E. Datos históricos quedaron en buffet ----------
-- SELECT linea, COUNT(*) FROM venta_items GROUP BY linea;
-- SELECT linea, COUNT(*) FROM reserva_consumos GROUP BY linea;
-- -- Todas en buffet (no había shop antes).

-- ---------- F. CHECK compuesto rechaza combinaciones inválidas ----------
-- Como admin en Studio, intentar:
-- INSERT INTO productos (club_id, nombre, linea, categoria, precio)
-- VALUES (<TU_CLUB_ID>, 'TEST inválido', 'buffet', 'articulos_padel', 100);
-- -- Debe fallar con violation del CHECK productos_categoria_segun_linea.
-- ============================================================================
