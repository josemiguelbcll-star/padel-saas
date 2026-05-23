-- ============================================================================
-- 0040_compra_items_bultos.sql
-- Suma detalle de "bultos" en compra_items (cantidad_bultos,
-- unidades_por_bulto, costo_por_bulto) para preservar histórico de
-- compras por presentación. Las columnas que ya existían (cantidad,
-- costo_unitario_compra, subtotal) pasan a ser derivadas con coherencia
-- enforzada server-side. CREATE OR REPLACE de fn_registrar_compra para
-- consumir el shape nuevo de p_items.
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- - ALTER compra_items: + 3 columnas (cantidad_bultos, unidades_por_bulto,
--   costo_por_bulto) en NULLABLE inicial.
-- - Backfill: interpreta cada fila histórica como "1 bulto de `cantidad`
--   unidades por `subtotal` pesos" (preserva los totales sin pérdida).
-- - ALTER COLUMN ... SET NOT NULL para las 3 columnas.
-- - 5 CHECKs nuevos:
--     · cantidad_bultos > 0
--     · unidades_por_bulto > 0
--     · costo_por_bulto >= 0
--     · cantidad = cantidad_bultos * unidades_por_bulto  (exacto)
--     · subtotal = cantidad_bultos * costo_por_bulto      (exacto)
--   costo_unitario_compra NO entra en CHECK de coherencia: tiene
--   redondeo (= ROUND(costo_por_bulto / unidades_por_bulto, 2)).
-- - CREATE OR REPLACE fn_registrar_compra con shape nuevo de p_items:
--     [{producto_id, cantidad_bultos, unidades_por_bulto, costo_por_bulto}]
--   La RPC calcula cantidad / costo_unitario / subtotal internamente.
--   Cambio NO retrocompatible — sin frontend de compras live al cierre
--   de 0039, no rompe nada en producción.
--
-- NO toca:
-- - PPP en sí (fórmula idéntica; cambia solo cómo se deriva
--   costo_unitario_compra desde el JSONB).
-- - compras (cabecera).
-- - movimientos_stock.
-- - fn_cerrar_venta, fn_cargar_consumo_turno, fn_ajustar_stock.
-- - fn_registrar_gasto, fn_inicializar_finanzas.
-- - productos.costo (sigue siendo el PPP).
-- - RLS, GRANTs, policies.
--
-- =====================================================================
-- MANEJO DEL REDONDEO
-- =====================================================================
-- subtotal      = cantidad_bultos × costo_por_bulto    (EXACTO, sin pérdida)
-- cantidad      = cantidad_bultos × unidades_por_bulto (INT exacto)
-- costo_unit_c. = ROUND(costo_por_bulto / unidades_por_bulto, 2)  (redondeado)
--
-- Consecuencia: cantidad × costo_unitario_compra puede NO ser exactamente
-- igual a subtotal cuando la división no da exacta. Ej.: 1 bulto de 12
-- cocas a $1.000 → cantidad=12, costo_unitario=$83,33, subtotal=$1.000
-- (NO $999,96). El CHECK enforza la verdad "lo que pagué": bultos ×
-- costo_por_bulto.
--
-- monto_total del gasto = SUM(subtotales) — exacto, sin centavos perdidos.
-- PPP usa costo_unitario_compra (redondeado) — el ruido cosmético es
-- absorbido por DECIMAL(12,2) en productos.costo.
--
-- =====================================================================
-- BACKFILL
-- =====================================================================
-- Para filas pre-0040: cantidad_bultos=1, unidades_por_bulto=cantidad,
-- costo_por_bulto=subtotal. Interpretación natural: "1 bulto único que
-- contenía `cantidad` unidades, pagado `subtotal` pesos". Preserva los
-- valores derivados existentes y satisface los CHECKs de coherencia
-- (1 * cantidad = cantidad ✓; 1 * subtotal = subtotal ✓).
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. ALTER compra_items — agregar 3 columnas en NULLABLE
-- ============================================================================
ALTER TABLE compra_items
  ADD COLUMN cantidad_bultos INT,
  ADD COLUMN unidades_por_bulto INT,
  ADD COLUMN costo_por_bulto DECIMAL(12,2);


-- ============================================================================
-- 2. Backfill de filas existentes
-- ============================================================================
-- Si la tabla está vacía (caso esperado al cierre de 0039), este UPDATE
-- es un no-op. Si hay filas de prueba, se interpretan como "1 bulto de
-- `cantidad` unidades por `subtotal` pesos" — preserva los totales y
-- pasa los CHECKs que se agregan en el paso 4.
-- ============================================================================
DO $$
DECLARE
  v_backfilled INT;
BEGIN
  UPDATE compra_items
  SET cantidad_bultos = 1,
      unidades_por_bulto = cantidad,
      costo_por_bulto = subtotal
  WHERE cantidad_bultos IS NULL;

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  RAISE NOTICE '0040 backfill compra_items: % fila(s) backfilleada(s) con interpretación "1 bulto de cantidad unidades por subtotal pesos".', v_backfilled;
END $$;


-- ============================================================================
-- 3. ALTER COLUMN SET NOT NULL (después del backfill)
-- ============================================================================
ALTER TABLE compra_items
  ALTER COLUMN cantidad_bultos SET NOT NULL,
  ALTER COLUMN unidades_por_bulto SET NOT NULL,
  ALTER COLUMN costo_por_bulto SET NOT NULL;


-- ============================================================================
-- 4. CHECKs server-side
-- ============================================================================
-- 4.a Positividad de cada campo (3 CHECKs).
ALTER TABLE compra_items
  ADD CONSTRAINT compra_items_cantidad_bultos_positiva
    CHECK (cantidad_bultos > 0);

ALTER TABLE compra_items
  ADD CONSTRAINT compra_items_unidades_por_bulto_positiva
    CHECK (unidades_por_bulto > 0);

ALTER TABLE compra_items
  ADD CONSTRAINT compra_items_costo_por_bulto_no_negativo
    CHECK (costo_por_bulto >= 0);

-- 4.b Coherencia bultos ↔ derivados (2 CHECKs).
--     cantidad y subtotal se calculan EXACTOS desde bultos — el CHECK
--     enforza que ningún INSERT manual los rompa. costo_unitario_compra
--     NO entra: tiene redondeo (ROUND(costo_por_bulto / unidades_por_bulto, 2)).
ALTER TABLE compra_items
  ADD CONSTRAINT compra_items_cantidad_coherencia
    CHECK (cantidad = cantidad_bultos * unidades_por_bulto);

ALTER TABLE compra_items
  ADD CONSTRAINT compra_items_subtotal_coherencia
    CHECK (subtotal = cantidad_bultos * costo_por_bulto);


-- ============================================================================
-- 5. COMMENTs de documentación
-- ============================================================================
COMMENT ON COLUMN compra_items.cantidad_bultos IS
  'Cuántos bultos (jabas, cajas, paquetes, etc.) se compraron en esta
   línea. INT > 0. Junto con unidades_por_bulto y costo_por_bulto
   conforma el detalle de presentación de la compra; las columnas
   cantidad / costo_unitario_compra / subtotal son derivadas
   determinísticamente con CHECKs server-side.';

COMMENT ON COLUMN compra_items.unidades_por_bulto IS
  'Cuántas unidades trae cada bulto. INT > 0. Si la compra fue "suelta",
   se modela con unidades_por_bulto=1.';

COMMENT ON COLUMN compra_items.costo_por_bulto IS
  'Costo de UN bulto completo. DECIMAL(12,2) >= 0. Multiplicado por
   cantidad_bultos da el subtotal EXACTO de la línea (sin pérdida por
   redondeo de dividir entre unidades_por_bulto).';

COMMENT ON COLUMN compra_items.costo_unitario_compra IS
  'DERIVADO: ROUND(costo_por_bulto / unidades_por_bulto, 2). Es el costo
   por unidad que alimenta el PPP (productos.costo). Puede tener
   redondeo cuando la división no da exacta — el subtotal NO depende de
   este valor, se calcula directo desde bultos × costo_por_bulto.';

COMMENT ON COLUMN compra_items.subtotal IS
  'DERIVADO EXACTO: cantidad_bultos × costo_por_bulto. Esta es "la
   verdad de lo que pagué" en esta línea. La suma de los subtotales de
   una compra es el monto exacto del gasto generado (sin centavos
   perdidos por redondeo de costo por unidad).';


-- ============================================================================
-- 6. CREATE OR REPLACE fn_registrar_compra — shape nuevo de p_items
-- ============================================================================
-- Cambios respecto de 0039:
--   - p_items pasa de [{producto_id, cantidad, costo_unitario_compra}]
--     a [{producto_id, cantidad_bultos, unidades_por_bulto, costo_por_bulto}].
--   - Arrays paralelos derivados: v_bultos[], v_und_por_bulto[],
--     v_costos_por_bulto[]. Se calcula client-side de la RPC v_cants[]
--     y v_costo_unit_compra[] como derivados.
--   - Validaciones nuevas (bultos > 0, und/bulto > 0, costo_bulto >= 0)
--     reemplazan las viejas (cantidad > 0, costo_unitario_compra >= 0).
--   - Subtotal por item se calcula EXACTO como bultos × costo_por_bulto.
--   - INSERT en compra_items incluye los 3 campos nuevos.
--   - Resto IDÉNTICO a 0039: gate admin, locks ASC, gasto primero,
--     INSERT compras con valores definitivos, loop final bajo el lock.
--
-- La signature SQL (BIGINT, VARCHAR, DATE, JSONB, TEXT, DATE, VARCHAR)
-- NO cambia — el shape interno del JSONB no es parte del type system de
-- Postgres. CREATE OR REPLACE limpio, sin DROP.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_registrar_compra(
  p_proveedor_id BIGINT,
  p_linea VARCHAR,
  p_fecha_compra DATE,
  p_items JSONB,
  p_observaciones TEXT DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL
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
  v_gasto gastos;
  v_pids BIGINT[];
  v_bultos INT[];
  v_und_por_bulto INT[];
  v_costos_por_bulto DECIMAL(12,2)[];
  v_nuevos_costos DECIMAL(12,2)[];
  v_i INT;
  v_n INT;
  v_producto productos;
  v_stock INT;
  v_cant INT;
  v_costo_unit DECIMAL(12,2);
  v_subtotal DECIMAL(12,2);
  v_nuevo_costo DECIMAL(12,2);
  v_monto_total DECIMAL(12,2) := 0;
  v_obs_gasto TEXT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede registrar compras.';
  END IF;

  -- ── Validaciones básicas de input ─────────────────────────────────
  IF p_linea IS NULL OR p_linea NOT IN ('buffet','shop') THEN
    RAISE EXCEPTION 'La línea de la compra debe ser buffet o shop.';
  END IF;

  IF p_fecha_compra IS NULL THEN
    RAISE EXCEPTION 'La fecha de la compra es obligatoria.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La compra tiene que tener al menos un producto.';
  END IF;

  -- Pago atómico (mismo CHECK que fn_registrar_gasto).
  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si la compra está paga, indicá fecha de pago Y medio de pago. Si no, dejá ambos vacíos (pendiente).';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ── Proveedor: existe + activo + del club ─────────────────────────
  SELECT * INTO v_proveedor
  FROM proveedores
  WHERE id = p_proveedor_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_proveedor.activo THEN
    RAISE EXCEPTION
      'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de cargar la compra.',
      v_proveedor.nombre;
  END IF;

  -- ── Categoría de mercadería para esta línea ───────────────────────
  -- Resuelve por flag es_mercaderia, NO por nombre. Permite que el admin
  -- renombre "Mercadería" sin romper la compra.
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

  -- ── Detectar duplicados de producto_id en items ───────────────────
  -- Rechazamos en lugar de consolidar silencioso: cargar dos líneas del
  -- mismo producto con costos distintos suele ser un error humano.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la compra. Consolidá cada producto en una sola línea.';
  END IF;

  -- ── Extraer arrays paralelos ORDENADOS ASC por producto_id ────────
  -- Imprescindible para lockear en orden ASC y evitar deadlocks
  -- cruzados con fn_cerrar_venta. Shape nuevo: bultos + und/bulto +
  -- costo/bulto. cantidad y costo_unitario_compra se calculan más abajo.
  SELECT
    array_agg((x->>'producto_id')::BIGINT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad_bultos')::INT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'unidades_por_bulto')::INT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'costo_por_bulto')::DECIMAL(12,2) ORDER BY (x->>'producto_id')::BIGINT)
  INTO v_pids, v_bultos, v_und_por_bulto, v_costos_por_bulto
  FROM jsonb_array_elements(p_items) x;

  v_n := array_length(v_pids, 1);

  -- ── Validar el detalle de bultos por item (no necesita lock) ──────
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

  -- ── Calcular monto_total en memoria ────────────────────────────────
  -- Suma de subtotales EXACTOS: cantidad_bultos × costo_por_bulto. Sin
  -- redondeo, sin pérdida de centavos. Es lo que va al gasto.
  v_monto_total := 0;
  FOR v_i IN 1..v_n LOOP
    v_monto_total := v_monto_total + (v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i]);
  END LOOP;

  -- ── Lock exclusivo sobre productos en orden ASC ───────────────────
  -- Mismo orden que fn_cerrar_venta / fn_cargar_consumo_turno /
  -- fn_ajustar_stock. Una venta o compra concurrente sobre los mismos
  -- productos se serializa: la segunda espera al COMMIT de la primera
  -- y ve sus cambios (stock, costo) ya aplicados. El lock se mantiene
  -- hasta COMMIT de esta transacción.
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- ── Validar productos + leer stock + calcular PPP bajo lock ───────
  -- NO escribimos nada todavía. Solo lectura + cómputo en memoria.
  -- Guardamos los PPPs en v_nuevos_costos[] para aplicar en el loop
  -- final, después de tener compra_id.
  v_nuevos_costos := ARRAY[]::DECIMAL(12,2)[];
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto % no existe o no pertenece a tu club.', v_pids[v_i];
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede comprar.', v_producto.nombre;
    END IF;
    IF v_producto.linea <> p_linea THEN
      RAISE EXCEPTION
        'El producto "%" es de la línea %, no podés cargarlo en una compra de %.',
        v_producto.nombre, v_producto.linea, p_linea;
    END IF;

    -- cantidad y costo unitario derivados del detalle de bultos.
    -- cantidad: INT exacto.
    -- costo_unit: redondeado a 2 decimales para fit en DECIMAL(12,2)
    --   y consumo del PPP. División segura porque und/bulto > 0 ya
    --   validado más arriba.
    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);

    -- stock_actual bajo el lock (truncamos negativo a 0 defense-in-depth).
    SELECT GREATEST(0, COALESCE(SUM(cantidad), 0))::INT INTO v_stock
    FROM movimientos_stock
    WHERE producto_id = v_producto.id;

    -- PPP con bordes. División por cero imposible: la rama ELSE
    -- ejecuta solo cuando v_stock > 0; v_cant > 0 ya validado.
    IF v_stock <= 0 OR v_producto.costo IS NULL THEN
      v_nuevo_costo := v_costo_unit;
    ELSE
      v_nuevo_costo := ROUND(
        (v_stock::DECIMAL * v_producto.costo
         + v_cant::DECIMAL * v_costo_unit)
        / (v_stock::DECIMAL + v_cant::DECIMAL),
      2);
    END IF;

    v_nuevos_costos := v_nuevos_costos || v_nuevo_costo;
  END LOOP;

  -- ── Crear el gasto PRIMERO (vía fn_registrar_gasto) ───────────────
  -- Observación autocontenida — no depende de compra_id. La trazabilidad
  -- estructural vive en compras.gasto_id, no en gastos.observaciones.
  -- Si esta llamada falla (ej. medio_pago=efectivo sin caja abierta),
  -- la transacción entera ROLLBACK — todavía no escribimos compras ni
  -- movimientos ni productos.costo. Falla limpia.
  v_obs_gasto := 'Compra a ' || v_proveedor.nombre || ' del ' || p_fecha_compra::TEXT;

  SELECT * INTO v_gasto FROM fn_registrar_gasto(
    p_categoria_id := v_categoria.id,
    p_monto := v_monto_total,
    p_fecha_gasto := p_fecha_compra,
    p_proveedor := NULL,                  -- el snapshot lo pone la RPC desde proveedor_id
    p_observaciones := v_obs_gasto,
    p_fecha_pago := p_fecha_pago,
    p_medio_pago := p_medio_pago,
    p_proveedor_id := v_proveedor.id
  );

  -- ── INSERT cabecera compras con valores DEFINITIVOS ───────────────
  -- tipo='compra' + gasto_id NOT NULL + monto_total ya conocido.
  -- El CHECK compras_gasto_segun_tipo pasa en el primer y único INSERT.
  INSERT INTO compras (
    club_id, proveedor_id, tipo, linea, fecha_compra,
    monto_total, gasto_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_proveedor.id, 'compra', p_linea, p_fecha_compra,
    v_monto_total, v_gasto.id, p_observaciones, v_usuario_id
  )
  RETURNING * INTO v_compra;

  -- ── Loop de escritura: items + movimientos + UPDATE costo ─────────
  -- Bajo el mismo lock FOR UPDATE adquirido más arriba (sigue vivo
  -- hasta COMMIT). v_nuevos_costos[v_i] ya está calculado.
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;

    -- Derivados desde bultos. cantidad y subtotal son EXACTOS — los
    -- CHECKs compra_items_cantidad_coherencia y _subtotal_coherencia
    -- los validan server-side. costo_unitario_compra es ROUND a 2.
    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);
    v_subtotal := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];

    -- INSERT compra_items con snapshots + detalle de bultos.
    INSERT INTO compra_items (
      club_id, compra_id, producto_id, producto_nombre,
      cantidad, costo_unitario_compra, subtotal, linea,
      cantidad_bultos, unidades_por_bulto, costo_por_bulto
    ) VALUES (
      v_club_id, v_compra.id, v_producto.id, v_producto.nombre,
      v_cant, v_costo_unit, v_subtotal, v_producto.linea,
      v_bultos[v_i], v_und_por_bulto[v_i], v_costos_por_bulto[v_i]
    );

    -- INSERT movimientos_stock — fuente='compra_manual', compra_id NOT
    -- NULL para distinguir de las legacy (fn_registrar_movimiento_stock).
    -- cantidad va en UNIDADES (no bultos) — es lo que mide el stock.
    INSERT INTO movimientos_stock (
      club_id, producto_id, cantidad, fuente,
      venta_id, reserva_consumo_id, compra_id,
      observaciones, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, v_cant, 'compra_manual',
      NULL, NULL, v_compra.id,
      'Compra #' || v_compra.id::TEXT,
      v_usuario_id
    );

    -- UPDATE productos.costo con el PPP recién calculado.
    UPDATE productos
    SET costo = v_nuevos_costos[v_i]
    WHERE id = v_producto.id;
  END LOOP;

  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION fn_registrar_compra(BIGINT, VARCHAR, DATE, JSONB, TEXT, DATE, VARCHAR) IS
  'Registra una compra unificada con PPP. Atómica. Shape de p_items
   desde 0040: [{producto_id, cantidad_bultos, unidades_por_bulto,
   costo_por_bulto}]. La RPC deriva cantidad (= bultos × und/bulto),
   costo_unitario_compra (= ROUND(costo_bulto / und/bulto, 2)) y
   subtotal (= bultos × costo_bulto EXACTO). Lockea productos en orden
   ASC, crea el gasto primero (sin centavos perdidos: monto = SUM
   subtotales exactos), inserta compras con valores definitivos, loop
   final de items + movimientos + UPDATE productos.costo bajo el lock.
   Gate: admin only. CHECKs server-side garantizan coherencia
   cantidad/subtotal vs bultos.';

-- Re-emitimos GRANT EXECUTE por idempotencia (en caso de re-ejecución
-- del archivo). Ya estaba dado en 0039; no hace daño.
GRANT EXECUTE ON FUNCTION fn_registrar_compra(BIGINT, VARCHAR, DATE, JSONB, TEXT, DATE, VARCHAR)
  TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0040_compra_items_bultos.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Estructura: 3 columnas nuevas + 5 CHECKs ----------
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'compra_items'
--   AND column_name IN ('cantidad_bultos','unidades_por_bulto','costo_por_bulto');
-- → 3 filas, todas NOT NULL.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'compra_items'::regclass
--   AND conname LIKE 'compra_items_%';
-- → 5 CHECKs nuevos: positividad de bultos / und_por_bulto / costo_por_bulto,
--   y coherencia cantidad / subtotal.

-- ---------- B. Backfill (debería ser 0 filas si no hay compras de prueba) ----------
-- SELECT cantidad_bultos, unidades_por_bulto, costo_por_bulto,
--        cantidad, subtotal,
--        (cantidad = cantidad_bultos * unidades_por_bulto) AS coherencia_cant,
--        (subtotal = cantidad_bultos * costo_por_bulto)     AS coherencia_sub
-- FROM compra_items;
-- → Si hay filas, todas con coherencia_cant=TRUE y coherencia_sub=TRUE.

-- ---------- C. fn_registrar_compra con shape nuevo: path feliz ----------
-- Como admin del club, con un proveedor activo y una categoría mercadería
-- marcada en la unidad de buffet:
--   await window.supabase.rpc('fn_registrar_compra', {
--     p_proveedor_id: <id>,
--     p_linea: 'buffet',
--     p_fecha_compra: '2026-05-23',
--     p_items: [
--       { producto_id: <id_coca>, cantidad_bultos: 4,
--         unidades_por_bulto: 6, costo_por_bulto: 3600 },
--       { producto_id: <id_agua>, cantidad_bultos: 1,
--         unidades_por_bulto: 12, costo_por_bulto: 1000 }
--     ],
--     p_observaciones: 'TEST bultos',
--     p_fecha_pago: '2026-05-23',
--     p_medio_pago: 'transferencia'
--   });
-- → compra: monto_total = 4*3600 + 1*1000 = 15400 (EXACTO).
-- → compra_items[0]: cantidad=24, costo_unitario_compra=600.00,
--   subtotal=14400.00, cantidad_bultos=4, unidades_por_bulto=6,
--   costo_por_bulto=3600.00.
-- → compra_items[1]: cantidad=12, costo_unitario_compra=83.33,
--   subtotal=1000.00, cantidad_bultos=1, unidades_por_bulto=12,
--   costo_por_bulto=1000.00.
-- → movimientos_stock: 2 filas con cantidad en UNIDADES (24 y 12).
-- → gastos: monto=15400.00 (sin centavos perdidos).

-- ---------- D. Redondeo del costo unitario ----------
-- Producto sin costo previo, primera compra: 1 bulto × 12 und × $1000.
-- Tras la compra:
--   SELECT costo FROM productos WHERE id = <X>;
-- → 83.33 (PPP con stock=0 ⇒ se reinicia, costo = costo_unitario_compra).

-- ---------- E. Coherencia inviolable: CHECK directo ----------
-- Intentar INSERT manual con cantidad incoherente:
--   INSERT INTO compra_items (
--     club_id, compra_id, producto_id, producto_nombre,
--     cantidad, costo_unitario_compra, subtotal, linea,
--     cantidad_bultos, unidades_por_bulto, costo_por_bulto
--   ) VALUES (<club>, <compra>, <prod>, 'X',
--     999, 100, 99900, 'buffet',
--     2, 3, 100);
-- → ERROR 23514 compra_items_cantidad_coherencia (999 ≠ 2*3).

-- ---------- F. Validaciones de la RPC ----------
-- p_items con cantidad_bultos = 0:
-- → ERROR: 'La cantidad de bultos debe ser mayor a 0 (item 1).'
-- p_items con unidades_por_bulto = 0:
-- → ERROR: 'Las unidades por bulto deben ser mayor a 0 (item 1).'
-- p_items con costo_por_bulto < 0:
-- → ERROR: 'El costo por bulto debe ser >= 0 (item 1).'

-- ---------- G. Compra "suelta" (1 unidad por bulto) ----------
-- 5 cocas sueltas a $80 cada una:
--   p_items: [{ producto_id: <id>, cantidad_bultos: 5,
--               unidades_por_bulto: 1, costo_por_bulto: 80 }]
-- → cantidad=5, costo_unitario_compra=80.00, subtotal=400.00.
-- → Funciona idéntico al caso de bulto múltiple.

-- ---------- H. fn_cerrar_venta sigue intacta ----------
-- Después de la compra del paso C, vender 1 unidad del producto coca:
--   await window.supabase.rpc('fn_cerrar_venta', { ... });
-- → venta_items.costo_unitario = 600.00 (productos.costo actualizado por PPP).
-- → movimientos_stock con fuente='venta', compra_id IS NULL.

-- ---------- I. Concurrencia compra + venta (manual, 2 conexiones) ----------
-- conn1> BEGIN; SELECT fn_registrar_compra(... bultos ...);  -- lock productos
-- conn2> BEGIN; SELECT fn_cerrar_venta(...);                  -- espera el lock
-- conn1> COMMIT;
-- conn2> (continúa, lee productos.costo nuevo del PPP) COMMIT.
-- → Sin deadlock. Stock y costos consistentes al final.
-- ============================================================================
