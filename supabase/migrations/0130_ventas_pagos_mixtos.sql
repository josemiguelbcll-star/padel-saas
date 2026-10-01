-- ============================================================================
-- Migration 0130: Soporte para pagos divididos / múltiples medios de pago en ventas (Buffet / Mostrador)
-- ============================================================================
-- 1. Amplía el CHECK de medio_pago en ventas para admitir 'mixto' y 'cuenta_corriente'.
-- 2. Crea la tabla venta_pagos para registrar cada parte del pago con su propio
--    monto, medio_pago, cuenta_id y turno_caja_id.
-- 3. Migra las ventas históricas a venta_pagos.
-- 4. Redefine fn_cerrar_venta para soportar el parámetro p_pagos JSONB.
-- 5. Actualiza fn_cerrar_caja y v_movimientos_cuenta_detalle para consultar venta_pagos.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- 1. Actualizar restricción en ventas.medio_pago y agregar jugador_id si no existe
-- ----------------------------------------------------------------------------
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_medio_pago_check;
ALTER TABLE public.ventas ADD CONSTRAINT ventas_medio_pago_check
  CHECK (medio_pago IN ('efectivo', 'transferencia', 'mp', 'tarjeta', 'otro', 'cuenta_corriente', 'mixto'));

ALTER TABLE public.ventas ADD COLUMN IF NOT EXISTS jugador_id BIGINT REFERENCES jugadores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ventas_jugador_id ON public.ventas(jugador_id);

-- ----------------------------------------------------------------------------
-- 2. Tabla venta_pagos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.venta_pagos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id) ON DELETE CASCADE,
  venta_id BIGINT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  medio_pago VARCHAR(30) NOT NULL CHECK (medio_pago IN ('efectivo', 'transferencia', 'mp', 'tarjeta', 'otro', 'cuenta_corriente')),
  cuenta_id BIGINT REFERENCES cuentas(id) ON DELETE SET NULL,
  turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE SET NULL,
  jugador_id BIGINT REFERENCES jugadores(id) ON DELETE SET NULL,
  usuario_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.venta_pagos ADD COLUMN IF NOT EXISTS jugador_id BIGINT REFERENCES jugadores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_venta_pagos_club_fecha ON public.venta_pagos(club_id, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_venta_pagos_venta_id ON public.venta_pagos(venta_id);
CREATE INDEX IF NOT EXISTS idx_venta_pagos_caja ON public.venta_pagos(turno_caja_id);
CREATE INDEX IF NOT EXISTS idx_venta_pagos_cuenta ON public.venta_pagos(cuenta_id);
CREATE INDEX IF NOT EXISTS idx_venta_pagos_jugador ON public.venta_pagos(jugador_id);

ALTER TABLE public.venta_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "venta_pagos_select" ON public.venta_pagos;
CREATE POLICY "venta_pagos_select"
ON public.venta_pagos FOR SELECT TO authenticated
USING (club_id = current_club_id() OR current_user_is_plataforma_admin());

DROP POLICY IF EXISTS "venta_pagos_insert" ON public.venta_pagos;
CREATE POLICY "venta_pagos_insert"
ON public.venta_pagos FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id() OR current_user_is_plataforma_admin());

GRANT SELECT, INSERT ON public.venta_pagos TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Backfill de ventas existentes hacia venta_pagos
-- ----------------------------------------------------------------------------
INSERT INTO public.venta_pagos (club_id, venta_id, monto, medio_pago, cuenta_id, turno_caja_id, usuario_id, fecha_hora)
SELECT
  v.club_id,
  v.id,
  v.monto_total,
  CASE WHEN v.medio_pago = 'mixto' THEN 'otro' ELSE v.medio_pago END,
  v.cuenta_id,
  v.turno_caja_id,
  v.usuario_id,
  v.fecha_hora
FROM public.ventas v
WHERE NOT EXISTS (
  SELECT 1 FROM public.venta_pagos vp WHERE vp.venta_id = v.id
);

-- ----------------------------------------------------------------------------
-- 4. Redefinir fn_cerrar_venta con soporte para p_pagos (JSONB)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_cerrar_venta(JSONB, VARCHAR, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.fn_cerrar_venta(JSONB, VARCHAR, TEXT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS public.fn_cerrar_venta(JSONB, VARCHAR, TEXT, BIGINT, BIGINT, JSONB);

CREATE OR REPLACE FUNCTION public.fn_cerrar_venta(
  p_items JSONB,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL,
  p_jugador_id BIGINT DEFAULT NULL,
  p_pagos JSONB DEFAULT NULL
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
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
  v_sum_pagos DECIMAL(12,2) := 0;
  v_elem JSONB;
  v_elem_medio VARCHAR(30);
  v_elem_monto DECIMAL(12,2);
  v_elem_cuenta_id BIGINT;
  v_elem_es_caja BOOLEAN;
  v_elem_turno_caja_id BIGINT;
  v_tiene_efectivo BOOLEAN := FALSE;
  v_medios_distintos INT;
  v_header_medio VARCHAR(30);
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta tiene que tener al menos un producto.';
  END IF;

  -- ── Consolidar ítems duplicados por producto_id ────────────────────
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

  -- ── Lock exclusivo de los productos involucrados ───────────────────
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- ── Validar stock y acumular total ─────────────────────────────────
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

  -- ── GESTIÓN DE PAGOS (Mixto o Único) ───────────────────────────────
  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    -- Validación de suma exacta
    SELECT COALESCE(SUM((elem->>'monto')::DECIMAL), 0)
    INTO v_sum_pagos
    FROM jsonb_array_elements(p_pagos) elem;

    IF ABS(v_sum_pagos - v_total) > 0.01 THEN
      RAISE EXCEPTION 'La suma de los pagos ($%) no coincide con el total de la venta ($%).',
        v_sum_pagos, v_total;
    END IF;

    -- Verificar si algún pago involucra efectivo o caja física
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
      v_elem_medio := v_elem->>'medio_pago';
      IF v_elem_medio = 'efectivo' THEN
        v_tiene_efectivo := TRUE;
      END IF;
    END LOOP;

    IF v_tiene_efectivo THEN
      v_turno_caja_id := current_club_caja_abierta();
      IF v_turno_caja_id IS NULL THEN
        RAISE EXCEPTION 'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
      END IF;
    END IF;

    -- Calcular medio del header
    SELECT COUNT(DISTINCT elem->>'medio_pago') INTO v_medios_distintos
    FROM jsonb_array_elements(p_pagos) elem;

    IF v_medios_distintos = 1 THEN
      SELECT elem->>'medio_pago' INTO v_header_medio
      FROM jsonb_array_elements(p_pagos) elem LIMIT 1;
    ELSE
      v_header_medio := 'mixto';
    END IF;

    -- Insertar Cabecera de Venta
    INSERT INTO ventas (
      club_id, monto_total, medio_pago, observaciones, usuario_id,
      turno_caja_id, cuenta_id, jugador_id
    ) VALUES (
      v_club_id, v_total, v_header_medio, p_observaciones, v_usuario_id,
      v_turno_caja_id, p_cuenta_id, p_jugador_id
    )
    RETURNING * INTO v_venta;

    -- Insertar cada pago en venta_pagos
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
      v_elem_medio := v_elem->>'medio_pago';
      v_elem_monto := (v_elem->>'monto')::DECIMAL(12,2);
      v_elem_cuenta_id := NULL;
      v_elem_es_caja := FALSE;
      v_elem_turno_caja_id := NULL;

      IF v_elem_monto <= 0 THEN
        RAISE EXCEPTION 'Cada pago parcial debe ser mayor a 0.';
      END IF;

      -- Resolver cuenta para este pago parcial
      IF (v_elem->>'cuenta_id') IS NOT NULL THEN
        v_elem_cuenta_id := (v_elem->>'cuenta_id')::BIGINT;
        SELECT es_caja_fisica INTO v_elem_es_caja
        FROM cuentas WHERE id = v_elem_cuenta_id AND club_id = v_club_id;
      ELSE
        SELECT mcd.cuenta_id, c.es_caja_fisica
        INTO v_elem_cuenta_id, v_elem_es_caja
        FROM medio_cuenta_default mcd
        JOIN cuentas c ON c.id = mcd.cuenta_id
        WHERE mcd.club_id = v_club_id AND mcd.medio_pago = v_elem_medio;
      END IF;

      IF v_elem_es_caja OR v_elem_medio = 'efectivo' THEN
        v_elem_turno_caja_id := v_turno_caja_id;
      END IF;

      INSERT INTO venta_pagos (
        club_id, venta_id, monto, medio_pago, cuenta_id, turno_caja_id, usuario_id, jugador_id
      ) VALUES (
        v_club_id, v_venta.id, v_elem_monto, v_elem_medio, v_elem_cuenta_id, v_elem_turno_caja_id, v_usuario_id,
        COALESCE((v_elem->>'jugador_id')::BIGINT, p_jugador_id)
      );
    END LOOP;

  ELSE
    -- PAGO ÚNICO (Flujo estándar)
    IF p_medio_pago IS NULL THEN
      RAISE EXCEPTION 'El medio de pago es obligatorio.';
    END IF;

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

    IF v_es_caja OR p_medio_pago = 'efectivo' THEN
      v_turno_caja_id := current_club_caja_abierta();
      IF v_turno_caja_id IS NULL THEN
        RAISE EXCEPTION
          'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
      END IF;
    END IF;

    INSERT INTO ventas (
      club_id, monto_total, medio_pago, observaciones, usuario_id,
      turno_caja_id, cuenta_id, jugador_id
    ) VALUES (
      v_club_id, v_total, p_medio_pago, p_observaciones, v_usuario_id,
      v_turno_caja_id, v_cuenta_id, p_jugador_id
    )
    RETURNING * INTO v_venta;

    -- Insertar el registro correspondiente en venta_pagos
    INSERT INTO venta_pagos (
      club_id, venta_id, monto, medio_pago, cuenta_id, turno_caja_id, usuario_id, jugador_id
    ) VALUES (
      v_club_id, v_venta.id, v_total, p_medio_pago, v_cuenta_id, v_turno_caja_id, v_usuario_id, p_jugador_id
    );
  END IF;

  -- ── Items de venta y movimientos de stock ──────────────────────────
  FOR v_i IN 1..array_length(v_pids, 1) LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    INSERT INTO venta_items (
      club_id, venta_id, producto_id, producto_nombre,
      cantidad, precio_unitario, costo_unitario, subtotal,
      linea
    ) VALUES (
      v_club_id, v_venta.id, v_producto.id, v_producto.nombre,
      v_cants[v_i], v_producto.precio, v_producto.costo,
      v_producto.precio * v_cants[v_i],
      v_producto.linea
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

GRANT EXECUTE ON FUNCTION public.fn_cerrar_venta(JSONB, VARCHAR, TEXT, BIGINT, BIGINT, JSONB) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Redefinir fn_cerrar_caja sumando efectivo desde venta_pagos
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_cerrar_caja(BIGINT, DECIMAL, TEXT);

CREATE OR REPLACE FUNCTION public.fn_cerrar_caja(
  p_turno_caja_id BIGINT,
  p_efectivo_contado DECIMAL,
  p_observaciones TEXT DEFAULT NULL
)
RETURNS turnos_caja
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_turno turnos_caja;
  v_entradas_cobros DECIMAL(12,2);
  v_movimientos_neto DECIMAL(12,2);
  v_otros_ingresos_efectivo DECIMAL(12,2);
  v_gastos_efectivo DECIMAL(12,2);
  v_cuotas_efectivo DECIMAL(12,2);
  v_transferencias_neto DECIMAL(12,2);
  v_esperado DECIMAL(12,2);
BEGIN
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para cerrar la caja.';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 THEN
    RAISE EXCEPTION 'El efectivo contado es obligatorio y no puede ser negativo.';
  END IF;

  v_club_id := current_club_id();

  SELECT * INTO v_turno
  FROM turnos_caja
  WHERE id = p_turno_caja_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada.';
  END IF;
  IF v_turno.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta caja ya está cerrada.';
  END IF;

  -- ── Entradas de cobros que entran al cajón (es_caja_fisica) ──────
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'reembolso' THEN -monto ELSE monto END
  ), 0)
  INTO v_entradas_cobros
  FROM (
    SELECT monto, tipo
      FROM reserva_pagos
      WHERE turno_caja_id = p_turno_caja_id
        AND cuenta_id IN (SELECT id FROM cuentas
                          WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    UNION ALL
    SELECT vp.monto, 'pago' AS tipo
      FROM venta_pagos vp
      WHERE vp.turno_caja_id = p_turno_caja_id
        AND vp.cuenta_id IN (SELECT id FROM cuentas
                             WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    UNION ALL
    SELECT monto, 'pago' AS tipo
      FROM clase_cobros
      WHERE turno_caja_id = p_turno_caja_id
        AND cuenta_id IN (SELECT id FROM cuentas
                          WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
  ) entradas;

  -- ── Movimientos manuales (neto) ──────────────────────────────────
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'ajuste_positivo' THEN monto ELSE -monto END
  ), 0)
  INTO v_movimientos_neto
  FROM caja_movimientos_manuales
  WHERE turno_caja_id = p_turno_caja_id;

  -- ── Otros ingresos al cajón (SUMAN) ──────────────────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_otros_ingresos_efectivo
  FROM otros_ingresos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Gastos pagados directo del cajón (RESTAN) ────────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_gastos_efectivo
  FROM gastos
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE)
    AND activo = TRUE;

  -- ── Cuotas de gastos pagadas del cajón (RESTAN) ──────────────────
  SELECT COALESCE(SUM(monto), 0)
  INTO v_cuotas_efectivo
  FROM gasto_cuotas
  WHERE turno_caja_id = p_turno_caja_id
    AND cuenta_id IN (SELECT id FROM cuentas
                      WHERE club_id = v_club_id AND es_caja_fisica = TRUE);

  -- ── Transferencias que mueven efectivo del cajón ──────────────────
  SELECT COALESCE(SUM(
    (CASE WHEN cuenta_destino_id IN (SELECT id FROM cuentas
          WHERE club_id = v_club_id AND es_caja_fisica = TRUE) THEN monto ELSE 0 END)
    -
    (CASE WHEN cuenta_origen_id  IN (SELECT id FROM cuentas
          WHERE club_id = v_club_id AND es_caja_fisica = TRUE) THEN monto ELSE 0 END)
  ), 0)
  INTO v_transferencias_neto
  FROM transferencias
  WHERE turno_caja_id = p_turno_caja_id;

  v_esperado := v_turno.monto_apertura
              + v_entradas_cobros
              + v_movimientos_neto
              + v_otros_ingresos_efectivo
              - v_gastos_efectivo
              - v_cuotas_efectivo
              + v_transferencias_neto;

  UPDATE turnos_caja
  SET cerrada_en = NOW(),
      usuario_cierre = auth.uid(),
      efectivo_esperado = v_esperado,
      efectivo_contado = p_efectivo_contado,
      diferencia = p_efectivo_contado - v_esperado,
      observaciones_cierre = p_observaciones
  WHERE id = p_turno_caja_id
  RETURNING * INTO v_turno;

  RETURN v_turno;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cerrar_caja(BIGINT, DECIMAL, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Actualizar vista v_movimientos_cuenta_detalle para auditar venta_pagos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_movimientos_cuenta_detalle
WITH (security_invoker = true) AS

  -- 1. Cobros de reservas
  SELECT
    ('reserva_pago_' || rp.id)::text AS id,
    rp.club_id,
    rp.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    rp.fecha_hora AS fecha_hora,
    'reserva_pago'::text AS origen,
    CASE 
      WHEN rp.tipo = 'reembolso' THEN 'Reembolso Turno'
      WHEN rp.tipo = 'sena' THEN 'Seña Turno'
      ELSE 'Cobro Turno'
    END::text AS concepto,
    COALESCE(rp.observaciones, 'Pago de turno')::text AS detalle,
    (CASE WHEN rp.tipo = 'reembolso' THEN -1 ELSE 1 END)::smallint AS signo,
    rp.monto::numeric(12,2) AS monto,
    rp.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM reserva_pagos rp
  JOIN cuentas c ON c.id = rp.cuenta_id
  LEFT JOIN usuarios u ON u.id = rp.usuario_id
  WHERE rp.cuenta_id IS NOT NULL

  UNION ALL

  -- 2. Cobros de clases
  SELECT
    ('clase_cobro_' || cc.id)::text AS id,
    cc.club_id,
    cc.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    cc.fecha_hora AS fecha_hora,
    'clase_cobro'::text AS origen,
    'Cobro Clase'::text AS concepto,
    COALESCE(cc.observaciones, 'Cobro de clase')::text AS detalle,
    1::smallint AS signo,
    cc.monto::numeric(12,2) AS monto,
    cc.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM clase_cobros cc
  JOIN cuentas c ON c.id = cc.cuenta_id
  LEFT JOIN usuarios u ON u.id = cc.usuario_id
  WHERE cc.cuenta_id IS NOT NULL

  UNION ALL

  -- 3. Ventas de buffet / mostrador (por cada pago en venta_pagos)
  SELECT
    ('venta_pago_' || vp.id)::text AS id,
    vp.club_id,
    vp.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    vp.fecha_hora AS fecha_hora,
    'venta'::text AS origen,
    'Venta Buffet'::text AS concepto,
    COALESCE(v.observaciones, 'Venta #' || v.id || ' (' || vp.medio_pago || ')')::text AS detalle,
    1::smallint AS signo,
    vp.monto::numeric(12,2) AS monto,
    vp.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM venta_pagos vp
  JOIN ventas v ON v.id = vp.venta_id
  JOIN cuentas c ON c.id = vp.cuenta_id
  LEFT JOIN usuarios u ON u.id = vp.usuario_id
  WHERE vp.cuenta_id IS NOT NULL

  UNION ALL

  -- 4. Gastos directos pagados
  SELECT
    ('gasto_' || g.id)::text AS id,
    g.club_id,
    g.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    COALESCE(g.fecha_pago::timestamptz, g.fecha_gasto::timestamptz, g.fecha_alta) AS fecha_hora,
    'gasto'::text AS origen,
    COALESCE(g.categoria_nombre, 'Gasto')::text AS concepto,
    COALESCE(g.observaciones, g.proveedor, 'Gasto')::text AS detalle,
    (-1)::smallint AS signo,
    g.monto::numeric(12,2) AS monto,
    g.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM gastos g
  JOIN cuentas c ON c.id = g.cuenta_id
  LEFT JOIN usuarios u ON u.id = g.usuario_id
  WHERE g.cuenta_id IS NOT NULL
    AND g.activo = TRUE

  UNION ALL

  -- 5. Otros ingresos cobrados
  SELECT
    ('otro_ingreso_' || oi.id)::text AS id,
    oi.club_id,
    oi.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    COALESCE(oi.fecha_cobro::timestamptz, oi.fecha::timestamptz, oi.fecha_alta) AS fecha_hora,
    'otro_ingreso'::text AS origen,
    COALESCE(oi.concepto, 'Otro Ingreso')::text AS concepto,
    oi.observaciones::text AS detalle,
    1::smallint AS signo,
    oi.monto::numeric(12,2) AS monto,
    oi.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM otros_ingresos oi
  JOIN cuentas c ON c.id = oi.cuenta_id
  LEFT JOIN usuarios u ON u.id = oi.usuario_id
  WHERE oi.cuenta_id IS NOT NULL
    AND oi.activo = TRUE

  UNION ALL

  -- 6. Cuotas de gastos pagadas
  SELECT
    ('gasto_cuota_' || gc.id)::text AS id,
    gc.club_id,
    gc.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    COALESCE(gc.fecha_pago::timestamptz, gc.fecha_alta) AS fecha_hora,
    'gasto_cuota'::text AS origen,
    ('Pago Cuota Gasto #' || gc.gasto_id)::text AS concepto,
    ('Cuota ' || gc.numero)::text AS detalle,
    (-1)::smallint AS signo,
    gc.monto::numeric(12,2) AS monto,
    gc.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM gasto_cuotas gc
  JOIN cuentas c ON c.id = gc.cuenta_id
  LEFT JOIN usuarios u ON u.id = gc.usuario_id
  WHERE gc.cuenta_id IS NOT NULL
    AND gc.fecha_pago IS NOT NULL

  UNION ALL

  -- 7. Movimientos manuales de caja (efectivo)
  SELECT
    ('caja_manual_' || cm.id)::text AS id,
    cm.club_id,
    mcd.cuenta_id,
    c.nombre AS cuenta_nombre,
    c.tipo AS tipo_cuenta,
    cm.fecha_hora AS fecha_hora,
    'caja_manual'::text AS origen,
    CASE 
      WHEN cm.tipo = 'ajuste_positivo' THEN 'Ingreso Manual Caja'
      ELSE 'Retiro Manual Caja'
    END::text AS concepto,
    COALESCE(cm.observaciones, cm.concepto, 'Movimiento manual')::text AS detalle,
    (CASE WHEN cm.tipo = 'ajuste_positivo' THEN 1 ELSE -1 END)::smallint AS signo,
    cm.monto::numeric(12,2) AS monto,
    cm.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text AS usuario_nombre,
    u.rol AS usuario_rol
  FROM caja_movimientos_manuales cm
  LEFT JOIN medio_cuenta_default mcd ON mcd.club_id = cm.club_id AND mcd.medio_pago = 'efectivo'
  LEFT JOIN cuentas c ON c.id = mcd.cuenta_id
  LEFT JOIN usuarios u ON u.id = cm.usuario_id
  WHERE mcd.cuenta_id IS NOT NULL;

GRANT SELECT ON public.v_movimientos_cuenta_detalle TO authenticated;

COMMIT;
