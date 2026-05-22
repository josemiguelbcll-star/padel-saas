-- ============================================================================
-- 0023_caja_integracion_cobros.sql
-- Módulo de Caja — Bloque 2 (integración con los flujos de cobro).
--
-- =====================================================================
-- ⚠ IMPACTO OPERATIVO — LEER ANTES DE APLICAR.
-- =====================================================================
-- A partir del momento en que esta migración se aplica, TODO cobro en
-- efectivo requiere caja abierta. Si no hay caja abierta del día y el
-- vendedor intenta cobrar en efectivo (reserva, buffet o clase), la
-- RPC RAISE con mensaje claro y el cobro se rechaza.
--
-- Coordinación recomendada del rollout:
--   - Aplicar cuando puedas abrir la primera caja inmediatamente
--     (desde /caja o vía RPC fn_abrir_caja).
--   - Alternativa: aplicar y abrir manualmente desde Studio:
--       SELECT fn_abrir_caja(0);
--     (Esto requiere estar logueado como admin/vendedor del club.)
--
-- Los cobros NO en efectivo (transferencia, mp, tarjeta, otro) NO se
-- afectan — siguen funcionando sin tocar la caja.
--
-- =====================================================================
-- REGLA DE ORO DEL EFECTIVO (idem 0022):
-- =====================================================================
-- Cuando p_medio_pago='efectivo' → el cobro entra a la caja abierta
-- (FK turno_caja_id seteado). Si NO hay caja, RAISE.
-- Cuando p_medio_pago != 'efectivo' → turno_caja_id queda NULL, sin
-- chequeo de caja (no hay efectivo físico que registrar).
--
-- El mensaje de error es UNIFORME en las 4 RPCs:
--   'No hay caja abierta. Pedile a la administración que abra la caja
--    del día antes de cobrar en efectivo.'
--
-- =====================================================================
-- QUÉ NO CAMBIA EN ESTA MIGRACIÓN.
-- =====================================================================
-- - Las SIGNATURAS de las 4 funciones (parámetros + tipo de retorno).
--   El frontend NO se entera del cambio.
-- - La lógica de cobro existente (locks, validaciones, cálculos,
--   INSERTs adicionales, UPDATEs de estado, etc.). Sólo se AGREGA
--   un bloque de atado a caja y una columna `turno_caja_id` al
--   INSERT principal.
-- - Las RPCs multi-tabla (fn_cerrar_venta) sólo atan la cabecera
--   (INSERT en `ventas`). Los INSERTs en venta_items y
--   movimientos_stock NO se tocan (no tienen medio_pago ni
--   turno_caja_id).
--
-- =====================================================================
-- PARTICULARIDAD A DESTACAR:
-- =====================================================================
-- Dos de las 4 funciones (fn_cobrar_reserva y fn_cobrar_clase) NO
-- validan explícitamente el enum de p_medio_pago — sólo chequean
-- IS NULL. El enum lo valida el CHECK de la tabla destino. Esa
-- validación NO la agrego en esta migración (no es objetivo de este
-- bloque); la respeto tal cual está.
--
-- En `fn_cobrar_persona_turno` y `fn_cerrar_venta` ya estaba el
-- chequeo NOT IN (...) y se mantiene.
-- ============================================================================

BEGIN;

-- ============================================================================
-- RPC 1/4: fn_cobrar_persona_turno (versión vigente en 0015)
--
-- Cambios respecto de 0015:
--   ⭐ DECLARE adicional: v_turno_caja_id BIGINT := NULL;
--   ⭐ Bloque "si efectivo, atar caja" entre la validación del medio
--      de pago y el lock de la persona del turno.
--   ⭐ INSERT en reserva_pagos agrega columna turno_caja_id.
--
-- Resto (locks, cálculo Forma B + CEIL, validación cruzada con
-- p_monto_esperado, UPDATE de reservas.monto_pagado y estado) IDÉNTICO.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cobrar_persona_turno(
  p_reserva_jugador_id BIGINT,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_monto_esperado DECIMAL
)
RETURNS reserva_pagos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_persona reserva_jugadores;
  v_reserva reservas;
  v_cantidad_jugadores INT;
  v_cantidad_personas INT;
  v_total_consumos_partido DECIMAL(12,2);
  v_total_consumos_general DECIMAL(12,2);
  v_parte_alquiler DECIMAL(12,2);
  v_parte_consumo_partido DECIMAL(12,2);
  v_parte_consumo_general DECIMAL(12,2);
  v_parte_consumo DECIMAL(12,2);
  v_ya_pagado_alquiler DECIMAL(12,2);
  v_ya_pagado_consumo DECIMAL(12,2);
  v_saldo_alquiler DECIMAL(12,2);
  v_saldo_consumo DECIMAL(12,2);
  v_monto_real DECIMAL(12,2);
  v_parte_total DECIMAL(12,2);
  v_ya_pagado_total DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_pago reserva_pagos;
  v_turno_caja_id BIGINT := NULL;  -- ⭐ NUEVO 0023
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  IF p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ⭐ NUEVO 0023 — ATADO A CAJA (regla de oro del efectivo).
  -- Si efectivo: resolver caja abierta y validar que existe. Para
  -- otros medios, v_turno_caja_id queda NULL (no toca la caja).
  -- Falla rápido ANTES del lock para no tomar recursos innecesarios.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;
  -- ⭐ FIN BLOQUE NUEVO

  -- Lock de la persona del turno (serializa cobros concurrentes a la
  -- misma persona — dos vendedores intentando cobrarle a la vez).
  SELECT * INTO v_persona
  FROM reserva_jugadores
  WHERE id = p_reserva_jugador_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona no existe o no pertenece a tu club.';
  END IF;

  -- Lock de la reserva (para que no se cancele mid-flight).
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = v_persona.reserva_id
  FOR UPDATE;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar a personas de una reserva cancelada.';
  END IF;

  -- Cantidades para la división.
  SELECT COUNT(*) INTO v_cantidad_jugadores
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id AND tipo = 'jugador';

  SELECT COUNT(*) INTO v_cantidad_personas
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id;

  -- DOS bolsas de consumo, separadas por tipo_reparto (0015).
  SELECT
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'partido'), 0),
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'general'), 0)
  INTO v_total_consumos_partido, v_total_consumos_general
  FROM reserva_consumos
  WHERE reserva_id = v_persona.reserva_id;

  -- Partes (Forma B con CEIL al peso).
  v_parte_alquiler := CASE
    WHEN v_cantidad_jugadores > 0 AND v_reserva.monto_total > 0
    THEN CEIL(v_reserva.monto_total / v_cantidad_jugadores)
    ELSE 0
  END;

  v_parte_consumo_partido := CASE
    WHEN v_cantidad_jugadores > 0 AND v_total_consumos_partido > 0
    THEN CEIL(v_total_consumos_partido / v_cantidad_jugadores)
    ELSE 0
  END;

  v_parte_consumo_general := CASE
    WHEN v_cantidad_personas > 0 AND v_total_consumos_general > 0
    THEN CEIL(v_total_consumos_general / v_cantidad_personas)
    ELSE 0
  END;

  v_parte_consumo := CASE
    WHEN v_persona.tipo = 'jugador'
    THEN v_parte_consumo_partido + v_parte_consumo_general
    ELSE v_parte_consumo_general
  END;

  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(monto_consumo), 0)
  INTO v_ya_pagado_alquiler, v_ya_pagado_consumo
  FROM reserva_pagos
  WHERE reserva_jugador_id = p_reserva_jugador_id;

  v_saldo_alquiler := GREATEST(
    0,
    (CASE WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler ELSE 0 END)
      - v_ya_pagado_alquiler
  );
  v_saldo_consumo := GREATEST(0, v_parte_consumo - v_ya_pagado_consumo);

  v_monto_real := v_saldo_alquiler + v_saldo_consumo;

  IF v_monto_real <= 0 THEN
    v_parte_total := CASE
      WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler + v_parte_consumo
      ELSE v_parte_consumo
    END;
    v_ya_pagado_total := v_ya_pagado_alquiler + v_ya_pagado_consumo;
    RAISE EXCEPTION 'Esta persona ya está saldada (pagó $% de $%).',
      v_ya_pagado_total, v_parte_total;
  END IF;

  IF p_monto_esperado IS NULL OR p_monto_esperado <> v_monto_real THEN
    RAISE EXCEPTION
      'La cuenta del turno cambió, revisá el monto antes de cobrar (esperabas $% pero el saldo real es $%).',
      COALESCE(p_monto_esperado, 0), v_monto_real;
  END IF;

  -- ⭐ NUEVO 0023 — INSERT incluye turno_caja_id.
  -- v_turno_caja_id es BIGINT (caja abierta) si p_medio_pago='efectivo',
  -- NULL en cualquier otro caso. Resto del INSERT IDÉNTICO al de 0015.
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
    jugador_id,
    reserva_jugador_id, monto_alquiler, monto_consumo,
    turno_caja_id                                            -- ⭐ NUEVO 0023
  ) VALUES (
    v_club_id, v_persona.reserva_id, v_monto_real, p_medio_pago, 'pago', v_usuario_id, p_observaciones,
    v_persona.jugador_id,
    p_reserva_jugador_id, v_saldo_alquiler, v_saldo_consumo,
    v_turno_caja_id                                          -- ⭐ NUEVO 0023
  )
  RETURNING * INTO v_pago;

  v_nuevo_monto_pagado := v_reserva.monto_pagado + v_saldo_alquiler;

  v_nuevo_estado := CASE
    WHEN v_reserva.estado IN ('jugada', 'cancelada') THEN v_reserva.estado
    WHEN v_nuevo_monto_pagado >= v_reserva.monto_total THEN 'pagada'
    WHEN v_nuevo_monto_pagado > 0 THEN 'senada'
    ELSE v_reserva.estado
  END;

  UPDATE reservas
  SET monto_pagado = v_nuevo_monto_pagado,
      estado = v_nuevo_estado
  WHERE id = v_persona.reserva_id;

  RETURN v_pago;
END;
$$;


-- ============================================================================
-- RPC 2/4: fn_cobrar_reserva (legacy, versión vigente en 0014)
--
-- DEPRECADA desde 0014 pero todavía existe — la modificamos por
-- consistencia. Cualquier cobro hecho via esta función (si algún
-- código viejo aún la llama) también respeta la regla de oro.
--
-- Cambios respecto de 0014:
--   ⭐ DECLARE adicional: v_turno_caja_id BIGINT := NULL;
--   ⭐ Bloque "si efectivo, atar caja" entre validación del medio y
--      lock de la reserva.
--   ⭐ INSERT en reserva_pagos agrega columna turno_caja_id.
--
-- PARTICULARIDAD: esta función NO valida explícitamente el enum
-- (NOT IN). Sólo chequea IS NULL. El CHECK de la tabla valida el
-- enum. NO agrego validación adicional acá (no es objetivo del
-- bloque 0023).
--
-- Resto (locks, cálculo de tipo_pago/saldo/estado, UPDATE de
-- reservas) IDÉNTICO al de 0014.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cobrar_reserva(
  p_reserva_id BIGINT,
  p_monto DECIMAL,
  p_medio_pago VARCHAR,
  p_observaciones TEXT
)
RETURNS reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva reservas;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_saldo DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_monto_sena DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_tipo_pago VARCHAR(20);
  v_titular_id BIGINT;
  v_turno_caja_id BIGINT := NULL;  -- ⭐ NUEVO 0023
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- ⭐ NUEVO 0023 — ATADO A CAJA (regla de oro del efectivo).
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;
  -- ⭐ FIN BLOQUE NUEVO

  -- Lock de la reserva (igual que antes).
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cobrar sobre una reserva cancelada.';
  END IF;

  v_saldo := v_reserva.monto_total - v_reserva.monto_pagado;
  IF v_saldo <= 0 THEN
    RAISE EXCEPTION 'Esta reserva ya está paga, no hay saldo para cobrar.';
  END IF;

  v_nuevo_monto_pagado := v_reserva.monto_pagado + p_monto;

  IF v_nuevo_monto_pagado > v_reserva.monto_total THEN
    RAISE EXCEPTION 'El cobro de $% supera el saldo pendiente de $%. Ajustá el monto.',
      p_monto, v_saldo;
  END IF;

  IF v_reserva.estado = 'pendiente' AND v_nuevo_monto_pagado < v_reserva.monto_total THEN
    v_tipo_pago := 'sena';
    v_nuevo_monto_sena := p_monto;
  ELSE
    v_tipo_pago := 'pago';
    v_nuevo_monto_sena := v_reserva.monto_sena;
  END IF;

  IF v_nuevo_monto_pagado >= v_reserva.monto_total THEN
    v_nuevo_estado := CASE WHEN v_reserva.estado = 'jugada' THEN 'jugada' ELSE 'pagada' END;
  ELSE
    v_nuevo_estado := CASE WHEN v_reserva.estado = 'jugada' THEN 'jugada' ELSE 'senada' END;
  END IF;

  SELECT id INTO v_titular_id
  FROM reserva_jugadores
  WHERE reserva_id = p_reserva_id
    AND es_titular = TRUE
    AND tipo = 'jugador'
  LIMIT 1;

  -- ⭐ NUEVO 0023 — INSERT incluye turno_caja_id (resto IDÉNTICO al de 0014).
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id,
    reserva_jugador_id, monto_alquiler, monto_consumo,
    turno_caja_id                                            -- ⭐ NUEVO 0023
  ) VALUES (
    v_club_id, p_reserva_id, p_monto, p_medio_pago, v_tipo_pago, v_usuario_id,
    v_titular_id, p_monto, 0,
    v_turno_caja_id                                          -- ⭐ NUEVO 0023
  );

  UPDATE reservas
  SET monto_pagado = v_nuevo_monto_pagado,
      monto_sena = v_nuevo_monto_sena,
      estado = v_nuevo_estado
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;


-- ============================================================================
-- RPC 3/4: fn_cerrar_venta (versión vigente en 0010)
--
-- IMPORTANTE — RPC MULTI-TABLA: inserta en ventas + venta_items +
-- movimientos_stock. El atado a caja AFECTA SÓLO el INSERT en
-- `ventas` (que es donde están medio_pago y turno_caja_id). Los
-- INSERTs en venta_items y movimientos_stock NO se tocan (no
-- tienen esas columnas).
--
-- Cambios respecto de 0010:
--   ⭐ DECLARE adicional: v_turno_caja_id BIGINT := NULL;
--   ⭐ Bloque "si efectivo, atar caja" entre validación del medio y
--      la consolidación de ítems.
--   ⭐ INSERT en ventas agrega columna turno_caja_id.
--
-- Resto (consolidación de ítems, lock de productos, validación de
-- stock, INSERT en venta_items con snapshot de costo, INSERT en
-- movimientos_stock) IDÉNTICO al de 0010.
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
  v_turno_caja_id BIGINT := NULL;  -- ⭐ NUEVO 0023
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

  -- ⭐ NUEVO 0023 — ATADO A CAJA (regla de oro del efectivo).
  -- Falla rápido antes del lock de productos.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;
  -- ⭐ FIN BLOQUE NUEVO

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

  -- ⭐ NUEVO 0023 — Header de la venta incluye turno_caja_id.
  -- Resto del INSERT IDÉNTICO al de 0010.
  INSERT INTO ventas (
    club_id, monto_total, medio_pago, observaciones, usuario_id,
    turno_caja_id                                            -- ⭐ NUEVO 0023
  )
  VALUES (
    v_club_id, v_total, p_medio_pago, p_observaciones, v_usuario_id,
    v_turno_caja_id                                          -- ⭐ NUEVO 0023
  )
  RETURNING * INTO v_venta;

  -- Items + movimientos. IDÉNTICO al de 0010 — NO se tocan acá.
  -- venta_items y movimientos_stock no tienen medio_pago ni
  -- turno_caja_id (no aplican).
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


-- ============================================================================
-- RPC 4/4: fn_cobrar_clase (versión vigente en 0008)
--
-- Cambios respecto de 0008:
--   ⭐ DECLARE adicional: v_turno_caja_id BIGINT := NULL;
--   ⭐ Bloque "si efectivo, atar caja" entre validación del medio y
--      lock de la clase.
--   ⭐ INSERT en clase_cobros agrega columna turno_caja_id.
--
-- PARTICULARIDAD: igual que fn_cobrar_reserva, esta función NO
-- valida el enum de medio_pago con NOT IN. El CHECK de la tabla
-- valida el enum. NO agrego validación adicional (no es objetivo).
--
-- Resto (validación monto, lock de clase, validación de día de
-- semana, INSERT en clase_cobros) IDÉNTICO al de 0008.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cobrar_clase(
  p_clase_id BIGINT,
  p_fecha DATE,
  p_monto DECIMAL,
  p_medio_pago VARCHAR,
  p_observaciones TEXT
)
RETURNS clase_cobros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_clase clases;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cobro clase_cobros;
  v_turno_caja_id BIGINT := NULL;  -- ⭐ NUEVO 0023
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
  END IF;

  IF p_medio_pago IS NULL THEN
    RAISE EXCEPTION 'El medio de pago es obligatorio.';
  END IF;

  -- ⭐ NUEVO 0023 — ATADO A CAJA (regla de oro del efectivo).
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;
  -- ⭐ FIN BLOQUE NUEVO

  -- Lock exclusivo de la clase.
  SELECT * INTO v_clase
  FROM clases
  WHERE id = p_clase_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La clase no existe o no pertenece a tu club.';
  END IF;

  IF NOT (EXTRACT(ISODOW FROM p_fecha)::INT = ANY(v_clase.dias_semana)) THEN
    RAISE EXCEPTION
      'La clase no se dicta el % — revisá los días configurados.', p_fecha;
  END IF;

  -- ⭐ NUEVO 0023 — INSERT incluye turno_caja_id (resto IDÉNTICO al de 0008).
  INSERT INTO clase_cobros (
    club_id, clase_id, fecha, monto, medio_pago, observaciones, usuario_id,
    turno_caja_id                                            -- ⭐ NUEVO 0023
  ) VALUES (
    v_club_id, p_clase_id, p_fecha, p_monto, p_medio_pago, p_observaciones, v_usuario_id,
    v_turno_caja_id                                          -- ⭐ NUEVO 0023
  )
  RETURNING * INTO v_cobro;

  RETURN v_cobro;
END;
$$;


COMMIT;

-- ============================================================================
-- Fin de la migración 0023_caja_integracion_cobros.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN
-- ============================================================================
-- Pre-requisito: tener una caja ABIERTA antes de probar cobros en
-- efectivo, o las 4 RPCs van a rechazar. Si no la tenés:
--
--   SELECT fn_abrir_caja(0);  -- como admin/vendedor del club
--
-- ---------- A. Las 4 funciones siguen con la misma signatura ----------
-- SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS ret
-- FROM pg_proc
-- WHERE proname IN ('fn_cobrar_persona_turno','fn_cobrar_reserva','fn_cerrar_venta','fn_cobrar_clase');
-- -- args y ret deberían ser idénticos a antes de la 0023.

-- ---------- B. Cobro en efectivo SIN caja abierta → rechazo ----------
-- Cerrá tu caja primero (si tenés una abierta):
--   SELECT fn_cerrar_caja(<id>, <contado>, 'test');
-- Intentá ahora un cobro:
--   await window.supabase.rpc('fn_cerrar_venta', {
--     p_items: [{ producto_id: <id>, cantidad: 1 }],
--     p_medio_pago: 'efectivo',
--     p_observaciones: 'test'
--   });
-- → error: 'No hay caja abierta. Pedile a la administración...'

-- ---------- C. Cobro NO efectivo SIN caja → funciona normal ----------
-- Mismo escenario sin caja, pero con medio_pago='transferencia':
-- → OK, la venta se crea normal con turno_caja_id=NULL.

-- ---------- D. Cobro en efectivo CON caja → se ata ----------
-- Abrí una caja: SELECT fn_abrir_caja(5000);
-- Hacé un cobro en efectivo (cualquiera de las 4 funciones).
-- Verificá que turno_caja_id quedó seteado:
--   SELECT id, monto_total, medio_pago, turno_caja_id FROM ventas ORDER BY id DESC LIMIT 1;

-- ---------- E. Arqueo refleja el cobro ----------
-- Después del cobro en efectivo de D, cerrá la caja:
--   SELECT fn_cerrar_caja(<id>, <apertura + monto cobrado>, 'test');
-- → diferencia debería ser 0.
-- ============================================================================
