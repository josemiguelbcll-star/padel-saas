BEGIN;

-- A canceled or corrected sale remains in the historical record.
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE public.venta_pagos_reversiones (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id),
  venta_id BIGINT NOT NULL REFERENCES public.ventas(id) ON DELETE RESTRICT,
  venta_pago_id BIGINT NOT NULL REFERENCES public.venta_pagos(id) ON DELETE RESTRICT,
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  medio_pago VARCHAR(30) NOT NULL,
  cuenta_id BIGINT REFERENCES public.cuentas(id) ON DELETE RESTRICT,
  usuario_id UUID NOT NULL REFERENCES auth.users(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_venta_pagos_reversiones_club_fecha
  ON public.venta_pagos_reversiones(club_id, fecha_hora);
CREATE INDEX idx_venta_pagos_reversiones_venta
  ON public.venta_pagos_reversiones(venta_id);

ALTER TABLE public.venta_pagos_reversiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY venta_pagos_reversiones_select ON public.venta_pagos_reversiones
  FOR SELECT TO authenticated
  USING (club_id = public.current_club_id() OR public.current_user_is_plataforma_admin());
GRANT SELECT ON public.venta_pagos_reversiones TO authenticated;

CREATE TABLE public.ventas_correcciones (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id),
  venta_id BIGINT NOT NULL REFERENCES public.ventas(id) ON DELETE RESTRICT,
  venta_reemplazo_id BIGINT REFERENCES public.ventas(id) ON DELETE RESTRICT,
  motivo TEXT NOT NULL,
  snapshot_venta JSONB NOT NULL,
  usuario_id UUID NOT NULL REFERENCES auth.users(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ventas_correcciones_club_fecha
  ON public.ventas_correcciones(club_id, fecha_hora);

ALTER TABLE public.ventas_correcciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY ventas_correcciones_select ON public.ventas_correcciones
  FOR SELECT TO authenticated
  USING (club_id = public.current_club_id() OR public.current_user_is_plataforma_admin());
GRANT SELECT ON public.ventas_correcciones TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_proteger_estado_venta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.activa IS DISTINCT FROM NEW.activa THEN
    IF NOT OLD.activa OR NEW.activa OR NOT EXISTS (
      SELECT 1
      FROM public.ventas_correcciones vc
      WHERE vc.venta_id = OLD.id
        AND vc.club_id = OLD.club_id
        AND vc.fecha_hora = transaction_timestamp()
    ) THEN
      RAISE EXCEPTION 'El estado de una venta solo puede cambiarse mediante la RPC de anulación.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ventas_proteger_estado
  BEFORE UPDATE OF activa ON public.ventas
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_proteger_estado_venta();

ALTER TABLE public.movimientos_stock
  DROP CONSTRAINT IF EXISTS mov_stock_fuente_enum;
ALTER TABLE public.movimientos_stock
  ADD CONSTRAINT mov_stock_fuente_enum CHECK (
    fuente IN (
      'compra_manual', 'venta', 'ajuste', 'ajuste_manual',
      'compra_bot_whatsapp', 'consumo_turno', 'reposicion_consumo',
      'consumo_clase', 'reposicion_consumo_clase', 'anulacion_venta'
    )
  );

ALTER TABLE public.movimientos_stock
  DROP CONSTRAINT IF EXISTS mov_stock_coherencia_fuente;
ALTER TABLE public.movimientos_stock
  ADD CONSTRAINT mov_stock_coherencia_fuente CHECK (
    (fuente = 'venta' AND cantidad < 0 AND venta_id IS NOT NULL)
    OR (fuente = 'anulacion_venta' AND cantidad > 0 AND venta_id IS NOT NULL)
    OR (fuente IN ('consumo_turno', 'consumo_clase') AND cantidad < 0)
    OR (fuente IN ('reposicion_consumo', 'reposicion_consumo_clase') AND cantidad > 0)
    OR (fuente IN ('compra_manual', 'compra_bot_whatsapp') AND cantidad > 0)
    OR (fuente IN ('ajuste', 'ajuste_manual'))
  );

CREATE OR REPLACE FUNCTION public.fn_cobrar_persona_turno(
  p_reserva_jugador_id BIGINT,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_monto_esperado DECIMAL,
  p_cuenta_id BIGINT DEFAULT NULL,
  p_monto DECIMAL DEFAULT NULL
)
RETURNS public.reserva_pagos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_persona public.reserva_jugadores;
  v_reserva public.reservas;
  v_cantidad_jugadores INT;
  v_cantidad_personas INT;
  v_cant_jug_sin_fija INT;
  v_alquiler_fijado DECIMAL(12,2);
  v_consumo_fijado DECIMAL(12,2);
  v_total_consumos_partido DECIMAL(12,2);
  v_total_consumos_general DECIMAL(12,2);
  v_total_consumos DECIMAL(12,2);
  v_total_a_cobrar DECIMAL(12,2);
  v_total_cobrado DECIMAL(12,2);
  v_saldo_global_restante DECIMAL(12,2);
  v_alquiler_restante_global DECIMAL(12,2);
  v_consumo_restante_global DECIMAL(12,2);
  v_parte_alquiler DECIMAL(12,2);
  v_parte_consumo_partido DECIMAL(12,2);
  v_parte_consumo_general DECIMAL(12,2);
  v_parte_consumo DECIMAL(12,2);
  v_ya_pagado_alquiler DECIMAL(12,2);
  v_ya_pagado_consumo DECIMAL(12,2);
  v_saldo_alquiler DECIMAL(12,2);
  v_saldo_consumo DECIMAL(12,2);
  v_saldo_completo DECIMAL(12,2);
  v_monto_cobrado DECIMAL(12,2);
  v_monto_aplicado DECIMAL(12,2);
  v_cobro_alquiler DECIMAL(12,2);
  v_cobro_consumo DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_pago public.reserva_pagos;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;
  v_es_caja BOOLEAN;
BEGIN
  v_club_id := public.current_club_id();
  v_usuario_id := auth.uid();
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF p_medio_pago IS NULL OR p_medio_pago NOT IN
    ('efectivo','transferencia','mp','mercadopago','mercado_pago','tarjeta','cuenta_corriente','deposito','otro') THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio y debe ser válido.';
  END IF;

  SELECT * INTO v_persona
  FROM public.reserva_jugadores
  WHERE id = p_reserva_jugador_id AND club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la persona asociada al turno.';
  END IF;

  SELECT * INTO v_reserva
  FROM public.reservas
  WHERE id = v_persona.reserva_id AND club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND OR v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar un turno inexistente o cancelado.';
  END IF;

  IF p_cuenta_id IS NOT NULL THEN
    SELECT es_caja_fisica INTO v_es_caja
    FROM public.cuentas WHERE id = p_cuenta_id AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
    END IF;
    v_cuenta_id := p_cuenta_id;
  ELSE
    SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
    FROM public.medio_cuenta_default mcd
    JOIN public.cuentas c ON c.id = mcd.cuenta_id
    WHERE mcd.club_id = v_club_id AND mcd.medio_pago = p_medio_pago;
  END IF;
  IF COALESCE(v_es_caja, FALSE) THEN
    v_turno_caja_id := public.current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION 'No hay una caja abierta para recibir efectivo.';
    END IF;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE tipo = 'jugador'),
    COUNT(*),
    COUNT(*) FILTER (WHERE tipo = 'jugador' AND cuota_fija IS NULL),
    COALESCE(SUM(CASE WHEN tipo = 'jugador' AND cuota_fija IS NOT NULL
      THEN LEAST(cuota_fija, v_reserva.monto_total) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cuota_fija IS NOT NULL
      THEN GREATEST(0, cuota_fija - CASE WHEN tipo = 'jugador'
        THEN LEAST(cuota_fija, v_reserva.monto_total) ELSE 0 END) ELSE 0 END), 0)
  INTO v_cantidad_jugadores, v_cantidad_personas, v_cant_jug_sin_fija,
       v_alquiler_fijado, v_consumo_fijado
  FROM public.reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id;

  SELECT
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'partido'), 0),
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'general'), 0),
    COALESCE(SUM(subtotal), 0)
  INTO v_total_consumos_partido, v_total_consumos_general, v_total_consumos
  FROM public.reserva_consumos
  WHERE reserva_id = v_persona.reserva_id;

  v_total_a_cobrar := v_reserva.monto_total + v_total_consumos;
  SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado
  FROM public.reserva_pagos WHERE reserva_id = v_persona.reserva_id;
  v_saldo_global_restante := GREATEST(0, v_total_a_cobrar - v_total_cobrado);
  IF v_saldo_global_restante <= 0 THEN
    RAISE EXCEPTION 'El turno ya está saldado. No queda importe pendiente.';
  END IF;

  SELECT GREATEST(0, v_reserva.monto_total - COALESCE(SUM(monto_alquiler), 0))
    INTO v_alquiler_restante_global
  FROM public.reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;
  SELECT GREATEST(0, v_total_consumos - COALESCE(SUM(monto_consumo), 0))
    INTO v_consumo_restante_global
  FROM public.reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;

  IF v_persona.cuota_fija IS NOT NULL THEN
    v_parte_alquiler := CASE WHEN v_persona.tipo = 'jugador'
      THEN LEAST(v_persona.cuota_fija, v_reserva.monto_total) ELSE 0 END;
    v_parte_consumo := GREATEST(0, v_persona.cuota_fija - v_parte_alquiler);
  ELSE
    v_parte_alquiler := CASE
      WHEN v_persona.tipo = 'jugador' AND v_cant_jug_sin_fija > 0
      THEN ROUND(GREATEST(0, v_reserva.monto_total - v_alquiler_fijado) / v_cant_jug_sin_fija, 2)
      ELSE 0
    END;
    v_parte_consumo_partido := CASE
      WHEN v_cantidad_jugadores > 0 AND v_total_consumos_partido > 0 AND v_persona.tipo = 'jugador'
      THEN ROUND(v_total_consumos_partido / v_cantidad_jugadores, 2) ELSE 0
    END;
    v_parte_consumo_general := CASE
      WHEN v_cantidad_personas > 0 AND v_total_consumos_general > 0
      THEN ROUND(v_total_consumos_general / v_cantidad_personas, 2) ELSE 0
    END;
    v_parte_consumo := CASE WHEN v_persona.tipo = 'jugador'
      THEN v_parte_consumo_partido + v_parte_consumo_general
      ELSE v_parte_consumo_general END;
  END IF;

  SELECT COALESCE(SUM(monto_alquiler), 0), COALESCE(SUM(monto_consumo), 0)
    INTO v_ya_pagado_alquiler, v_ya_pagado_consumo
  FROM public.reserva_pagos
  WHERE reserva_jugador_id = p_reserva_jugador_id;
  v_saldo_alquiler := GREATEST(0,
    CASE WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler ELSE 0 END - v_ya_pagado_alquiler);
  v_saldo_consumo := GREATEST(0, v_parte_consumo - v_ya_pagado_consumo);
  v_saldo_completo := LEAST(v_saldo_alquiler + v_saldo_consumo, v_saldo_global_restante);

  IF p_monto IS NULL THEN
    IF v_saldo_completo <= 0 THEN
      RAISE EXCEPTION 'Esta persona no tiene saldo pendiente por cobrar.';
    END IF;
    v_monto_cobrado := v_saldo_completo;
  ELSE
    IF p_monto <= 0 THEN
      RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
    END IF;
    v_monto_cobrado := p_monto;
  END IF;

  -- Preserve the existing rent-first allocation, and route only the amount
  -- above the remaining turn balance to court revenue.
  v_monto_aplicado := LEAST(v_monto_cobrado, v_saldo_global_restante);
  v_cobro_alquiler := LEAST(v_monto_aplicado, v_alquiler_restante_global);
  v_cobro_consumo := LEAST(
    GREATEST(0, v_monto_aplicado - v_cobro_alquiler),
    v_consumo_restante_global
  );
  v_cobro_alquiler := v_monto_cobrado - v_cobro_consumo;

  INSERT INTO public.reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
    jugador_id, reserva_jugador_id, monto_alquiler, monto_consumo,
    cuenta_id, turno_caja_id
  ) VALUES (
    v_club_id, v_persona.reserva_id, v_monto_cobrado, p_medio_pago, 'pago',
    v_usuario_id, p_observaciones, v_persona.jugador_id, p_reserva_jugador_id,
    v_cobro_alquiler, v_cobro_consumo, v_cuenta_id, v_turno_caja_id
  ) RETURNING * INTO v_pago;

  IF v_ya_pagado_alquiler + v_ya_pagado_consumo + v_monto_cobrado
      >= v_parte_alquiler + v_parte_consumo THEN
    UPDATE public.reserva_jugadores
    SET cuota_fija = COALESCE(cuota_fija,
      v_parte_alquiler + v_parte_consumo)
    WHERE id = p_reserva_jugador_id;
  END IF;

  SELECT COALESCE(SUM(monto_alquiler), 0) INTO v_nuevo_monto_pagado
  FROM public.reserva_pagos
  WHERE reserva_id = v_persona.reserva_id;
  v_nuevo_estado := CASE
    WHEN v_nuevo_monto_pagado >= v_reserva.monto_total THEN 'pagada'
    WHEN v_nuevo_monto_pagado > 0 THEN 'senada'
    ELSE v_reserva.estado
  END;
  UPDATE public.reservas
  SET monto_pagado = LEAST(v_reserva.monto_total, v_nuevo_monto_pagado),
      estado = CASE WHEN v_reserva.estado = 'cancelada' THEN 'cancelada' ELSE v_nuevo_estado END
  WHERE id = v_persona.reserva_id;

  RETURN v_pago;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_cobrar_persona_turno(BIGINT, VARCHAR, TEXT, DECIMAL, BIGINT, DECIMAL)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_anular_venta(
  p_venta_id BIGINT,
  p_motivo TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_usuario_id UUID := auth.uid();
  v_venta public.ventas;
  v_caja_abierta BIGINT;
  v_efectivo DECIMAL(12,2);
  v_mov_id BIGINT;
BEGIN
  IF v_club_id IS NULL OR v_usuario_id IS NULL
      OR public.current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede anular una venta.';
  END IF;
  IF NULLIF(BTRIM(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Indicá el motivo de la anulación.';
  END IF;

  SELECT * INTO v_venta
  FROM public.ventas
  WHERE id = p_venta_id AND club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la venta en este club.';
  END IF;
  IF NOT v_venta.activa THEN
    RAISE EXCEPTION 'La venta ya está anulada.';
  END IF;

  PERFORM 1
  FROM public.productos p
  JOIN public.venta_items vi ON vi.producto_id = p.id
  WHERE vi.venta_id = p_venta_id AND vi.club_id = v_club_id
    AND p.club_id = v_club_id
  ORDER BY p.id
  FOR UPDATE OF p;

  INSERT INTO public.ventas_correcciones (
    club_id, venta_id, motivo, snapshot_venta, usuario_id
  )
  SELECT v_club_id, p_venta_id, BTRIM(p_motivo),
    jsonb_build_object(
      'venta', to_jsonb(v_venta),
      'items', COALESCE((SELECT jsonb_agg(to_jsonb(vi)) FROM public.venta_items vi
        WHERE vi.venta_id = p_venta_id), '[]'::jsonb),
      'pagos', COALESCE((SELECT jsonb_agg(to_jsonb(vp)) FROM public.venta_pagos vp
        WHERE vp.venta_id = p_venta_id), '[]'::jsonb)
    ), v_usuario_id;

  INSERT INTO public.movimientos_stock (
    club_id, producto_id, cantidad, fuente, venta_id, observaciones, usuario_id
  )
  SELECT vi.club_id, vi.producto_id, vi.cantidad, 'anulacion_venta',
    p_venta_id, 'Reversión de venta #' || p_venta_id || ': ' || BTRIM(p_motivo), v_usuario_id
  FROM public.venta_items vi
  WHERE vi.venta_id = p_venta_id AND vi.club_id = v_club_id;

  INSERT INTO public.venta_pagos_reversiones (
    club_id, venta_id, venta_pago_id, monto, medio_pago, cuenta_id, usuario_id
  )
  SELECT vp.club_id, vp.venta_id, vp.id, vp.monto, vp.medio_pago, vp.cuenta_id, v_usuario_id
  FROM public.venta_pagos vp
  WHERE vp.venta_id = p_venta_id AND vp.club_id = v_club_id;

  SELECT COALESCE(SUM(vp.monto), 0) INTO v_efectivo
  FROM public.venta_pagos vp
  LEFT JOIN public.cuentas c ON c.id = vp.cuenta_id AND c.club_id = v_club_id
  WHERE vp.venta_id = p_venta_id
    AND (
      c.es_caja_fisica = TRUE
      OR (vp.cuenta_id IS NULL AND vp.medio_pago = 'efectivo')
    );

  IF v_efectivo > 0 THEN
    v_caja_abierta := public.current_club_caja_abierta();
    IF v_caja_abierta IS NULL THEN
      RAISE EXCEPTION 'No hay caja abierta para registrar la reversión del efectivo.';
    END IF;
    INSERT INTO public.caja_movimientos_manuales (
      club_id, turno_caja_id, tipo, monto, concepto, usuario_id
    ) VALUES (
      v_club_id, v_caja_abierta, 'ajuste_negativo', v_efectivo,
      'Reversión de la venta #' || p_venta_id || ': ' || BTRIM(p_motivo), v_usuario_id
    ) RETURNING id INTO v_mov_id;
  END IF;

  UPDATE public.ventas SET activa = FALSE
  WHERE id = p_venta_id AND club_id = v_club_id;

  RETURN p_venta_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_anular_venta(BIGINT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_anular_venta(BIGINT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_corregir_venta(
  p_venta_id BIGINT,
  p_motivo TEXT,
  p_items JSONB,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_cuenta_id BIGINT DEFAULT NULL,
  p_jugador_id BIGINT DEFAULT NULL,
  p_pagos JSONB DEFAULT NULL
)
RETURNS public.ventas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT := public.current_club_id();
  v_usuario_id UUID := auth.uid();
  v_productos BIGINT[];
  v_cantidades INT[];
  v_producto public.productos;
  v_stock INT;
  v_i INT;
  v_total DECIMAL(12,2) := 0;
  v_precio DECIMAL(12,2);
  v_costo DECIMAL(12,2);
  v_linea public.venta_items.linea%TYPE;
  v_nombre_producto TEXT;
  v_pagos_total DECIMAL(12,2) := 0;
  v_pago JSONB;
  v_medio VARCHAR(30);
  v_cuenta_id BIGINT;
  v_cuenta_header_id BIGINT;
  v_es_caja BOOLEAN;
  v_tiene_efectivo BOOLEAN := FALSE;
  v_turno_caja_id BIGINT;
  v_turno_caja_pago_id BIGINT;
  v_medios_distintos INT;
  v_medio_header VARCHAR(30);
  v_reemplazo public.ventas;
  v_correccion_id BIGINT;
BEGIN
  IF v_club_id IS NULL OR v_usuario_id IS NULL
      OR public.current_user_rol() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede corregir una venta.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta corregida debe tener al menos un producto.';
  END IF;
  IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' OR jsonb_array_length(p_pagos) = 0 THEN
    RAISE EXCEPTION 'La venta corregida debe tener al menos un pago.';
  END IF;

  PERFORM public.fn_anular_venta(p_venta_id, p_motivo);
  SELECT id INTO v_correccion_id
  FROM public.ventas_correcciones
  WHERE venta_id = p_venta_id AND club_id = public.current_club_id()
  ORDER BY id DESC LIMIT 1;

  SELECT
    array_agg(producto_id ORDER BY producto_id),
    array_agg(cantidad ORDER BY producto_id)
  INTO v_productos, v_cantidades
  FROM (
    SELECT
      (item->>'producto_id')::BIGINT AS producto_id,
      SUM((item->>'cantidad')::INT)::INT AS cantidad
    FROM jsonb_array_elements(p_items) item
    GROUP BY (item->>'producto_id')::BIGINT
  ) items;

  IF v_productos IS NULL THEN
    RAISE EXCEPTION 'La venta corregida debe tener productos válidos.';
  END IF;
  FOR v_i IN 1..array_length(v_productos, 1) LOOP
    IF v_cantidades[v_i] IS NULL OR v_cantidades[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad de cada producto debe ser mayor a cero.';
    END IF;
  END LOOP;

  PERFORM 1
  FROM public.productos
  WHERE id = ANY(v_productos) AND club_id = v_club_id
  ORDER BY id
  FOR UPDATE;

  FOR v_i IN 1..array_length(v_productos, 1) LOOP
    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_productos[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto seleccionado no existe o no pertenece a tu club.';
    END IF;
    IF NOT v_producto.activo AND NOT EXISTS (
      SELECT 1
      FROM public.venta_items vi
      WHERE vi.venta_id = p_venta_id AND vi.producto_id = v_producto.id
    ) THEN
      RAISE EXCEPTION 'No se pueden agregar productos inactivos a la venta corregida.';
    END IF;

    SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
    FROM public.movimientos_stock
    WHERE producto_id = v_producto.id;
    IF v_stock < v_cantidades[v_i] THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": hay % unidades y querés vender %.',
        v_producto.nombre, v_stock, v_cantidades[v_i];
    END IF;

    SELECT vi.producto_nombre, vi.precio_unitario, vi.costo_unitario, vi.linea
    INTO v_nombre_producto, v_precio, v_costo, v_linea
    FROM public.venta_items vi
    WHERE vi.venta_id = p_venta_id AND vi.producto_id = v_producto.id
    ORDER BY vi.id
    LIMIT 1;
    IF NOT FOUND THEN
      v_nombre_producto := v_producto.nombre;
      v_precio := v_producto.precio;
      v_costo := v_producto.costo;
      v_linea := v_producto.linea;
    END IF;
    v_total := v_total + v_precio * v_cantidades[v_i];
  END LOOP;

  SELECT COALESCE(SUM((pago->>'monto')::DECIMAL(12,2)), 0)
  INTO v_pagos_total
  FROM jsonb_array_elements(p_pagos) pago;
  IF ABS(v_pagos_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'La suma de los pagos ($%) no coincide con el total corregido ($%).',
      v_pagos_total, v_total;
  END IF;
  SELECT COUNT(DISTINCT pago->>'medio_pago')
  INTO v_medios_distintos
  FROM jsonb_array_elements(p_pagos) pago;
  IF v_medios_distintos = 1 THEN
    SELECT pago->>'medio_pago' INTO v_medio_header
    FROM jsonb_array_elements(p_pagos) pago
    LIMIT 1;
  ELSE
    v_medio_header := 'mixto';
  END IF;

  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
    v_medio := v_pago->>'medio_pago';
    IF v_medio IS NULL OR v_medio NOT IN
      ('efectivo', 'transferencia', 'mp', 'tarjeta', 'cuenta_corriente', 'otro') THEN
      RAISE EXCEPTION 'El medio de pago de la venta corregida no es válido.';
    END IF;
    IF (v_pago->>'monto')::DECIMAL(12,2) <= 0 THEN
      RAISE EXCEPTION 'Cada pago debe ser mayor a cero.';
    END IF;
    IF v_medio = 'cuenta_corriente'
        AND COALESCE((v_pago->>'jugador_id')::BIGINT, p_jugador_id) IS NULL THEN
      RAISE EXCEPTION 'Elegí un jugador para el pago a cuenta corriente.';
    END IF;

    v_cuenta_id := NULL;
    v_es_caja := FALSE;
    IF NULLIF(v_pago->>'cuenta_id', '') IS NOT NULL THEN
      v_cuenta_id := (v_pago->>'cuenta_id')::BIGINT;
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = v_cuenta_id AND club_id = v_club_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta indicada no existe o no pertenece a tu club.';
      END IF;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = v_medio;
    END IF;
    v_es_caja := COALESCE(v_es_caja, FALSE);
    IF v_es_caja OR v_medio = 'efectivo' THEN
      v_tiene_efectivo := TRUE;
    END IF;
    IF jsonb_array_length(p_pagos) = 1 THEN
      v_cuenta_header_id := v_cuenta_id;
    END IF;
  END LOOP;

  IF v_tiene_efectivo THEN
    v_turno_caja_id := public.current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION 'No hay caja abierta para registrar el pago en efectivo.';
    END IF;
  END IF;

  INSERT INTO public.ventas (
    club_id, monto_total, medio_pago, observaciones, usuario_id,
    turno_caja_id, cuenta_id, jugador_id
  ) VALUES (
    v_club_id, v_total, v_medio_header, p_observaciones, v_usuario_id,
    v_turno_caja_id, v_cuenta_header_id, p_jugador_id
  )
  RETURNING * INTO v_reemplazo;

  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos) LOOP
    v_medio := v_pago->>'medio_pago';
    v_cuenta_id := NULL;
    v_es_caja := FALSE;
    IF NULLIF(v_pago->>'cuenta_id', '') IS NOT NULL THEN
      v_cuenta_id := (v_pago->>'cuenta_id')::BIGINT;
      SELECT es_caja_fisica INTO v_es_caja
      FROM public.cuentas
      WHERE id = v_cuenta_id AND club_id = v_club_id;
    ELSE
      SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_id, v_es_caja
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id
      WHERE mcd.club_id = v_club_id AND mcd.medio_pago = v_medio;
    END IF;
    v_turno_caja_pago_id := NULL;
    IF COALESCE(v_es_caja, FALSE) OR v_medio = 'efectivo' THEN
      v_turno_caja_pago_id := v_turno_caja_id;
    END IF;

    INSERT INTO public.venta_pagos (
      club_id, venta_id, monto, medio_pago, cuenta_id, turno_caja_id,
      usuario_id, jugador_id
    ) VALUES (
      v_club_id, v_reemplazo.id, (v_pago->>'monto')::DECIMAL(12,2),
      v_medio, v_cuenta_id, v_turno_caja_pago_id, v_usuario_id,
      COALESCE((v_pago->>'jugador_id')::BIGINT, p_jugador_id)
    );
  END LOOP;

  FOR v_i IN 1..array_length(v_productos, 1) LOOP
    SELECT * INTO v_producto
    FROM public.productos
    WHERE id = v_productos[v_i] AND club_id = v_club_id;

    SELECT vi.producto_nombre, vi.precio_unitario, vi.costo_unitario, vi.linea
    INTO v_nombre_producto, v_precio, v_costo, v_linea
    FROM public.venta_items vi
    WHERE vi.venta_id = p_venta_id AND vi.producto_id = v_producto.id
    ORDER BY vi.id
    LIMIT 1;
    IF NOT FOUND THEN
      v_nombre_producto := v_producto.nombre;
      v_precio := v_producto.precio;
      v_costo := v_producto.costo;
      v_linea := v_producto.linea;
    END IF;

    INSERT INTO public.venta_items (
      club_id, venta_id, producto_id, producto_nombre, cantidad,
      precio_unitario, costo_unitario, subtotal, linea
    ) VALUES (
      v_club_id, v_reemplazo.id, v_producto.id, v_nombre_producto,
      v_cantidades[v_i], v_precio, v_costo,
      v_precio * v_cantidades[v_i], v_linea
    );

    INSERT INTO public.movimientos_stock (
      club_id, producto_id, cantidad, fuente, venta_id, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, -v_cantidades[v_i], 'venta',
      v_reemplazo.id, v_usuario_id
    );
  END LOOP;

  UPDATE public.ventas_correcciones
  SET venta_reemplazo_id = v_reemplazo.id
  WHERE id = v_correccion_id;
  RETURN v_reemplazo;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_corregir_venta(BIGINT, TEXT, JSONB, VARCHAR, TEXT, BIGINT, BIGINT, JSONB)
  TO authenticated;
REVOKE ALL ON FUNCTION public.fn_corregir_venta(BIGINT, TEXT, JSONB, VARCHAR, TEXT, BIGINT, BIGINT, JSONB)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_obtener_resumen_financiero(p_anio integer, p_mes integer)
RETURNS json
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_club_id bigint;
  v_usuario_id uuid;
  v_desde date;
  v_hasta date;
  v_desde_iso timestamp;
  v_hasta_iso timestamp;
  v_ingreso_canchas numeric := 0;
  v_ingreso_clases numeric := 0;
  v_ventas_buffet_ingreso numeric := 0;
  v_ventas_shop_ingreso numeric := 0;
  v_consumos_buffet_ingreso numeric := 0;
  v_consumos_shop_ingreso numeric := 0;
  v_ingreso_buffet numeric := 0;
  v_ingreso_shop numeric := 0;
  v_ventas_buffet_costo numeric := 0;
  v_ventas_shop_costo numeric := 0;
  v_consumos_buffet_costo numeric := 0;
  v_consumos_shop_costo numeric := 0;
  v_costo_buffet numeric := 0;
  v_costo_shop numeric := 0;
  v_costos_directos numeric := 0;
  v_ingresos_total numeric := 0;
  v_gastos_operativos numeric := 0;
  v_gastos_estructura numeric := 0;
  v_gastos_financieros numeric := 0;
  v_gastos_otros numeric := 0;
  v_compras_mercaderia numeric := 0;
  v_gastos_total numeric := 0;
  v_financial_income numeric := 0;
  v_net_financial_result numeric := 0;
  v_resultado_neto numeric := 0;
  v_margen_bruto numeric := 0;
  v_resultado_operativo numeric := 0;
  v_margen_porcentaje numeric := 0;
  v_json_ingresos_por_unidad json;
  v_json_costos_por_linea json;
  v_json_top_gastos json;
  v_json_movimientos json;
  v_json_ingresos_diarios json;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();
  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  v_desde := (p_anio || '-' || LPAD(p_mes::text, 2, '0') || '-01')::date;
  v_hasta := (v_desde + interval '1 month' - interval '1 day')::date;
  v_desde_iso := (v_desde::text || ' 00:00:00')::timestamp;
  v_hasta_iso := (v_hasta::text || ' 23:59:59')::timestamp;

  SELECT COALESCE(SUM(CASE WHEN tipo = 'reembolso' THEN -monto_alquiler ELSE monto_alquiler END), 0)
  INTO v_ingreso_canchas
  FROM reserva_pagos
  WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso;

  SELECT COALESCE(SUM(monto), 0)
  INTO v_ingreso_clases
  FROM clase_cobros
  WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso;

  SELECT
    COALESCE(SUM(CASE WHEN vi.linea = 'buffet' THEN vi.precio_unitario * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'shop' THEN vi.precio_unitario * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'buffet' THEN COALESCE(vi.costo_unitario, 0) * vi.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vi.linea = 'shop' THEN COALESCE(vi.costo_unitario, 0) * vi.cantidad ELSE 0 END), 0)
  INTO v_ventas_buffet_ingreso, v_ventas_shop_ingreso, v_ventas_buffet_costo, v_ventas_shop_costo
  FROM venta_items vi
  JOIN ventas v ON vi.venta_id = v.id
  WHERE v.club_id = v_club_id AND v.activa = TRUE
    AND v.fecha_hora >= v_desde_iso AND v.fecha_hora <= v_hasta_iso;

  WITH candidatos AS (
    SELECT DISTINCT rp.reserva_id
    FROM reserva_pagos rp
    WHERE rp.club_id = v_club_id AND rp.monto_consumo > 0
      AND rp.fecha_hora >= v_desde_iso AND rp.fecha_hora <= v_hasta_iso
  ),
  ya_contados AS (
    SELECT DISTINCT rp.reserva_id
    FROM reserva_pagos rp
    WHERE rp.club_id = v_club_id AND rp.monto_consumo > 0
      AND rp.fecha_hora < v_desde_iso
      AND rp.reserva_id IN (SELECT reserva_id FROM candidatos)
  ),
  candidatos_filtrados AS (
    SELECT c.reserva_id
    FROM candidatos c
    WHERE c.reserva_id NOT IN (SELECT reserva_id FROM ya_contados)
  )
  SELECT
    COALESCE(SUM(CASE WHEN rc.linea = 'buffet' THEN rc.subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN rc.linea = 'shop' THEN rc.subtotal ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN rc.linea = 'buffet' THEN COALESCE(rc.costo_unitario, 0) * rc.cantidad ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN rc.linea = 'shop' THEN COALESCE(rc.costo_unitario, 0) * rc.cantidad ELSE 0 END), 0)
  INTO v_consumos_buffet_ingreso, v_consumos_shop_ingreso,
       v_consumos_buffet_costo, v_consumos_shop_costo
  FROM reserva_consumos rc
  WHERE rc.club_id = v_club_id
    AND rc.reserva_id IN (SELECT reserva_id FROM candidatos_filtrados);

  v_ingreso_buffet := v_ventas_buffet_ingreso + v_consumos_buffet_ingreso;
  v_ingreso_shop := v_ventas_shop_ingreso + v_consumos_shop_ingreso;
  v_costo_buffet := v_ventas_buffet_costo + v_consumos_buffet_costo;
  v_costo_shop := v_ventas_shop_costo + v_consumos_shop_costo;
  v_costos_directos := v_costo_buffet + v_costo_shop;

  WITH otros_agrupados AS (
    SELECT unidad_nombre AS unidad, unidad_tipo AS tipo, SUM(monto) AS monto
    FROM otros_ingresos
    WHERE club_id = v_club_id AND activo = true AND unidad_tipo <> 'financiero'
      AND fecha >= v_desde AND fecha <= v_hasta
    GROUP BY unidad_nombre, unidad_tipo
  ),
  unidades_unidas AS (
    SELECT 'Canchas' AS unidad, 'canchas' AS tipo, v_ingreso_canchas AS monto WHERE v_ingreso_canchas > 0
    UNION ALL SELECT 'Escuela', 'clases', v_ingreso_clases WHERE v_ingreso_clases > 0
    UNION ALL SELECT 'Buffet', 'buffet', v_ingreso_buffet WHERE v_ingreso_buffet > 0
    UNION ALL SELECT 'Shop', 'shop', v_ingreso_shop WHERE v_ingreso_shop > 0
    UNION ALL SELECT unidad, tipo, monto FROM otros_agrupados WHERE monto > 0
  ),
  unidades_agrupadas AS (
    SELECT unidad, tipo, SUM(monto) AS monto
    FROM unidades_unidas
    GROUP BY unidad, tipo
  )
  SELECT COALESCE(
    json_agg(json_build_object('unidad', unidad, 'tipo', tipo, 'monto', monto) ORDER BY monto DESC),
    '[]'::json
  )
  INTO v_json_ingresos_por_unidad
  FROM unidades_agrupadas;

  v_ingresos_total := v_ingreso_canchas + v_ingreso_clases + v_ingreso_buffet + v_ingreso_shop
    + COALESCE((
      SELECT SUM(monto) FROM otros_ingresos
      WHERE club_id = v_club_id AND activo = true AND unidad_tipo <> 'financiero'
        AND fecha >= v_desde AND fecha <= v_hasta
    ), 0);

  WITH lineas_todas AS (
    SELECT 'buffet' AS linea, v_costo_buffet AS monto WHERE v_costo_buffet > 0
    UNION ALL SELECT 'shop', v_costo_shop WHERE v_costo_shop > 0
  )
  SELECT COALESCE(
    json_agg(json_build_object('linea', linea, 'monto', monto) ORDER BY monto DESC),
    '[]'::json
  )
  INTO v_json_costos_por_linea
  FROM lineas_todas;

  SELECT
    COALESCE(SUM(CASE WHEN g.clasificacion = 'DIRECT_OTHER' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'STRUCTURE' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'FINANCIAL' THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion NOT IN ('DIRECT_MERCHANDISE', 'DIRECT_OTHER', 'STRUCTURE', 'FINANCIAL') THEN g.monto ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN g.clasificacion = 'DIRECT_MERCHANDISE' THEN g.monto ELSE 0 END), 0)
  INTO v_gastos_operativos, v_gastos_estructura, v_gastos_financieros,
       v_gastos_otros, v_compras_mercaderia
  FROM gastos g
  WHERE g.club_id = v_club_id AND g.activo = true
    AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta;

  v_gastos_total := v_gastos_operativos + v_gastos_estructura + v_gastos_financieros + v_gastos_otros;

  SELECT COALESCE(SUM(monto), 0)
  INTO v_financial_income
  FROM otros_ingresos
  WHERE club_id = v_club_id AND activo = true AND unidad_tipo = 'financiero'
    AND fecha >= v_desde AND fecha <= v_hasta;

  v_margen_bruto := v_ingresos_total - v_costos_directos - v_gastos_operativos;
  v_resultado_operativo := v_margen_bruto - v_gastos_estructura;
  v_net_financial_result := v_financial_income - v_gastos_financieros;
  v_resultado_neto := v_resultado_operativo + v_net_financial_result;
  IF v_ingresos_total > 0 THEN
    v_margen_porcentaje := (v_resultado_neto / v_ingresos_total) * 100;
  ELSE
    v_margen_porcentaje := 0;
  END IF;

  WITH gastos_agrupados AS (
    SELECT g.categoria_nombre, g.unidad_nombre, g.unidad_tipo, SUM(g.monto) AS monto
    FROM gastos g
    WHERE g.club_id = v_club_id AND g.activo = true
      AND g.clasificacion <> 'DIRECT_MERCHANDISE'
      AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta
    GROUP BY g.categoria_nombre, g.unidad_nombre, g.unidad_tipo
    ORDER BY monto DESC
    LIMIT 8
  )
  SELECT COALESCE(
    json_agg(json_build_object(
      'categoria_nombre', categoria_nombre,
      'unidad_nombre', unidad_nombre,
      'unidad_tipo', unidad_tipo,
      'monto', monto
    )),
    '[]'::json
  )
  INTO v_json_top_gastos
  FROM gastos_agrupados;

  WITH movs AS (
    SELECT
      'oi-' || fecha || '-' || unidad_nombre || '-' || monto::text AS id,
      'otro_ingreso' AS tipo, fecha::text AS fecha, unidad_nombre AS descripcion,
      NULL::text AS detalle, monto, '+' AS signo
    FROM otros_ingresos
    WHERE club_id = v_club_id AND activo = true AND fecha >= v_desde AND fecha <= v_hasta
    UNION ALL
    SELECT
      'g-' || g.id::text, 'gasto', g.fecha_gasto::text, g.categoria_nombre,
      COALESCE(g.proveedor, g.unidad_nombre), g.monto, '-'
    FROM gastos g
    WHERE g.club_id = v_club_id AND g.activo = true
      AND g.clasificacion <> 'DIRECT_MERCHANDISE'
      AND g.fecha_gasto >= v_desde AND g.fecha_gasto <= v_hasta
    UNION ALL
    SELECT
      'v-' || v.id::text, 'venta', v.fecha_hora::text,
      'Venta mostrador #' || v.id::text, NULL::text, v.monto_total, '+'
    FROM (
      SELECT id, fecha_hora, monto_total
      FROM ventas
      WHERE club_id = v_club_id AND activa = TRUE
        AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
      ORDER BY fecha_hora DESC
      LIMIT 5
    ) v
  )
  SELECT COALESCE(json_agg(json_build_object(
    'id', id, 'tipo', tipo, 'fecha', fecha, 'descripcion', descripcion,
    'detalle', detalle, 'monto', monto, 'signo', signo
  )), '[]'::json)
  INTO v_json_movimientos
  FROM (SELECT * FROM movs ORDER BY fecha DESC LIMIT 15) sorted_movs;

  WITH dias AS (
    SELECT generate_series(v_desde, v_hasta, '1 day'::interval)::date AS fecha
  ),
  pagos_dia AS (
    SELECT (fecha_hora AT TIME ZONE 'UTC')::date AS fecha,
      SUM(CASE WHEN tipo = 'reembolso' THEN -monto_alquiler ELSE monto_alquiler END) AS monto
    FROM reserva_pagos
    WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
    GROUP BY 1
  ),
  clases_dia AS (
    SELECT (fecha_hora AT TIME ZONE 'UTC')::date AS fecha, SUM(monto) AS monto
    FROM clase_cobros
    WHERE club_id = v_club_id AND fecha_hora >= v_desde_iso AND fecha_hora <= v_hasta_iso
    GROUP BY 1
  ),
  ventas_dia AS (
    SELECT (v.fecha_hora AT TIME ZONE 'UTC')::date AS fecha, SUM(v.monto_total) AS monto
    FROM ventas v
    WHERE v.club_id = v_club_id AND v.activa = TRUE
      AND v.fecha_hora >= v_desde_iso AND v.fecha_hora <= v_hasta_iso
    GROUP BY 1
  ),
  monto_dia AS (
    SELECT d.fecha, EXTRACT(DAY FROM d.fecha)::int AS dia,
      COALESCE(p.monto, 0) + COALESCE(c.monto, 0) + COALESCE(v.monto, 0) AS monto
    FROM dias d
    LEFT JOIN pagos_dia p ON d.fecha = p.fecha
    LEFT JOIN clases_dia c ON d.fecha = c.fecha
    LEFT JOIN ventas_dia v ON d.fecha = v.fecha
  ),
  monto_dia_acumulado AS (
    SELECT fecha, dia, monto, SUM(monto) OVER (ORDER BY dia ASC) AS acumulado
    FROM monto_dia
  )
  SELECT COALESCE(json_agg(json_build_object(
    'fecha', fecha::text, 'dia', dia, 'monto', monto, 'acumulado', acumulado
  ) ORDER BY dia ASC), '[]'::json)
  INTO v_json_ingresos_diarios
  FROM monto_dia_acumulado;

  RETURN json_build_object(
    'mes', p_mes,
    'anio', p_anio,
    'ingresos_total', v_ingresos_total,
    'ingresos_por_unidad', v_json_ingresos_por_unidad,
    'costos_directos', v_costos_directos,
    'costos_por_linea', v_json_costos_por_linea,
    'gastos_operativos', v_gastos_operativos,
    'gastos_estructura', v_gastos_estructura,
    'gastos_financieros', v_gastos_financieros,
    'gastos_otros', v_gastos_otros,
    'gastos_total', v_gastos_total,
    'financial_income', v_financial_income,
    'financial_expenses', v_gastos_financieros,
    'net_financial_result', v_net_financial_result,
    'resultado_neto', v_resultado_neto,
    'margen_bruto', v_margen_bruto,
    'resultado_operativo', v_resultado_operativo,
    'margen_porcentaje', v_margen_porcentaje,
    'top_gastos_categoria', v_json_top_gastos,
    'movimientos_recientes', v_json_movimientos,
    'compras_mercaderia_periodo', v_compras_mercaderia,
    'ingresos_diarios', v_json_ingresos_diarios
  );
END;
$function$;

CREATE OR REPLACE VIEW public.v_movimientos_cuenta
WITH (security_invoker = true) AS
  SELECT rp.cuenta_id, rp.club_id, rp.fecha_hora AS fecha,
         'reserva_pago'::text AS origen, rp.id AS ref_id,
         (CASE WHEN rp.tipo = 'reembolso' THEN -1 ELSE 1 END)::smallint AS signo,
         rp.monto AS monto
  FROM public.reserva_pagos rp WHERE rp.cuenta_id IS NOT NULL
  UNION ALL
  SELECT cc.cuenta_id, cc.club_id, cc.fecha_hora, 'clase_cobro', cc.id, 1::smallint, cc.monto
  FROM public.clase_cobros cc WHERE cc.cuenta_id IS NOT NULL
  UNION ALL
  SELECT vp.cuenta_id, vp.club_id, vp.fecha_hora, 'venta_pago', vp.id, 1::smallint, vp.monto
  FROM public.venta_pagos vp WHERE vp.cuenta_id IS NOT NULL
  UNION ALL
  SELECT vpr.cuenta_id, vpr.club_id, vpr.fecha_hora, 'venta_reversion', vpr.id,
         (-1)::smallint, vpr.monto
  FROM public.venta_pagos_reversiones vpr
  JOIN public.cuentas c ON c.id = vpr.cuenta_id
  WHERE vpr.cuenta_id IS NOT NULL AND c.es_caja_fisica = FALSE
  UNION ALL
  SELECT g.cuenta_id, g.club_id, g.fecha_pago::timestamptz, 'gasto', g.id, (-1)::smallint, g.monto
  FROM public.gastos g WHERE g.cuenta_id IS NOT NULL AND g.activo = TRUE
  UNION ALL
  SELECT oi.cuenta_id, oi.club_id, oi.fecha_cobro::timestamptz, 'otro_ingreso', oi.id, 1::smallint, oi.monto
  FROM public.otros_ingresos oi WHERE oi.cuenta_id IS NOT NULL AND oi.activo = TRUE
  UNION ALL
  SELECT gc.cuenta_id, gc.club_id, gc.fecha_pago::timestamptz, 'gasto_cuota', gc.id, (-1)::smallint, gc.monto
  FROM public.gasto_cuotas gc WHERE gc.cuenta_id IS NOT NULL
  UNION ALL
  SELECT mcd.cuenta_id, cm.club_id, cm.fecha_hora, 'caja_manual', cm.id,
         (CASE WHEN cm.tipo = 'ajuste_positivo' THEN 1 ELSE -1 END)::smallint, cm.monto
  FROM public.caja_movimientos_manuales cm
  JOIN public.medio_cuenta_default mcd ON mcd.club_id = cm.club_id AND mcd.medio_pago = 'efectivo'
  UNION ALL
  SELECT tr.cuenta_origen_id, tr.club_id, tr.fecha::timestamptz, 'transferencia_origen', tr.id, (-1)::smallint, tr.monto
  FROM public.transferencias tr
  UNION ALL
  SELECT tr.cuenta_destino_id, tr.club_id, tr.fecha::timestamptz, 'transferencia_destino', tr.id, 1::smallint, tr.monto
  FROM public.transferencias tr;

ALTER VIEW public.v_movimientos_cuenta_detalle
  RENAME TO v_movimientos_cuenta_detalle_sin_reversion;

CREATE VIEW public.v_movimientos_cuenta_detalle
WITH (security_invoker = true) AS
  SELECT * FROM public.v_movimientos_cuenta_detalle_sin_reversion
  UNION ALL
  SELECT
    ('transferencia_origen_' || tr.id)::text,
    tr.club_id,
    tr.cuenta_origen_id,
    c.nombre,
    c.tipo,
    tr.fecha_hora,
    'transferencia_origen'::text,
    'Transferencia enviada'::text,
    COALESCE(tr.concepto, tr.observaciones, 'Transferencia')::text,
    (-1)::smallint,
    tr.monto::numeric(12,2),
    tr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text,
    u.rol
  FROM public.transferencias tr
  JOIN public.cuentas c ON c.id = tr.cuenta_origen_id AND c.club_id = tr.club_id
  LEFT JOIN public.usuarios u ON u.id = tr.usuario_id
  UNION ALL
  SELECT
    ('transferencia_destino_' || tr.id)::text,
    tr.club_id,
    tr.cuenta_destino_id,
    c.nombre,
    c.tipo,
    tr.fecha_hora,
    'transferencia_destino'::text,
    'Transferencia recibida'::text,
    COALESCE(tr.concepto, tr.observaciones, 'Transferencia')::text,
    1::smallint,
    tr.monto::numeric(12,2),
    tr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text,
    u.rol
  FROM public.transferencias tr
  JOIN public.cuentas c ON c.id = tr.cuenta_destino_id AND c.club_id = tr.club_id
  LEFT JOIN public.usuarios u ON u.id = tr.usuario_id
  UNION ALL
  SELECT
    ('venta_reversion_' || vpr.id)::text,
    vpr.club_id,
    vpr.cuenta_id,
    c.nombre,
    c.tipo,
    vpr.fecha_hora,
    'venta_reversion'::text,
    'Reversión venta'::text,
    ('Anulación de venta #' || vpr.venta_id || ' (' || vpr.medio_pago || ')')::text,
    (-1)::smallint,
    vpr.monto::numeric(12,2),
    vpr.usuario_id,
    COALESCE(u.nombre, 'Sistema')::text,
    u.rol
  FROM public.venta_pagos_reversiones vpr
  JOIN public.cuentas c ON c.id = vpr.cuenta_id
  LEFT JOIN public.usuarios u ON u.id = vpr.usuario_id
  WHERE vpr.cuenta_id IS NOT NULL AND c.es_caja_fisica = FALSE;

GRANT SELECT ON public.v_movimientos_cuenta_detalle TO authenticated;

COMMENT ON COLUMN public.ventas.activa IS
  'FALSE cuando la venta fue anulada. La venta y sus snapshots permanecen para auditoría.';
COMMENT ON TABLE public.ventas_correcciones IS
  'Auditoría de anulaciones/correcciones de ventas con snapshot previo. No se borran registros.';
COMMENT ON TABLE public.venta_pagos_reversiones IS
  'Ledger negativo de pagos revertidos al anular/corregir ventas.';

COMMIT;
