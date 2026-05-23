-- ============================================================================
-- 0041_oc_dos_momentos.sql
-- Orden de Compra (OC) en dos momentos. Hoy fn_registrar_compra mueve
-- stock + costo + gasto en un solo acto. Ese flujo pasa a ser
-- RECEPCIÓN. Falta el momento PEDIDO (la OC propiamente dicha).
--
-- Momento 1 — OC (estado='pedida'): documento de pedido. No mueve
-- stock, no recalcula costo, no genera gasto. Editable y cancelable.
-- Sin IVA todavía (no hay factura). Todo en NETO.
--
-- Momento 2 — RECEPCIÓN (estado='recibida'): llega la mercadería con
-- factura. Permite ajustar items contra la factura real. Llega el IVA
-- discriminado (neto / iva / total por item, tasa por item). Acá sí
-- sube stock + recalcula PPP + crea gasto.
--
-- Condición fiscal del club: nueva columna `clubes.condicion_fiscal`
-- (monotributista | responsable_inscripto). Determina cómo se calcula
-- el costo del PPP:
--   - responsable_inscripto: PPP usa NETO (IVA es crédito fiscal).
--   - monotributista: PPP usa TOTAL con IVA (no recupera).
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- - ALTER clubes: + condicion_fiscal NOT NULL DEFAULT 'monotributista'.
-- - ALTER compras:
--     - RENAME fecha_compra → fecha_oc.
--     - + estado (pedida/recibida/cancelada), fecha_recepcion,
--       condicion_pago (al_dia/a_plazo/al_recibir), fecha_compromiso_pago,
--       monto_neto_oc, monto_neto, monto_iva, comprobante_tipo,
--       comprobante_numero, condicion_fiscal_club.
--     - monto_total pasa a NULLABLE (NULL en pedida/cancelada,
--       NOT NULL en recibida).
--     - Reemplazo del CHECK compras_gasto_segun_tipo por
--       compras_estado_gasto_coherencia (más rico).
--     - + CHECK compras_condicion_pago_coherencia.
-- - ALTER compra_items: + tasa_iva, subtotal_iva, subtotal_total,
--   costo_unitario_ppp (todos NULLABLE; se llenan al recibir).
--   + CHECK compra_items_iva_coherencia (subtotal_total = neto + iva).
-- - Backfill de la compra histórica (id 3) y sus compra_items:
--   estado='recibida', tasa_iva=0, subtotal_iva=0, subtotal_total=
--   subtotal, costo_unitario_ppp=costo_unitario_compra (PPP histórico
--   = NETO, válido porque pre-0041 no se discriminaba IVA).
-- - DROP fn_registrar_compra (reemplazada por crear_oc + recibir_oc).
-- - CREATE 4 RPCs: fn_crear_oc, fn_actualizar_oc, fn_cancelar_oc,
--   fn_recibir_oc.
--
-- NO toca:
-- - proveedores, productos, movimientos_stock (sigue compra_id +
--   coherencia_fuente como en 0039).
-- - gastos, fn_registrar_gasto (la recepción la sigue usando con
--   p_proveedor_id).
-- - categorias_gasto (es_mercaderia), unidades_negocio.
-- - fn_cerrar_venta, fn_cargar_consumo_turno, fn_ajustar_stock.
--
-- =====================================================================
-- PPP SEGÚN CONDICIÓN FISCAL
-- =====================================================================
-- SI condicion_fiscal_club = 'responsable_inscripto':
--   costo_unitario_ppp = costo_unitario_compra (NETO)
-- SI condicion_fiscal_club = 'monotributista':
--   costo_unitario_ppp = ROUND(
--     (costo_por_bulto * (1 + tasa_iva/100)) / unidades_por_bulto,
--   2)
--
-- La condición fiscal se SNAPSHOTEA en compras.condicion_fiscal_club al
-- recibir. Si el club cambia de condición fiscal después, las compras
-- históricas mantienen su tratamiento (PPP no se rehace).
--
-- =====================================================================
-- ESTADOS Y TRANSICIONES
-- =====================================================================
--   pedida    → recibida  (fn_recibir_oc)
--   pedida    → cancelada (fn_cancelar_oc)
--   recibida  → (final; revertir requiere flujo de anulación, deuda)
--   cancelada → (final; reabrir no contemplado)
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. ALTER clubes — condicion_fiscal
-- ============================================================================
ALTER TABLE clubes
  ADD COLUMN condicion_fiscal VARCHAR(20) NOT NULL DEFAULT 'monotributista'
    CHECK (condicion_fiscal IN ('monotributista','responsable_inscripto'));

COMMENT ON COLUMN clubes.condicion_fiscal IS
  'Condición fiscal del club ante AFIP. Determina cómo fn_recibir_oc
   calcula productos.costo (PPP): responsable_inscripto promedia NETO,
   monotributista promedia TOTAL con IVA. El valor se snapshotea en
   compras.condicion_fiscal_club al recibir cada compra. Default
   monotributista (cubre la mayoría de clubes chicos sin tocar config).';


-- ============================================================================
-- 2. ALTER compras — RENAME + columnas nuevas + monto_total → NULLABLE
-- ============================================================================
-- 2.a Rename fecha_compra → fecha_oc (semánticamente más clara). Postgres
--     actualiza índices y referencias automáticamente.
ALTER TABLE compras RENAME COLUMN fecha_compra TO fecha_oc;

-- 2.b Estado del ciclo de vida.
ALTER TABLE compras
  ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'pedida'
    CHECK (estado IN ('pedida','recibida','cancelada'));

-- 2.c Fecha de recepción (NULL en pedida/cancelada).
ALTER TABLE compras ADD COLUMN fecha_recepcion DATE;

-- 2.d Condición de pago al armar la OC.
ALTER TABLE compras
  ADD COLUMN condicion_pago VARCHAR(20) NOT NULL DEFAULT 'al_recibir'
    CHECK (condicion_pago IN ('al_dia','a_plazo','al_recibir'));

ALTER TABLE compras ADD COLUMN fecha_compromiso_pago DATE;

-- 2.e Totales. monto_neto_oc es el compromiso al pedir; monto_neto +
--     monto_iva son los reales al recibir. monto_total = neto + iva (NULL
--     hasta recibir; el actual NOT NULL se relaja).
ALTER TABLE compras
  ADD COLUMN monto_neto_oc DECIMAL(12,2) NOT NULL DEFAULT 0
    CHECK (monto_neto_oc >= 0);

ALTER TABLE compras
  ADD COLUMN monto_neto DECIMAL(12,2) CHECK (monto_neto IS NULL OR monto_neto >= 0);

ALTER TABLE compras
  ADD COLUMN monto_iva DECIMAL(12,2) CHECK (monto_iva IS NULL OR monto_iva >= 0);

ALTER TABLE compras ALTER COLUMN monto_total DROP NOT NULL;

-- 2.f Datos del comprobante fiscal (snapshot).
ALTER TABLE compras ADD COLUMN comprobante_tipo VARCHAR(20);
ALTER TABLE compras ADD COLUMN comprobante_numero VARCHAR(40);
ALTER TABLE compras
  ADD COLUMN condicion_fiscal_club VARCHAR(20)
    CHECK (
      condicion_fiscal_club IS NULL
      OR condicion_fiscal_club IN ('monotributista','responsable_inscripto')
    );


-- ============================================================================
-- 3. ALTER compra_items — columnas IVA + costo_unitario_ppp
-- ============================================================================
-- NULL en estado pedida (no hay factura), se llenan al recibir.
ALTER TABLE compra_items
  ADD COLUMN tasa_iva DECIMAL(5,2)
    CHECK (tasa_iva IS NULL OR (tasa_iva >= 0 AND tasa_iva <= 100));

ALTER TABLE compra_items
  ADD COLUMN subtotal_iva DECIMAL(12,2)
    CHECK (subtotal_iva IS NULL OR subtotal_iva >= 0);

ALTER TABLE compra_items
  ADD COLUMN subtotal_total DECIMAL(12,2)
    CHECK (subtotal_total IS NULL OR subtotal_total >= 0);

ALTER TABLE compra_items
  ADD COLUMN costo_unitario_ppp DECIMAL(12,2)
    CHECK (costo_unitario_ppp IS NULL OR costo_unitario_ppp >= 0);


-- ============================================================================
-- 4. Backfill de compras existentes (pre-0041 = conceptualmente recibidas)
-- ============================================================================
-- Toda fila en compras pre-0041 fue creada por fn_registrar_compra (vieja
-- API que mezclaba pedido y recepción). Las identificamos por:
--   estado='pedida' (default que aplicó el ADD COLUMN)
--   AND gasto_id IS NOT NULL (la vieja siempre generaba gasto)
-- Esa combinación NO puede aparecer en una OC verdadera (estado=pedida
-- nunca tiene gasto). Backfill seguro e idempotente.
DO $$
DECLARE
  v_compras_bf INT;
  v_items_bf INT;
BEGIN
  -- Compras: pasar a estado='recibida' con fecha_recepcion = fecha_oc.
  -- monto_neto = monto_total (NETO histórico, sin discriminación IVA).
  -- monto_iva = 0. condicion_fiscal_club = NULL (histórico ambiguo).
  -- monto_neto_oc = monto_total (lo que se "pidió" coincidía con el total).
  UPDATE compras
  SET estado = 'recibida',
      fecha_recepcion = fecha_oc,
      condicion_pago = 'al_recibir',
      monto_neto = monto_total,
      monto_neto_oc = monto_total,
      monto_iva = 0,
      condicion_fiscal_club = NULL
  WHERE estado = 'pedida'
    AND gasto_id IS NOT NULL;
  GET DIAGNOSTICS v_compras_bf = ROW_COUNT;

  -- compra_items: tasa_iva=0, subtotal_iva=0, subtotal_total=subtotal,
  -- costo_unitario_ppp=costo_unitario_compra. El PPP histórico coincide
  -- con NETO porque pre-0041 nadie discriminó IVA.
  UPDATE compra_items
  SET tasa_iva = 0,
      subtotal_iva = 0,
      subtotal_total = subtotal,
      costo_unitario_ppp = costo_unitario_compra
  WHERE tasa_iva IS NULL;
  GET DIAGNOSTICS v_items_bf = ROW_COUNT;

  RAISE NOTICE '0041 backfill: % compra(s) marcadas como ''recibida''; % item(s) backfilleados con IVA=0 y PPP=NETO.',
    v_compras_bf, v_items_bf;
END $$;


-- ============================================================================
-- 5. Reemplazo del CHECK compras_gasto_segun_tipo + CHECKs nuevos
-- ============================================================================
-- 5.a DROP del CHECK viejo (no contempla estado).
ALTER TABLE compras DROP CONSTRAINT IF EXISTS compras_gasto_segun_tipo;

-- 5.b CHECK nuevo: coherencia estado ↔ gasto/fechas/totales/tipo.
ALTER TABLE compras
  ADD CONSTRAINT compras_estado_gasto_coherencia CHECK (
    (estado = 'pedida'
        AND gasto_id IS NULL
        AND fecha_recepcion IS NULL
        AND monto_total IS NULL
        AND monto_neto IS NULL
        AND monto_iva IS NULL)
    OR (estado = 'cancelada'
        AND gasto_id IS NULL
        AND fecha_recepcion IS NULL
        AND monto_total IS NULL
        AND monto_neto IS NULL
        AND monto_iva IS NULL)
    OR (estado = 'recibida'
        AND fecha_recepcion IS NOT NULL
        AND monto_total IS NOT NULL
        AND monto_neto IS NOT NULL
        AND monto_iva IS NOT NULL
        AND (
          (tipo = 'compra'      AND gasto_id IS NOT NULL)
          OR (tipo IN ('bonificacion','consignacion') AND gasto_id IS NULL)
        )
    )
  );

COMMENT ON CONSTRAINT compras_estado_gasto_coherencia ON compras IS
  'Coherencia estado ↔ campos derivados. pedida/cancelada: gasto_id +
   fecha_recepcion + montos en NULL. recibida: fecha_recepcion +
   monto_total + monto_neto + monto_iva NOT NULL, gasto_id según tipo.';

-- 5.c CHECK condición de pago ↔ fecha de compromiso.
ALTER TABLE compras
  ADD CONSTRAINT compras_condicion_pago_coherencia CHECK (
    (condicion_pago = 'a_plazo' AND fecha_compromiso_pago IS NOT NULL)
    OR (condicion_pago IN ('al_dia','al_recibir') AND fecha_compromiso_pago IS NULL)
  );


-- ============================================================================
-- 6. CHECK de coherencia neto/IVA/total en compra_items
-- ============================================================================
-- Permite NULL en pedida (todos los IVA columns en NULL). Cuando ambos
-- subtotal_iva y subtotal_total están seteados, fuerza la suma.
ALTER TABLE compra_items
  ADD CONSTRAINT compra_items_iva_coherencia CHECK (
    subtotal_iva IS NULL
    OR subtotal_total IS NULL
    OR subtotal_total = subtotal + subtotal_iva
  );


-- ============================================================================
-- 7. Índices nuevos
-- ============================================================================
CREATE INDEX idx_compras_estado ON compras (club_id, estado);

-- El índice viejo idx_compras_club_fecha sigue apuntando a fecha_oc
-- automáticamente tras el RENAME — Postgres actualiza la definición.


-- ============================================================================
-- 8. DROP fn_registrar_compra (reemplazada por crear_oc + recibir_oc)
-- ============================================================================
DROP FUNCTION IF EXISTS fn_registrar_compra(BIGINT, VARCHAR, DATE, JSONB, TEXT, DATE, VARCHAR);


-- ============================================================================
-- 9. fn_crear_oc — Momento 1 (PEDIDO)
-- ============================================================================
-- Crea una OC en estado='pedida'. Solo NETO, sin IVA, sin pago. No
-- mueve stock, no recalcula PPP, no crea gasto. Editable y cancelable.
--
-- Gate: admin only del club.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_crear_oc(
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
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear órdenes de compra.';
  END IF;

  -- ── Validaciones básicas de input ─────────────────────────────────
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

  -- ── Proveedor: existe + activo + del club ─────────────────────────
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

  -- ── Categoría de mercadería (validamos al pedir para fallar temprano) ─
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

  -- ── Detectar duplicados ───────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la OC. Consolidá cada producto en una sola línea.';
  END IF;

  -- ── Extraer arrays paralelos ──────────────────────────────────────
  SELECT
    array_agg((x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad_bultos')::INT),
    array_agg((x->>'unidades_por_bulto')::INT),
    array_agg((x->>'costo_por_bulto')::DECIMAL(12,2))
  INTO v_pids, v_bultos, v_und_por_bulto, v_costos_por_bulto
  FROM jsonb_array_elements(p_items) x;

  v_n := array_length(v_pids, 1);

  -- ── Validar cantidades / costos ────────────────────────────────────
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

  -- ── Validar productos (existencia + activo + línea) ──────────────
  -- NO lockeamos: la OC no toca stock ni costo. La recepción sí lockea.
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

    v_monto_neto_oc := v_monto_neto_oc + (v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i]);
  END LOOP;

  -- ── INSERT cabecera en estado='pedida' ─────────────────────────────
  INSERT INTO compras (
    club_id, proveedor_id, tipo, linea, estado,
    fecha_oc, fecha_recepcion,
    condicion_pago, fecha_compromiso_pago,
    monto_neto_oc, monto_neto, monto_iva, monto_total,
    gasto_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_proveedor.id, 'compra', p_linea, 'pedida',
    p_fecha_oc, NULL,
    p_condicion_pago, p_fecha_compromiso_pago,
    v_monto_neto_oc, NULL, NULL, NULL,
    NULL, p_observaciones, v_usuario_id
  )
  RETURNING * INTO v_compra;

  -- ── INSERT compra_items con NETO + IVA/PPP en NULL ────────────────
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
      v_club_id, v_compra.id, v_producto.id, v_producto.nombre,
      v_cant, v_costo_unit, v_subtotal, v_producto.linea,
      v_bultos[v_i], v_und_por_bulto[v_i], v_costos_por_bulto[v_i],
      NULL, NULL, NULL, NULL
    );
  END LOOP;

  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION fn_crear_oc(BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT) IS
  'Crea una orden de compra en estado=''pedida''. No mueve stock ni
   recalcula costo ni crea gasto — es un documento de pedido. Solo NETO
   (sin IVA, sin factura). Editable con fn_actualizar_oc y cancelable
   con fn_cancelar_oc. Para recibir y asentar contablemente, llamar
   fn_recibir_oc. Gate: admin only.';

GRANT EXECUTE ON FUNCTION fn_crear_oc(BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT)
  TO authenticated;


-- ============================================================================
-- 10. fn_actualizar_oc — Editar OC en estado 'pedida'
-- ============================================================================
-- Reemplaza atómicamente cabecera + items. Como una OC pedida nunca
-- asentó nada (sin movimientos_stock, sin gasto, sin productos.costo),
-- DELETE + INSERT de items es seguro.
-- ============================================================================
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
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede editar órdenes de compra.';
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
   costo. Rechaza si la OC está recibida o cancelada. Gate: admin only.';

GRANT EXECUTE ON FUNCTION fn_actualizar_oc(BIGINT, BIGINT, VARCHAR, DATE, JSONB, VARCHAR, DATE, TEXT)
  TO authenticated;


-- ============================================================================
-- 11. fn_cancelar_oc — Anulación pre-recepción
-- ============================================================================
-- Soft. Solo cambia estado a 'cancelada'. NO toca stock, costo, gasto
-- (la OC en pedida nunca los impactó). Irreversible en este bloque.
-- ============================================================================
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
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede cancelar órdenes de compra.';
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
   en este bloque. Gate: admin only.';

GRANT EXECUTE ON FUNCTION fn_cancelar_oc(BIGINT, TEXT) TO authenticated;


-- ============================================================================
-- 12. fn_recibir_oc — Momento 2 (RECEPCIÓN)
-- ============================================================================
-- Recibe una OC en estado='pedida'. Permite ajustar items contra la
-- factura real (agregar/quitar/modificar productos, costos, IVA). Sube
-- stock, recalcula PPP según condición fiscal del club, crea el gasto.
-- Pasa estado a 'recibida'.
--
-- PPP según condición fiscal (snapshot en compras.condicion_fiscal_club):
--   responsable_inscripto → costo_unitario_ppp = NETO
--   monotributista         → costo_unitario_ppp = TOTAL con IVA
--
-- Atomicidad: si fn_registrar_gasto falla (caja cerrada + efectivo),
-- ROLLBACK total — la OC queda en 'pedida' sin cambios.
--
-- Gate: admin only.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_recibir_oc(
  p_compra_id BIGINT,
  p_fecha_recepcion DATE,
  p_items_recepcion JSONB,
  p_comprobante_tipo VARCHAR DEFAULT NULL,
  p_comprobante_numero VARCHAR DEFAULT NULL,
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
  v_compra compras;
  v_proveedor proveedores;
  v_categoria categorias_gasto;
  v_condicion_fiscal VARCHAR;
  v_gasto gastos;
  v_pids BIGINT[];
  v_bultos INT[];
  v_und_por_bulto INT[];
  v_costos_por_bulto DECIMAL(12,2)[];
  v_tasas_iva DECIMAL(5,2)[];
  v_nuevos_costos DECIMAL(12,2)[];
  v_i INT;
  v_n INT;
  v_producto productos;
  v_stock INT;
  v_cant INT;
  v_costo_unit_neto DECIMAL(12,2);
  v_subtotal_neto DECIMAL(12,2);
  v_subtotal_iva DECIMAL(12,2);
  v_subtotal_total DECIMAL(12,2);
  v_costo_unit_ppp DECIMAL(12,2);
  v_nuevo_costo DECIMAL(12,2);
  v_monto_neto DECIMAL(12,2) := 0;
  v_monto_iva DECIMAL(12,2) := 0;
  v_monto_total DECIMAL(12,2) := 0;
  v_obs_gasto TEXT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede recibir órdenes de compra.';
  END IF;

  -- ── Verificar OC + estado ──────────────────────────────────────────
  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La OC no existe o no pertenece a tu club.';
  END IF;
  IF v_compra.estado <> 'pedida' THEN
    RAISE EXCEPTION 'Solo se pueden recibir OCs en estado "pedida". Esta OC está %.', v_compra.estado;
  END IF;

  -- ── Validaciones básicas ───────────────────────────────────────────
  IF p_fecha_recepcion IS NULL THEN
    RAISE EXCEPTION 'La fecha de recepción es obligatoria.';
  END IF;
  IF p_items_recepcion IS NULL OR jsonb_array_length(p_items_recepcion) = 0 THEN
    RAISE EXCEPTION 'La recepción tiene que tener al menos un item. Si la OC no se concretó, cancelala.';
  END IF;

  -- Pago atómico (igual que fn_registrar_gasto).
  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si pagás al recibir, indicá fecha de pago Y medio. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;
  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ── Snapshot de la condición fiscal del club ──────────────────────
  SELECT condicion_fiscal INTO v_condicion_fiscal FROM clubes WHERE id = v_club_id;
  IF v_condicion_fiscal IS NULL THEN
    RAISE EXCEPTION 'El club no tiene configurada la condición fiscal. Andá a Configuración → Marca.';
  END IF;

  -- ── Proveedor (existe garantizado por FK de compras.proveedor_id) ─
  SELECT * INTO v_proveedor FROM proveedores WHERE id = v_compra.proveedor_id;
  IF NOT v_proveedor.activo THEN
    RAISE EXCEPTION
      'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de recibir.',
      v_proveedor.nombre;
  END IF;

  -- ── Categoría de mercadería ───────────────────────────────────────
  SELECT cg.* INTO v_categoria
  FROM categorias_gasto cg
  JOIN unidades_negocio u ON u.id = cg.unidad_id
  WHERE cg.club_id = v_club_id AND u.tipo = v_compra.linea
    AND cg.es_mercaderia = TRUE AND cg.activa = TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Tu club no tiene una categoría marcada como mercadería para la unidad de %. Andá a Configuración → Categorías de gasto y marcá una.',
      v_compra.linea;
  END IF;

  -- ── Detectar duplicados en items_recepcion ─────────────────────────
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items_recepcion) x
    GROUP BY (x->>'producto_id')::BIGINT HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la recepción. Consolidá cada producto en una sola línea.';
  END IF;

  -- ── Extraer arrays ordenados ASC por producto_id (lock order) ──────
  SELECT
    array_agg((x->>'producto_id')::BIGINT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad_bultos')::INT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'unidades_por_bulto')::INT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'costo_por_bulto')::DECIMAL(12,2) ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'tasa_iva')::DECIMAL(5,2) ORDER BY (x->>'producto_id')::BIGINT)
  INTO v_pids, v_bultos, v_und_por_bulto, v_costos_por_bulto, v_tasas_iva
  FROM jsonb_array_elements(p_items_recepcion) x;

  v_n := array_length(v_pids, 1);

  -- ── Validar items ──────────────────────────────────────────────────
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
    IF v_tasas_iva[v_i] IS NULL OR v_tasas_iva[v_i] < 0 OR v_tasas_iva[v_i] > 100 THEN
      RAISE EXCEPTION 'La tasa de IVA debe estar entre 0 y 100 (item %). Si no corresponde IVA, pasá 0.', v_i;
    END IF;
  END LOOP;

  -- ── Lock exclusivo sobre productos en orden ASC ───────────────────
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- ── Validar productos + calcular PPP por item (sin escribir) ──────
  v_nuevos_costos := ARRAY[]::DECIMAL(12,2)[];
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos WHERE id = v_pids[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto % no existe o no pertenece a tu club.', v_pids[v_i];
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede recibir.', v_producto.nombre;
    END IF;
    IF v_producto.linea <> v_compra.linea THEN
      RAISE EXCEPTION
        'El producto "%" es de la línea %, no coincide con la línea de la OC (%).',
        v_producto.nombre, v_producto.linea, v_compra.linea;
    END IF;

    -- Cálculos derivados NETO + IVA + costo PPP.
    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit_neto := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);
    v_subtotal_neto := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];
    v_subtotal_iva := ROUND(v_subtotal_neto * v_tasas_iva[v_i] / 100, 2);
    v_subtotal_total := v_subtotal_neto + v_subtotal_iva;

    -- PPP según condición fiscal del club.
    IF v_condicion_fiscal = 'responsable_inscripto' THEN
      -- IVA es crédito fiscal: PPP usa NETO.
      v_costo_unit_ppp := v_costo_unit_neto;
    ELSE
      -- monotributista: no recupera IVA, PPP usa TOTAL con IVA.
      v_costo_unit_ppp := ROUND(
        (v_costos_por_bulto[v_i] * (1 + v_tasas_iva[v_i] / 100))
        / v_und_por_bulto[v_i]::DECIMAL,
      2);
    END IF;

    -- stock_actual bajo el lock + PPP.
    SELECT GREATEST(0, COALESCE(SUM(cantidad), 0))::INT INTO v_stock
    FROM movimientos_stock WHERE producto_id = v_producto.id;

    IF v_stock <= 0 OR v_producto.costo IS NULL THEN
      v_nuevo_costo := v_costo_unit_ppp;
    ELSE
      v_nuevo_costo := ROUND(
        (v_stock::DECIMAL * v_producto.costo + v_cant::DECIMAL * v_costo_unit_ppp)
        / (v_stock::DECIMAL + v_cant::DECIMAL),
      2);
    END IF;

    v_nuevos_costos := v_nuevos_costos || v_nuevo_costo;

    -- Acumular totales para el gasto.
    v_monto_neto := v_monto_neto + v_subtotal_neto;
    v_monto_iva := v_monto_iva + v_subtotal_iva;
    v_monto_total := v_monto_total + v_subtotal_total;
  END LOOP;

  -- ── DELETE compra_items vigentes (los de la pedida, sin movimientos) ─
  DELETE FROM compra_items WHERE compra_id = p_compra_id;

  -- ── Crear el gasto (monto_total = neto + IVA) ──────────────────────
  v_obs_gasto := 'Compra a ' || v_proveedor.nombre || ' del ' || p_fecha_recepcion::TEXT;
  IF p_comprobante_tipo IS NOT NULL OR p_comprobante_numero IS NOT NULL THEN
    v_obs_gasto := v_obs_gasto || ' ('
      || COALESCE(p_comprobante_tipo, '') || ' '
      || COALESCE(p_comprobante_numero, '') || ')';
  END IF;

  SELECT * INTO v_gasto FROM fn_registrar_gasto(
    p_categoria_id := v_categoria.id,
    p_monto := v_monto_total,
    p_fecha_gasto := p_fecha_recepcion,
    p_proveedor := NULL,
    p_observaciones := v_obs_gasto,
    p_fecha_pago := p_fecha_pago,
    p_medio_pago := p_medio_pago,
    p_proveedor_id := v_proveedor.id
  );

  -- ── INSERT compra_items + movimientos + UPDATE productos.costo ────
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    -- Recalcular derivados (idénticos a los del loop anterior, los
    -- recomputamos para claridad — son baratos).
    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit_neto := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);
    v_subtotal_neto := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];
    v_subtotal_iva := ROUND(v_subtotal_neto * v_tasas_iva[v_i] / 100, 2);
    v_subtotal_total := v_subtotal_neto + v_subtotal_iva;

    IF v_condicion_fiscal = 'responsable_inscripto' THEN
      v_costo_unit_ppp := v_costo_unit_neto;
    ELSE
      v_costo_unit_ppp := ROUND(
        (v_costos_por_bulto[v_i] * (1 + v_tasas_iva[v_i] / 100))
        / v_und_por_bulto[v_i]::DECIMAL,
      2);
    END IF;

    INSERT INTO compra_items (
      club_id, compra_id, producto_id, producto_nombre,
      cantidad, costo_unitario_compra, subtotal, linea,
      cantidad_bultos, unidades_por_bulto, costo_por_bulto,
      tasa_iva, subtotal_iva, subtotal_total, costo_unitario_ppp
    ) VALUES (
      v_club_id, p_compra_id, v_producto.id, v_producto.nombre,
      v_cant, v_costo_unit_neto, v_subtotal_neto, v_producto.linea,
      v_bultos[v_i], v_und_por_bulto[v_i], v_costos_por_bulto[v_i],
      v_tasas_iva[v_i], v_subtotal_iva, v_subtotal_total, v_costo_unit_ppp
    );

    INSERT INTO movimientos_stock (
      club_id, producto_id, cantidad, fuente,
      venta_id, reserva_consumo_id, compra_id,
      observaciones, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, v_cant, 'compra_manual',
      NULL, NULL, p_compra_id,
      'Recepción de OC #' || p_compra_id::TEXT,
      v_usuario_id
    );

    UPDATE productos SET costo = v_nuevos_costos[v_i] WHERE id = v_producto.id;
  END LOOP;

  -- ── UPDATE cabecera compras: 'recibida' + todos los datos ─────────
  UPDATE compras
  SET estado = 'recibida',
      fecha_recepcion = p_fecha_recepcion,
      gasto_id = v_gasto.id,
      monto_neto = v_monto_neto,
      monto_iva = v_monto_iva,
      monto_total = v_monto_total,
      condicion_fiscal_club = v_condicion_fiscal,
      comprobante_tipo = p_comprobante_tipo,
      comprobante_numero = p_comprobante_numero
  WHERE id = p_compra_id;

  SELECT * INTO v_compra FROM compras WHERE id = p_compra_id;
  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION fn_recibir_oc(BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR) IS
  'Recibe una OC en estado=''pedida''. Permite ajustar items contra la
   factura real (agregar/quitar/modificar productos, costos, IVA por
   item). Snapshotea condicion_fiscal_club, lockea productos ASC, sube
   stock, recalcula PPP según condición fiscal (NETO si RI, TOTAL con
   IVA si monotributo), crea el gasto vía fn_registrar_gasto. Atómica:
   si fn_registrar_gasto falla (caja cerrada + efectivo), ROLLBACK
   total. Pasa estado a ''recibida''. Gate: admin only.';

GRANT EXECUTE ON FUNCTION fn_recibir_oc(BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR)
  TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0041_oc_dos_momentos.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Estructura: columnas nuevas + CHECKs ----------
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'compras'
--   AND column_name IN (
--     'estado','fecha_oc','fecha_recepcion','condicion_pago',
--     'fecha_compromiso_pago','monto_neto_oc','monto_neto','monto_iva',
--     'comprobante_tipo','comprobante_numero','condicion_fiscal_club'
--   )
-- ORDER BY column_name;
-- → 11 filas. fecha_oc nullable=NO. monto_total nullable=YES.
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='compra_items'
--   AND column_name IN ('tasa_iva','subtotal_iva','subtotal_total','costo_unitario_ppp');
-- → 4 filas.
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='clubes' AND column_name='condicion_fiscal';
-- → 1 fila.
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid='compras'::regclass
--   AND conname IN ('compras_estado_gasto_coherencia','compras_condicion_pago_coherencia');
-- → 2 filas. compras_gasto_segun_tipo NO debería estar.

-- ---------- B. Backfill: compra histórica id 3 quedó 'recibida' ----------
-- SELECT id, estado, fecha_oc, fecha_recepcion, monto_neto_oc,
--        monto_neto, monto_iva, monto_total, condicion_fiscal_club
-- FROM compras WHERE id = 3;
-- → estado='recibida'. fecha_recepcion = fecha_oc. monto_neto = monto_total.
--   monto_iva = 0. monto_neto_oc = monto_total. condicion_fiscal_club = NULL.
--
-- SELECT compra_id, producto_nombre, tasa_iva, subtotal_iva,
--        subtotal_total, subtotal, costo_unitario_ppp, costo_unitario_compra
-- FROM compra_items WHERE compra_id = 3;
-- → tasa_iva=0, subtotal_iva=0, subtotal_total=subtotal,
--   costo_unitario_ppp=costo_unitario_compra para cada item.

-- ---------- C. fn_crear_oc path feliz ----------
-- Como admin del club:
--   await window.supabase.rpc('fn_crear_oc', {
--     p_proveedor_id: <id>, p_linea: 'buffet', p_fecha_oc: '2026-05-23',
--     p_items: [{ producto_id: <id>, cantidad_bultos: 2,
--                 unidades_por_bulto: 6, costo_por_bulto: 1500 }],
--     p_condicion_pago: 'al_recibir',
--     p_observaciones: 'TEST OC'
--   });
-- → fila en compras con estado='pedida', fecha_recepcion=NULL, gasto_id=NULL,
--   monto_total=NULL, monto_neto_oc = 3000.
-- → compra_items con tasa_iva=NULL, subtotal=3000, costo_unitario_ppp=NULL.
-- → NO se generaron movimientos_stock, NO se actualizó productos.costo.

-- ---------- D. fn_actualizar_oc cambia items ----------
-- Con la OC anterior:
--   await window.supabase.rpc('fn_actualizar_oc', {
--     p_compra_id: <id>, p_proveedor_id: <mismo>, p_linea: 'buffet',
--     p_fecha_oc: '2026-05-23',
--     p_items: [{ producto_id: <otro>, cantidad_bultos: 1,
--                 unidades_por_bulto: 12, costo_por_bulto: 2400 }],
--     p_condicion_pago: 'a_plazo',
--     p_fecha_compromiso_pago: '2026-06-01'
--   });
-- → compra_items vacía de los anteriores; 1 nuevo con producto distinto.
-- → monto_neto_oc = 2400. condicion_pago='a_plazo'. fecha_compromiso_pago seteada.

-- ---------- E. fn_cancelar_oc rechaza si no está pedida ----------
-- Sobre una OC ya recibida (id 3 del backfill):
--   await window.supabase.rpc('fn_cancelar_oc', { p_compra_id: 3 });
-- → ERROR 'Solo se pueden cancelar OCs en estado "pedida". Esta OC está recibida.'

-- ---------- F. fn_recibir_oc — monotributista (default) ----------
-- Club con condicion_fiscal='monotributista' (default). OC pedida con
-- 1 bulto de 6 cocas a $1200 neto, tasa_iva 21%:
--   await window.supabase.rpc('fn_recibir_oc', {
--     p_compra_id: <id_pedida>,
--     p_fecha_recepcion: '2026-05-23',
--     p_items_recepcion: [{ producto_id: <id_coca>, cantidad_bultos: 1,
--                           unidades_por_bulto: 6, costo_por_bulto: 1200,
--                           tasa_iva: 21 }],
--     p_comprobante_tipo: 'B', p_comprobante_numero: '0001-0001',
--     p_fecha_pago: '2026-05-23', p_medio_pago: 'transferencia'
--   });
-- → compras: estado='recibida', monto_neto=1200, monto_iva=252.00,
--   monto_total=1452.00, condicion_fiscal_club='monotributista'.
-- → compra_items: tasa_iva=21.00, subtotal=1200, subtotal_iva=252.00,
--   subtotal_total=1452.00, costo_unitario_ppp=242.00 (= 1200*1.21/6).
-- → productos.costo del coca = 242.00 (PPP con IVA, monotributista).
-- → gastos con monto=1452.00.

-- ---------- G. fn_recibir_oc — responsable_inscripto ----------
-- Antes: UPDATE clubes SET condicion_fiscal='responsable_inscripto'.
-- Misma OC + recepción que F:
-- → compras: condicion_fiscal_club='responsable_inscripto'. Montos iguales.
-- → compra_items: costo_unitario_ppp=200.00 (= 1200/6 NETO, sin IVA).
-- → productos.costo = 200.00 (PPP solo NETO).
-- → gastos sigue siendo monto=1452.00 (lo que pagás es el total).

-- ---------- H. CHECK compras_estado_gasto_coherencia bloquea inconsistencia ----------
--   UPDATE compras SET gasto_id = 1 WHERE estado='pedida' AND id=<id>;
-- → ERROR 23514 compras_estado_gasto_coherencia.

-- ---------- I. CHECK condicion_pago_coherencia ----------
--   await window.supabase.rpc('fn_crear_oc', {
--     ..., p_condicion_pago: 'a_plazo', p_fecha_compromiso_pago: null
--   });
-- → ERROR 'Si la condición es "a plazo", indicá la fecha de compromiso de pago.'

-- ---------- J. fn_recibir_oc rechaza línea cruzada ----------
-- OC de buffet, intentar recibir con producto de shop:
-- → ERROR 'El producto "X" es de la línea shop, no coincide con la línea de la OC (buffet).'

-- ---------- K. fn_recibir_oc rechaza segundo intento ----------
-- Recibir la OC del paso F dos veces:
-- → 2da llamada: ERROR 'Solo se pueden recibir OCs en estado "pedida". Esta OC está recibida.'

-- ---------- L. fn_cerrar_venta sigue intacta ----------
-- Vender una coca después del paso F: venta_items.costo_unitario debe
-- reflejar productos.costo recién actualizado (242.00 o 200.00 según
-- condición fiscal).

-- ---------- M. Caja cerrada + efectivo → ROLLBACK total ----------
-- Sin caja abierta, intentar fn_recibir_oc con p_medio_pago='efectivo':
-- → ERROR 'No hay caja abierta...' (de fn_registrar_gasto).
-- → ROLLBACK: la OC sigue en 'pedida', sin compra_items modificados,
--   sin movimientos, sin productos.costo cambiado.
-- ============================================================================
