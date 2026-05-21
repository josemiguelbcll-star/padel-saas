-- ============================================================================
-- 0015_consumo_tipo_reparto.sql
-- Consumos "del partido" vs "generales" (Nivel 1)
--
-- Mejora sobre el módulo cuenta del turno (completo al 0014). Hoy todos
-- los consumos se reparten entre TODAS las personas (jugadores +
-- invitados) parejo. Pero algunos son sólo de los que juegan (ej. un
-- tarro de pelotas) y no deberían cargarse a los invitados.
--
-- Modelo:
--   - Cada `reserva_consumos` se marca con `tipo_reparto` ∈
--     ('partido','general'). Default 'general' (la mayoría — bebidas y
--     snacks — son de todos; la vendedora marca 'partido' sólo cuando
--     corresponde, sin clic extra en el caso común).
--   - Consumos 'partido' se dividen SÓLO entre los JUGADORES
--     (tipo='jugador'), parejo, incluido el titular.
--   - Consumos 'general' se dividen entre TODAS las personas
--     (jugadores + invitados), como hasta ahora.
--   - Parte de cada persona:
--       JUGADOR  = parte_alquiler + parte_consumo_partido + parte_consumo_general
--       INVITADO = parte_consumo_general
--   - CEIL al peso por cada parte individual (mismo invariante que ya
--     teníamos — el sobrante queda a favor del club).
--
-- REGLA DE ORO (no romper):
-- ─────────────────────────────────────────────────────────────────────
-- El desglose del PAGO no cambia. Todo el consumo (partido + general)
-- sigue siendo `reserva_pagos.monto_consumo` → línea "Buffet" en el
-- EERR. La distinción partido/general es SOLO para repartir entre
-- personas; NO cambia la unidad de negocio para reportes.
--
-- Esta migración hace cuatro cosas:
--
--   1. ADD COLUMN `tipo_reparto` en `reserva_consumos`
--      (NOT NULL DEFAULT 'general' + CHECK enum). Las filas existentes
--      caen a 'general' por el DEFAULT (coincide con el comportamiento
--      histórico: todos los consumos repartían entre todos).
--
--   2. DROP FUNCTION fn_cargar_consumo_turno(BIGINT, BIGINT, INT)
--      (signatura vieja exacta, con IF EXISTS por idempotencia) y
--      CREATE con la nueva signatura de 4 args que suma
--      p_tipo_reparto REQUIRED (sin default — el frontend siempre
--      decide explícito).
--
--   3. CREATE OR REPLACE fn_cobrar_persona_turno (misma signatura del
--      0014, body nuevo): el cálculo separa las dos bolsas de
--      consumo. El INSERT en reserva_pagos sigue idéntico — todo el
--      monto_consumo es Buffet.
--
--   4. GRANT EXECUTE de fn_cargar_consumo_turno con la nueva
--      signatura (el de fn_cobrar_persona_turno se conserva — la
--      signatura no cambió).
--
-- Sincronización RPC ↔ frontend:
-- ─────────────────────────────────────────────────────────────────────
-- La fórmula de fn_cobrar_persona_turno debe DAR EXACTAMENTE LO MISMO
-- que la de calcularDesgloseCuenta del frontend, sino la validación
-- cruzada con p_monto_esperado rechaza cobros válidos. Tabla de
-- equivalencia:
--   - parte alquiler / jugador       → CEIL(monto_total / cant_jug)
--   - parte consumo partido / jug    → CEIL(total_partido / cant_jug)
--   - parte consumo general / pers   → CEIL(total_general / cant_pers)
--   - parte total jugador            → suma de las 3
--   - parte total invitado           → sólo general
-- Todos los CEIL aplican `> 0` guard para evitar div/0.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). NO toca:
--   - reserva_pagos (ni desglose monto_alquiler/monto_consumo).
--   - movimientos_stock.
--   - fn_quitar_consumo_turno (sigue funcional — el quitar borra una
--     fila individual con su tipo_reparto, la reposición vuelve igual).
--   - reserva_jugadores, productos, ventas, clases.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Columna nueva en reserva_consumos
--
--    NOT NULL DEFAULT 'general' → el ADD COLUMN llena todas las filas
--    existentes con 'general'. Coincide con el comportamiento
--    histórico (todos los consumos se repartían entre todas las
--    personas), así que el backfill es semánticamente correcto.
--
--    CHECK enum inline (anónimo) — mismo patrón que reserva_pagos.tipo,
--    reserva_pagos.medio_pago, reserva_jugadores.tipo. No se nombra
--    para no introducir un nombre que haya que mantener; si en algún
--    futuro hace falta dropearlo, se busca por columna y se reemplaza
--    con el mismo flow que usamos para los CHECKs anónimos del 0009.
-- ============================================================================
ALTER TABLE reserva_consumos
  ADD COLUMN tipo_reparto VARCHAR(20) NOT NULL DEFAULT 'general'
  CHECK (tipo_reparto IN ('partido', 'general'));

COMMENT ON COLUMN reserva_consumos.tipo_reparto IS
  'Cómo se reparte el consumo entre las personas del turno:
     - ''partido'': sólo entre JUGADORES (tipo=jugador), parejo.
       Caso típico: un tarro de pelotas — los invitados no lo pagan.
     - ''general'': entre TODAS las personas (jugadores + invitados),
       parejo. Default — la mayoría de los consumos (bebidas, snacks).
   La distinción es SOLO para repartir la cuenta entre personas. No
   cambia la atribución contable: todo el consumo sigue siendo línea
   "Buffet" en el EERR (reserva_pagos.monto_consumo agregado).
   Definido al cargar; no editable después (quitar + cargar de nuevo).';


-- ============================================================================
-- 2. fn_cargar_consumo_turno — nueva signatura (4 args)
--
--    La signatura vieja (3 args) se elimina con IF EXISTS por
--    idempotencia (si el script se corre dos veces o sobre una base
--    sin la vieja, no rompe).
--
--    p_tipo_reparto es REQUIRED (sin DEFAULT) — el frontend siempre
--    decide explícito. Si algún caller olvidado intenta llamarla con
--    3 args, falla con error claro de Postgres ("function does not
--    exist").
-- ============================================================================
DROP FUNCTION IF EXISTS fn_cargar_consumo_turno(BIGINT, BIGINT, INT);

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

  -- Calcular stock bajo el lock.
  SELECT COALESCE(SUM(cantidad), 0)::INT INTO v_stock
  FROM movimientos_stock
  WHERE producto_id = v_producto.id;

  IF v_stock < p_cantidad THEN
    RAISE EXCEPTION
      'Stock insuficiente de "%": hay % unidades, querés cargar %.',
      v_producto.nombre, v_stock, p_cantidad;
  END IF;

  -- INSERT consumo con snapshots + tipo_reparto.
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    p_tipo_reparto
  )
  RETURNING * INTO v_consumo;

  -- INSERT movimiento de salida atado al consumo nuevo.
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

COMMENT ON FUNCTION fn_cargar_consumo_turno IS
  'Carga un producto a la cuenta del turno con su tipo de reparto
   (partido o general — ver reserva_consumos.tipo_reparto). Atómica:
   INSERT en reserva_consumos (snapshot de precio/costo + tipo_reparto)
   + INSERT en movimientos_stock (salida, fuente=consumo_turno). SELECT
   FOR UPDATE del producto previene oversold concurrente. Valida stock,
   producto activo, reserva no-cancelada, tipo_reparto válido y
   pertenencia al club.';

GRANT EXECUTE ON FUNCTION fn_cargar_consumo_turno(
  BIGINT, BIGINT, INT, VARCHAR
) TO authenticated;


-- ============================================================================
-- 3. fn_cobrar_persona_turno — mismo signature, body nuevo
--
--    El único cambio en el cálculo es el de la parte de consumo: se
--    separan las dos bolsas (partido entre jugadores, general entre
--    todos) y se suma según el tipo de la persona.
--
--    TODO LO DEMÁS QUEDA IGUAL:
--    - Locks per-persona + per-reserva.
--    - Validación cruzada con p_monto_esperado (clave para protegerse
--      contra cambios concurrentes — sigue funcionando exacto).
--    - INSERT en reserva_pagos con monto_alquiler = saldo_alquiler y
--      monto_consumo = saldo_consumo (saldo_consumo es el agregado, NO
--      se desglosa partido/general en el pago — REGLA DE ORO).
--    - UPDATE escalar reservas.monto_pagado con la parte de alquiler
--      (los consumos no entran al escalar legacy).
--    - UPDATE del estado de la reserva (jugada/cancelada nunca se
--      bajan; pagada si alquiler completo; senada si parcial).
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

  -- Partes (Forma B con CEIL al peso — equivalente a
  -- calcularDesgloseCuenta del frontend). El guard `> 0` evita
  -- Math.ceil(0/N) inútil y deja la intención explícita.
  v_parte_alquiler := CASE
    WHEN v_cantidad_jugadores > 0 AND v_reserva.monto_total > 0
    THEN CEIL(v_reserva.monto_total / v_cantidad_jugadores)
    ELSE 0
  END;

  -- Consumos PARTIDO se dividen sólo entre jugadores.
  v_parte_consumo_partido := CASE
    WHEN v_cantidad_jugadores > 0 AND v_total_consumos_partido > 0
    THEN CEIL(v_total_consumos_partido / v_cantidad_jugadores)
    ELSE 0
  END;

  -- Consumos GENERALES se dividen entre todas las personas.
  v_parte_consumo_general := CASE
    WHEN v_cantidad_personas > 0 AND v_total_consumos_general > 0
    THEN CEIL(v_total_consumos_general / v_cantidad_personas)
    ELSE 0
  END;

  -- Parte de consumo TOTAL de esta persona según su tipo.
  -- Invitados sólo pagan la parte general.
  v_parte_consumo := CASE
    WHEN v_persona.tipo = 'jugador'
    THEN v_parte_consumo_partido + v_parte_consumo_general
    ELSE v_parte_consumo_general
  END;

  -- Ya pagado por esta persona, desglosado en alquiler/consumo
  -- (el pago NO distingue partido vs general — todo es monto_consumo).
  SELECT
    COALESCE(SUM(monto_alquiler), 0),
    COALESCE(SUM(monto_consumo), 0)
  INTO v_ya_pagado_alquiler, v_ya_pagado_consumo
  FROM reserva_pagos
  WHERE reserva_jugador_id = p_reserva_jugador_id;

  -- Saldos por línea (max 0, sin "crédito" si pagó de más).
  -- Invitados NO pagan alquiler.
  v_saldo_alquiler := GREATEST(
    0,
    (CASE WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler ELSE 0 END)
      - v_ya_pagado_alquiler
  );
  v_saldo_consumo := GREATEST(0, v_parte_consumo - v_ya_pagado_consumo);

  v_monto_real := v_saldo_alquiler + v_saldo_consumo;

  -- Validación: ya saldada.
  IF v_monto_real <= 0 THEN
    v_parte_total := CASE
      WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler + v_parte_consumo
      ELSE v_parte_consumo
    END;
    v_ya_pagado_total := v_ya_pagado_alquiler + v_ya_pagado_consumo;
    RAISE EXCEPTION 'Esta persona ya está saldada (pagó $% de $%).',
      v_ya_pagado_total, v_parte_total;
  END IF;

  -- Validación cruzada con lo que el vendedor vio. Protege contra
  -- cambios concurrentes (otro vendedor agregó consumo, cambió el
  -- tipo_reparto al cargar uno nuevo, quitó persona, etc.).
  IF p_monto_esperado IS NULL OR p_monto_esperado <> v_monto_real THEN
    RAISE EXCEPTION
      'La cuenta del turno cambió, revisá el monto antes de cobrar (esperabas $% pero el saldo real es $%).',
      COALESCE(p_monto_esperado, 0), v_monto_real;
  END IF;

  -- INSERT del pago con desglose. monto_consumo es el AGREGADO
  -- (partido + general); el pago NO los distingue — REGLA DE ORO de
  -- la 0015 — todo es Buffet en el EERR.
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
    jugador_id,
    reserva_jugador_id, monto_alquiler, monto_consumo
  ) VALUES (
    v_club_id, v_persona.reserva_id, v_monto_real, p_medio_pago, 'pago', v_usuario_id, p_observaciones,
    v_persona.jugador_id,
    p_reserva_jugador_id, v_saldo_alquiler, v_saldo_consumo
  )
  RETURNING * INTO v_pago;

  -- Actualizar escalar monto_pagado de la reserva con la parte de
  -- ALQUILER (sin cambios — los consumos no entran al escalar legacy).
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

COMMENT ON FUNCTION fn_cobrar_persona_turno IS
  'Cobra a una persona del turno (jugador o invitado) su parte
   calculada server-side (Forma B, CEIL). Atómica: INSERT en
   reserva_pagos con desglose alquiler/consumo + UPDATE del escalar
   reservas.monto_pagado con la parte de alquiler + UPDATE del estado.
   p_monto_esperado es validación cruzada — si cambió la cuenta entre
   el render y el cobro, rechaza con mensaje claro.

   Desde la 0015, los consumos se separan en dos bolsas según
   tipo_reparto: ''partido'' se divide sólo entre jugadores, ''general''
   entre todas las personas. El desglose del pago NO distingue partido
   vs general — todo el consumo es monto_consumo (línea Buffet en el
   EERR).';


COMMIT;

-- ============================================================================
-- Fin de la migración 0015_consumo_tipo_reparto.sql
-- ============================================================================
