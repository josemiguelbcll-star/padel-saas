-- ============================================================================
-- 0063_fix_recibir_oc_cuotas_total_iva.sql
-- FIX: en fn_recibir_oc las cuotas de CxP se generaban sobre el NETO (monto del
-- gasto), cuando deben ir sobre el TOTAL CON IVA (la plata real que sale al
-- proveedor). Decisión: IVA PRORRATEADO en las cuotas (las cuotas reparten el
-- total neto+IVA).
--
-- =====================================================================
-- EL BUG
-- =====================================================================
-- Para un club Responsable Inscripto, v_monto_gasto = NETO (correcto para el
-- gasto madre: el IVA es crédito fiscal, no es costo del período). Pero el plan
-- de cuotas usaba v_monto_gasto → las cuotas quedaban por el NETO. La deuda real
-- al proveedor es el TOTAL (neto + IVA).
-- Ejemplo: compra 12 — neto 180.000, IVA 37.800, total 217.800, 1 cuota →
-- la cuota salió 180.000; debió ser 217.800.
--
-- =====================================================================
-- EL FIX (2 líneas, quirúrgico)
-- =====================================================================
-- CREATE OR REPLACE de fn_recibir_oc (misma firma → sin DROP). Cuerpo IDÉNTICO
-- a 0058 salvo DOS cambios, ambos v_monto_gasto → v_monto_total SOLO en el
-- contexto de cuotas:
--   1. Validación del anticipo: contra v_monto_total (antes v_monto_gasto).
--   2. v_monto_resto := v_monto_total - p_anticipo (antes v_monto_gasto).
--
-- NO se toca:
--   - El gasto madre (p_monto := v_monto_gasto) → neto (RI) / total (mono).
--     EERR intacto, IVA crédito fiscal.
--   - El reparto (v_cuota_base + última absorbe residuo) ni la cuota anticipo:
--     operan sobre v_monto_resto, que ahora ya es el total.
--   - Stock, PPP, IVA discriminado, lock de productos, atomicidad: idénticos.
--   - Monotributista: sin cambio real (ahí v_monto_gasto = v_monto_total).
--
-- Resultado: SUM(cuotas) = anticipo + (total − anticipo) = TOTAL exacto; la
-- última cuota absorbe el residuo de redondeo (ni un peso perdido).
--
-- =====================================================================
-- INVARIANTE QUE CAMBIA (a propósito)
-- =====================================================================
-- Antes: SUM(cuotas) = gastos.monto. Ahora, para RI: SUM(cuotas) = total ≠
-- gastos.monto = neto. Es correcto: las cuotas (CxP) = lo que se le debe/paga al
-- proveedor (con IVA, percibido); el gasto (EERR) = costo neto (devengado). No
-- hay CHECK/trigger que enforce ese invariante (era solo un comentario en 0045);
-- el estado de la deuda en CxP se deriva de las CUOTAS, así que queda coherente.
-- NO afecta fn_registrar_gasto (su cuota automática de gastos manuales sigue =
-- gastos.monto; ahí no hay desglose de IVA).
--
-- =====================================================================
-- DATOS HISTÓRICOS
-- =====================================================================
-- Esta migración corrige las recepciones DE ACÁ EN ADELANTE. Las cuotas ya mal
-- generadas (ej. compra 12) NO se tocan acá — corrección de datos puntual aparte.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_recibir_oc(
  p_compra_id BIGINT,
  p_fecha_recepcion DATE,
  p_items_recepcion JSONB,
  p_comprobante_tipo VARCHAR DEFAULT NULL,
  p_comprobante_numero VARCHAR DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_anticipo DECIMAL DEFAULT 0,
  p_cantidad_cuotas INT DEFAULT 1,
  p_fechas_vencimiento DATE[] DEFAULT NULL,
  p_cuenta_id BIGINT DEFAULT NULL
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
  v_monto_gasto DECIMAL(12,2);
  v_obs_gasto TEXT;
  v_monto_resto DECIMAL(12,2);
  v_cuota_base DECIMAL(12,2);
  v_cuota_actual DECIMAL(12,2);
  v_pagar_anticipo BOOLEAN := FALSE;
  v_pagar_unica BOOLEAN := FALSE;
  v_turno_caja_efectivo BIGINT := NULL;
  v_cuota_fecha_pago DATE;
  v_cuota_medio_pago VARCHAR;
  v_cuota_turno_caja BIGINT;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
  v_cuota_cuenta_id BIGINT;
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

  -- ── Validaciones del plan de cuotas (0045). ───────────────────────
  IF p_anticipo IS NULL OR p_anticipo < 0 THEN
    RAISE EXCEPTION 'El anticipo no puede ser negativo (recibido: %).', p_anticipo;
  END IF;
  IF p_cantidad_cuotas IS NULL OR p_cantidad_cuotas < 1 THEN
    RAISE EXCEPTION 'La cantidad de cuotas debe ser >= 1 (recibido: %).', p_cantidad_cuotas;
  END IF;
  IF p_fechas_vencimiento IS NULL
     OR COALESCE(array_length(p_fechas_vencimiento, 1), 0) <> p_cantidad_cuotas THEN
    RAISE EXCEPTION
      'Necesitás exactamente % fecha(s) de vencimiento, una por cuota. Recibido: %.',
      p_cantidad_cuotas,
      COALESCE(array_length(p_fechas_vencimiento, 1), 0);
  END IF;
  FOR v_i IN 1..p_cantidad_cuotas - 1 LOOP
    IF p_fechas_vencimiento[v_i] >= p_fechas_vencimiento[v_i + 1] THEN
      RAISE EXCEPTION
        'Las fechas de vencimiento deben estar en orden ascendente. Fecha % (%) no es anterior a fecha % (%).',
        v_i, p_fechas_vencimiento[v_i],
        v_i + 1, p_fechas_vencimiento[v_i + 1];
    END IF;
  END LOOP;

  -- ── Snapshot de la condición fiscal del club ──────────────────────
  SELECT condicion_fiscal INTO v_condicion_fiscal FROM clubes WHERE id = v_club_id;
  IF v_condicion_fiscal IS NULL THEN
    RAISE EXCEPTION 'El club no tiene configurada la condición fiscal. Andá a Configuración → Marca.';
  END IF;

  -- ── Proveedor ─────────────────────────────────────────────────────
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

    v_monto_neto := v_monto_neto + v_subtotal_neto;
    v_monto_iva := v_monto_iva + v_subtotal_iva;
    v_monto_total := v_monto_total + v_subtotal_total;
  END LOOP;

  -- ── Monto del GASTO según condición fiscal (0043) ──────────────────
  -- ⚠ NO CAMBIA: el gasto madre va por NETO (RI) / TOTAL (mono). EERR.
  IF v_condicion_fiscal = 'responsable_inscripto' THEN
    v_monto_gasto := v_monto_neto;
  ELSE
    v_monto_gasto := v_monto_total;
  END IF;

  -- ── Validación anticipo contra el TOTAL con IVA ───────────────────
  -- ⭐ FIX 0063: el anticipo se valida contra v_monto_total (la deuda real al
  -- proveedor), NO contra v_monto_gasto (= neto en RI). El anticipo es parte
  -- del total prorrateado.
  IF p_anticipo >= v_monto_total THEN
    RAISE EXCEPTION
      'El anticipo (%) no puede ser igual ni mayor al total de la compra con IVA (%). Para pagar todo al instante usá 1 sola cuota sin anticipo.',
      p_anticipo, v_monto_total;
  END IF;

  -- ── Resolver qué cuota se paga al recibir (0045) ──────────────────
  IF p_fecha_pago IS NOT NULL THEN
    IF p_anticipo > 0 THEN
      v_pagar_anticipo := TRUE;
    ELSIF p_cantidad_cuotas = 1 THEN
      v_pagar_unica := TRUE;
    ELSE
      RAISE EXCEPTION
        'No se puede pagar al recibir en un plan multi-cuota sin anticipo. Indicá un anticipo > 0 o reducí a una sola cuota.';
    END IF;

    -- Resolver cuenta del pago al recibir + regla de oro generalizada (0058).
    IF p_cuenta_id IS NOT NULL THEN
      SELECT es_caja_fisica INTO v_es_caja
      FROM cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
      v_cuenta_id := p_cuenta_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_cuenta_id, v_es_caja
      FROM medio_cuenta_default mcd
      JOIN cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
    END IF;
    v_es_caja := COALESCE(v_es_caja, FALSE);

    IF v_es_caja THEN
      v_turno_caja_efectivo := current_club_caja_abierta();
      IF v_turno_caja_efectivo IS NULL THEN
        RAISE EXCEPTION
          'No hay caja abierta. Pedile a la administración que abra la caja del día antes de pagar en efectivo.';
      END IF;
    END IF;
  END IF;

  -- ── DELETE compra_items vigentes ──────────────────────────────────
  DELETE FROM compra_items WHERE compra_id = p_compra_id;

  -- ── Crear el gasto (SIEMPRE pendiente — el pago va por cuotas). ────
  -- ⚠ NO CAMBIA: p_monto := v_monto_gasto (neto RI / total mono).
  v_obs_gasto := 'Compra a ' || v_proveedor.nombre || ' del ' || p_fecha_recepcion::TEXT;
  IF p_comprobante_tipo IS NOT NULL OR p_comprobante_numero IS NOT NULL THEN
    v_obs_gasto := v_obs_gasto || ' ('
      || COALESCE(p_comprobante_tipo, '') || ' '
      || COALESCE(p_comprobante_numero, '') || ')';
  END IF;

  SELECT * INTO v_gasto FROM fn_registrar_gasto(
    p_categoria_id := v_categoria.id,
    p_monto := v_monto_gasto,
    p_fecha_gasto := p_fecha_recepcion,
    p_proveedor := NULL,
    p_observaciones := v_obs_gasto,
    p_fecha_pago := NULL,
    p_medio_pago := NULL,
    p_proveedor_id := v_proveedor.id,
    p_fecha_vencimiento := NULL,
    p_skip_cuota_automatica := TRUE
  );

  -- ── Generar el plan de cuotas. ────────────────────────────────────
  -- ⭐ FIX 0063: las cuotas reparten sobre el TOTAL con IVA (deuda real al
  -- proveedor), NO sobre v_monto_gasto (= neto en RI). SUM(cuotas) = anticipo
  -- + (total − anticipo) = total exacto; la última absorbe el residuo.
  v_monto_resto := v_monto_total - p_anticipo;

  -- Cuota 0 — anticipo (si > 0).
  IF p_anticipo > 0 THEN
    IF v_pagar_anticipo THEN
      v_cuota_fecha_pago := p_fecha_pago;
      v_cuota_medio_pago := p_medio_pago;
      v_cuota_turno_caja := v_turno_caja_efectivo;
      v_cuota_cuenta_id  := v_cuenta_id;
    ELSE
      v_cuota_fecha_pago := NULL;
      v_cuota_medio_pago := NULL;
      v_cuota_turno_caja := NULL;
      v_cuota_cuenta_id  := NULL;
    END IF;

    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id, cuenta_id
    ) VALUES (
      v_club_id, v_gasto.id, 0, TRUE, p_anticipo,
      p_fecha_recepcion, v_cuota_fecha_pago, v_cuota_medio_pago, v_cuota_turno_caja,
      v_usuario_id, v_cuota_cuenta_id
    );
  END IF;

  -- Cuotas 1..N regulares (última absorbe el residuo).
  v_cuota_base := ROUND(v_monto_resto / p_cantidad_cuotas::DECIMAL, 2);
  FOR v_i IN 1..p_cantidad_cuotas LOOP
    IF v_i = p_cantidad_cuotas THEN
      v_cuota_actual := v_monto_resto - (v_cuota_base * (p_cantidad_cuotas - 1));
    ELSE
      v_cuota_actual := v_cuota_base;
    END IF;

    IF v_pagar_unica AND v_i = 1 THEN
      v_cuota_fecha_pago := p_fecha_pago;
      v_cuota_medio_pago := p_medio_pago;
      v_cuota_turno_caja := v_turno_caja_efectivo;
      v_cuota_cuenta_id  := v_cuenta_id;
    ELSE
      v_cuota_fecha_pago := NULL;
      v_cuota_medio_pago := NULL;
      v_cuota_turno_caja := NULL;
      v_cuota_cuenta_id  := NULL;
    END IF;

    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id, cuenta_id
    ) VALUES (
      v_club_id, v_gasto.id, v_i, FALSE, v_cuota_actual,
      p_fechas_vencimiento[v_i], v_cuota_fecha_pago, v_cuota_medio_pago, v_cuota_turno_caja,
      v_usuario_id, v_cuota_cuenta_id
    );
  END LOOP;

  -- ── INSERT compra_items + movimientos + UPDATE productos.costo. ───
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

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

  -- ── UPDATE cabecera compras: 'recibida' + datos. ──────────────────
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

COMMENT ON FUNCTION fn_recibir_oc(
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR, DECIMAL, INT, DATE[], BIGINT
) IS
  'Recibe una OC (estado=pedida): gasto SIEMPRE pendiente, PPP/IVA según fiscal,
   stock, plan de cuotas, atomicidad. 0058: +p_cuenta_id (regla de oro
   generalizada). 0063: las CUOTAS se generan sobre el TOTAL CON IVA (deuda real
   al proveedor; anticipo validado contra el total); el gasto madre sigue en NETO
   (RI) / TOTAL (mono) → EERR intacto. SUM(cuotas) = total exacto. Gate: admin.';

GRANT EXECUTE ON FUNCTION fn_recibir_oc(
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR, DECIMAL, INT, DATE[], BIGINT
) TO authenticated;

COMMIT;

-- ============================================================================
-- Fin de la migración 0063_fix_recibir_oc_cuotas_total_iva.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIÓN — CORRER MANUALMENTE (sobre una compra RECIBIDA con 0063 aplicada)
-- ============================================================================
-- Para una compra nueva recibida a plazo (RI): SUM(cuotas) == monto_total (con
-- IVA) y gasto madre == monto_neto. Ver query en el mensaje.
-- ============================================================================
