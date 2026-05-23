-- ============================================================================
-- 0043_fn_recibir_oc_gasto_neto_ri.sql
-- Corrección de control de gestión en fn_recibir_oc (0041): el monto
-- del gasto contable debe respetar la condición fiscal del club, no
-- usar siempre el TOTAL con IVA.
--
-- =====================================================================
-- PROBLEMA EN 0041
-- =====================================================================
-- La 0041 pasa `v_monto_total` (= NETO + IVA) a fn_registrar_gasto
-- siempre. Para un responsable inscripto eso es contablemente
-- incorrecto: el IVA NO es resultado del EERR — es crédito fiscal que
-- se compensa con el IVA débito de ventas (saldo a favor / a pagar es
-- flujo de caja, no resultado).
--
-- =====================================================================
-- CORRECCIÓN
-- =====================================================================
-- El monto al gasto pasa a depender de la condición fiscal:
--   - responsable_inscripto: monto_gasto = monto_neto
--   - monotributista:        monto_gasto = monto_total (no recupera IVA)
--
-- compras.monto_neto / monto_iva / monto_total SE SIGUEN GUARDANDO
-- discriminados (sin cambio). El desglose del IVA queda disponible
-- para el flujo de caja y reportes fiscales futuros — lo único que
-- cambia es el monto que llega al gasto contable.
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- Único cambio: CREATE OR REPLACE fn_recibir_oc con el cuerpo de 0041
-- + 3 ajustes mínimos:
--   1. Sumar `v_monto_gasto DECIMAL(12,2);` al DECLARE.
--   2. Resolver v_monto_gasto según condición fiscal antes de armar
--      la observación del gasto.
--   3. Pasar v_monto_gasto (en lugar de v_monto_total) a
--      fn_registrar_gasto.
--
-- NO toca: schema (compras / compra_items / clubes / movimientos_stock),
-- las otras 3 RPCs de OC (crear / actualizar / cancelar), GRANTs, RLS.
--
-- Signature SQL de fn_recibir_oc no cambia → CREATE OR REPLACE limpio,
-- sin DROP.
-- ============================================================================

BEGIN;

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
  v_monto_gasto DECIMAL(12,2);            -- ⭐ NUEVO 0043
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

  -- ── Monto del GASTO según condición fiscal (0043) ──────────────────
  -- El IVA es flujo de caja, no resultado contable:
  --   responsable_inscripto: gasto = NETO (el IVA es crédito fiscal,
  --     se recupera contra IVA débito de ventas — no es gasto del EERR).
  --   monotributista:        gasto = TOTAL con IVA (no recupera IVA,
  --     todo es costo real al EERR).
  -- compras.monto_neto / monto_iva / monto_total se siguen guardando
  -- TODOS discriminados — el desglose IVA queda disponible para el
  -- flujo de caja y reportes fiscales futuros.
  IF v_condicion_fiscal = 'responsable_inscripto' THEN
    v_monto_gasto := v_monto_neto;
  ELSE
    v_monto_gasto := v_monto_total;
  END IF;

  -- ── Crear el gasto (monto según condición fiscal — ver bloque arriba) ─
  v_obs_gasto := 'Compra a ' || v_proveedor.nombre || ' del ' || p_fecha_recepcion::TEXT;
  IF p_comprobante_tipo IS NOT NULL OR p_comprobante_numero IS NOT NULL THEN
    v_obs_gasto := v_obs_gasto || ' ('
      || COALESCE(p_comprobante_tipo, '') || ' '
      || COALESCE(p_comprobante_numero, '') || ')';
  END IF;

  SELECT * INTO v_gasto FROM fn_registrar_gasto(
    p_categoria_id := v_categoria.id,
    p_monto := v_monto_gasto,             -- ⭐ ANTES 0041: v_monto_total
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
   IVA si monotributo), crea el gasto vía fn_registrar_gasto. Desde
   0043: el monto del gasto contable respeta la condición fiscal
   (responsable_inscripto = monto_neto, monotributista = monto_total)
   — el IVA del responsable inscripto es crédito fiscal, no resultado
   del EERR. compras.monto_neto / monto_iva / monto_total se siguen
   guardando discriminados. Atómica: si fn_registrar_gasto falla (caja
   cerrada + efectivo), ROLLBACK total. Pasa estado a ''recibida''.
   Gate: admin only.';

COMMIT;

-- ============================================================================
-- Fin de la migración 0043_fn_recibir_oc_gasto_neto_ri.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. fn_recibir_oc sigue existiendo con misma signature ----------
-- SELECT pg_get_function_identity_arguments(oid)
-- FROM pg_proc WHERE proname = 'fn_recibir_oc';
-- → 'p_compra_id bigint, p_fecha_recepcion date, p_items_recepcion jsonb,
--    p_comprobante_tipo character varying, p_comprobante_numero character varying,
--    p_fecha_pago date, p_medio_pago character varying'

-- ---------- B. Recepción con monotributo: gasto = monto_total (sin cambios) ----------
-- UPDATE clubes SET condicion_fiscal = 'monotributista' WHERE id = <id>;
-- Crear OC con 1 bulto×6 cocas a $1200 NETO, recibir con tasa_iva=21:
-- → compras: monto_neto=1200.00, monto_iva=252.00, monto_total=1452.00.
-- → gastos.monto = 1452.00 (monto_total — incluye IVA, idéntico a 0041).
-- → productos.costo = 242.00 (PPP con IVA — idéntico a 0041).

-- ---------- C. Recepción con responsable inscripto: gasto = monto_neto (NUEVO) ----------
-- UPDATE clubes SET condicion_fiscal = 'responsable_inscripto' WHERE id = <id>;
-- Misma OC + recepción:
-- → compras: monto_neto=1200.00, monto_iva=252.00, monto_total=1452.00.
--   (los 3 montos se siguen guardando — sin cambio).
-- → gastos.monto = 1200.00 ← ⭐ NUEVO en 0043 (antes era 1452.00).
-- → productos.costo = 200.00 (PPP solo NETO — idéntico a 0041).

-- ---------- D. EERR refleja correctamente ----------
-- Antes 0043 (RI): gasto cargado por $1452 (incluía IVA falsamente como costo).
-- Después 0043 (RI): gasto cargado por $1200 (NETO real). El IVA de $252
-- queda en compras.monto_iva, disponible para el reporte de flujo de caja
-- y para el saldo técnico de IVA débito vs crédito (cuando se construya).

-- ---------- E. fn_cerrar_venta sigue intacta ----------
-- Vender un producto: venta_items.costo_unitario debe reflejar
-- productos.costo (el PPP no se vio afectado por el cambio del gasto).

-- ---------- F. Caja cerrada + efectivo sigue rechazando ----------
-- Sin caja abierta, recibir con p_medio_pago='efectivo':
-- → ERROR de fn_registrar_gasto: 'No hay caja abierta...'.
-- → ROLLBACK total. La OC sigue en 'pedida'.
-- ============================================================================
