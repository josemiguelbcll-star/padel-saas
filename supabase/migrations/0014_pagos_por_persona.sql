-- ============================================================================
-- 0014_pagos_por_persona.sql
-- Cuenta del turno — Paso 4: pagos por persona, con desglose por
-- línea de negocio (alquiler vs buffet)
--
-- Cuarta y última etapa del módulo "cuenta del turno tipo restaurante"
-- (ver "Visión de producto: el turno como cuenta" y "Visión de producto:
-- rentabilidad y EERR por unidad de negocio" en CLAUDE.md).
--
-- Cambio de modelo:
--   - Antes: se cobraba al titular con `fn_cobrar_reserva` (señas +
--     saldo, atribución implícita al titular, sin desglose).
--   - Ahora: se cobra a CADA PERSONA del turno (jugador o invitado)
--     individualmente, en un único pago que salda su parte. Cada pago
--     guarda DESGLOSE alquiler vs buffet para alimentar los reportes
--     EERR por unidad de negocio (paso futuro del CLAUDE.md).
--
-- Decisión de modelo (ver plan del paso 4):
--   - Extender `reserva_pagos` (NO crear tabla nueva). El "pago de la
--     reserva" sigue siendo un concepto único; las filas legacy se
--     backfilean al mismo shape que las nuevas.
--   - Desglose calculado SERVER-SIDE en la RPC nueva. El frontend
--     manda `reserva_jugador_id` + `p_monto_esperado` (lo que el
--     vendedor vio en pantalla); la RPC recalcula y, si no coincide
--     con lo esperado, RECHAZA con mensaje claro (protege contra
--     race con cambios concurrentes de personas/consumos).
--   - `monto_pagado` escalar de `reservas` sigue reflejando SOLO el
--     alquiler (mantiene compat con la grilla — ver
--     BloqueReserva/estados).
--
-- Esta migración hace ocho cosas:
--
--   1. Agrega 3 columnas a `reserva_pagos`:
--        - reserva_jugador_id  (FK SET NULL — preserva el pago si la
--          persona se quita después)
--        - monto_alquiler       (snapshot del desglose)
--        - monto_consumo        (snapshot del desglose)
--      Todas NULLABLE inicialmente (para que el ALTER no rompa filas
--      existentes).
--
--   2. BACKFILL: los pagos legacy se atan al titular del turno con
--      monto_alquiler = monto, monto_consumo = 0. Catch-all defensivo
--      para pagos huérfanos (reserva sin titular en reserva_jugadores).
--
--   3. SET NOT NULL en monto_alquiler/monto_consumo (después del
--      backfill). reserva_jugador_id queda nullable (pagos huérfanos
--      legacy puedan tenerlo NULL).
--
--   4. CHECK de coherencia del desglose: monto_alquiler + monto_consumo
--      = monto. Garantiza que todo pago futuro tenga desglose válido.
--
--   5. Índice parcial sobre reserva_jugador_id (acelera "ya pagó X esta
--      persona?").
--
--   6. CREATE OR REPLACE `fn_cobrar_reserva` (legacy): se conserva con
--      COMMENT deprecada, ajustada para que sus INSERTs cumplan el
--      nuevo CHECK del desglose (atribuye todo el monto al alquiler
--      del titular, igual que el comportamiento histórico). Los
--      callers legacy siguen funcionando.
--
--   7. CREATE OR REPLACE `fn_cobrar_persona_turno` (nueva): cobro
--      individual con cálculo server-side + validación cruzada vía
--      p_monto_esperado.
--
--   8. GRANT EXECUTE de la RPC nueva.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). NO toca:
--   - Los 3 CHECKs anónimos de reserva_pagos (monto>0, medio_pago enum,
--     tipo enum) — siguen siendo válidos.
--   - reserva_jugadores, reserva_consumos, movimientos_stock,
--     productos, ventas, clases — todo intacto.
--   - reservas: sólo se mantiene la actualización del escalar
--     monto_pagado vía la RPC, igual que antes.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Tres columnas nuevas en reserva_pagos
-- ============================================================================
ALTER TABLE reserva_pagos
  ADD COLUMN reserva_jugador_id BIGINT
  REFERENCES reserva_jugadores(id) ON DELETE SET NULL;

ALTER TABLE reserva_pagos
  ADD COLUMN monto_alquiler DECIMAL(12,2)
  CHECK (monto_alquiler >= 0);

ALTER TABLE reserva_pagos
  ADD COLUMN monto_consumo DECIMAL(12,2)
  CHECK (monto_consumo >= 0);


-- ============================================================================
-- 2. Backfill
--
--    Pagos legacy se atan al titular del turno como alquiler total.
--    Sólo busca titulares con tipo='jugador' (el invariante del 0012
--    garantiza que cualquier es_titular=TRUE sea tipo='jugador').
--
--    Idempotente: filtra por monto_alquiler IS NULL. Si se re-ejecuta,
--    no re-aplica sobre filas ya backfilleadas.
-- ============================================================================
UPDATE reserva_pagos rp
SET reserva_jugador_id = rj.id,
    monto_alquiler = rp.monto,
    monto_consumo = 0
FROM reserva_jugadores rj
WHERE rj.reserva_id = rp.reserva_id
  AND rj.es_titular = TRUE
  AND rj.tipo = 'jugador'
  AND rp.monto_alquiler IS NULL;

-- Catch-all defensivo: pagos huérfanos (reserva sin titular —
-- improbable, pero defensivo). Quedan sin reserva_jugador_id pero con
-- desglose válido (todo al alquiler) para que los reportes EERR los
-- cuenten correctamente.
UPDATE reserva_pagos
SET monto_alquiler = monto, monto_consumo = 0
WHERE monto_alquiler IS NULL;


-- ============================================================================
-- 3. SET NOT NULL en las columnas de desglose (post-backfill)
--
--    reserva_jugador_id sigue nullable: pagos huérfanos del catch-all,
--    o pagos cuya persona se quite en el futuro (ON DELETE SET NULL),
--    pueden tenerlo NULL. Para los reportes EERR alcanza con
--    monto_alquiler + monto_consumo.
-- ============================================================================
ALTER TABLE reserva_pagos ALTER COLUMN monto_alquiler SET NOT NULL;
ALTER TABLE reserva_pagos ALTER COLUMN monto_consumo SET NOT NULL;


-- ============================================================================
-- 4. CHECK de coherencia del desglose
--
--    Garantiza que todo pago tenga monto_alquiler + monto_consumo =
--    monto. La RPC nueva lo cumple por construcción; la RPC legacy
--    fn_cobrar_reserva (sección 6) se actualiza para cumplirlo
--    también. Cualquier INSERT directo via supabase-js que no setee
--    los desgloses falla (queremos que falle — es plata sin
--    atribución a línea de negocio, inválido para reportes).
-- ============================================================================
ALTER TABLE reserva_pagos
  ADD CONSTRAINT reserva_pagos_desglose_check
  CHECK (monto_alquiler + monto_consumo = monto);


-- ============================================================================
-- 5. Índice parcial para "pagos de esta persona"
-- ============================================================================
CREATE INDEX idx_reserva_pagos_reserva_jugador
  ON reserva_pagos(reserva_jugador_id)
  WHERE reserva_jugador_id IS NOT NULL;


-- ============================================================================
-- 6. Comments en columnas + constraint
-- ============================================================================
COMMENT ON COLUMN reserva_pagos.reserva_jugador_id IS
  'FK a la persona del turno que pagó. NULL en pagos huérfanos legacy
   (reservas sin titular en reserva_jugadores) o si la persona se
   quitó después del pago (ON DELETE SET NULL preserva la fila). Los
   reportes que requieran atribución a persona deben filtrar
   IS NOT NULL.';

COMMENT ON COLUMN reserva_pagos.monto_alquiler IS
  'Porción del monto del pago que corresponde al ALQUILER de la cancha.
   Para reportes EERR de la unidad de negocio "Alquileres". Cualquier
   pago tiene monto_alquiler + monto_consumo = monto (CHECK
   reserva_pagos_desglose_check).';

COMMENT ON COLUMN reserva_pagos.monto_consumo IS
  'Porción del monto del pago que corresponde a CONSUMOS DE BUFFET
   cargados al turno. Para reportes EERR de la unidad de negocio
   "Buffet" (estos pagos se suman a los de venta_items por mostrador
   para el total de la unidad).';

COMMENT ON CONSTRAINT reserva_pagos_desglose_check ON reserva_pagos IS
  'Coherencia: el monto total del pago se desglosa exactamente en
   alquiler + consumo. Sin tolerancia (son enteros redondeados con
   CEIL en la RPC, no hay precisión flotante).';


-- ============================================================================
-- 7. CREATE OR REPLACE fn_cobrar_reserva (legacy, deprecada)
--
--    Se conserva con COMMENT deprecada por compat — algún caller
--    podría seguir invocándola (frontend pre-actualización, scripts,
--    etc.). Su body se ajusta para que el INSERT cumpla el nuevo
--    CHECK del desglose: atribuye todo el monto al alquiler del
--    titular del turno. Conceptualmente igual al comportamiento
--    histórico (la seña vieja era "del titular como alquiler").
--
--    Para uso operativo nuevo, llamar `fn_cobrar_persona_turno`
--    (sección 8).
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

  -- NUEVO en la 0014: buscar el titular para atar el pago.
  -- Puede no existir (reserva huérfana, improbable) — el FK SET NULL
  -- permite reserva_jugador_id = NULL en ese caso.
  SELECT id INTO v_titular_id
  FROM reserva_jugadores
  WHERE reserva_id = p_reserva_id
    AND es_titular = TRUE
    AND tipo = 'jugador'
  LIMIT 1;

  -- INSERT con desglose: TODO al alquiler (comportamiento legacy).
  -- Esto cumple el CHECK reserva_pagos_desglose_check.
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id,
    reserva_jugador_id, monto_alquiler, monto_consumo
  ) VALUES (
    v_club_id, p_reserva_id, p_monto, p_medio_pago, v_tipo_pago, v_usuario_id,
    v_titular_id, p_monto, 0
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

COMMENT ON FUNCTION fn_cobrar_reserva IS
  'DEPRECADA desde la 0014. Reemplazada por fn_cobrar_persona_turno
   (cobro por persona del turno, paso 4 del módulo cuenta del turno).
   Se conserva con compatibilidad: sus INSERTs cumplen el nuevo
   CHECK reserva_pagos_desglose_check atribuyendo todo el monto al
   alquiler del titular, idéntico al comportamiento histórico. Para
   uso nuevo, usar fn_cobrar_persona_turno.';


-- ============================================================================
-- 8. CREATE OR REPLACE fn_cobrar_persona_turno
--
--    RPC nueva del paso 4. En una sola transacción atómica:
--      1. Lock de la persona + de la reserva.
--      2. Cálculo server-side de su parte (Forma B, CEIL — equivalente
--         a calcularDesgloseCuenta del frontend).
--      3. Cálculo del SALDO de la persona = parte - ya_pagado.
--      4. VALIDACIÓN CRUZADA: el monto real debe coincidir con
--         p_monto_esperado (lo que el vendedor vio en pantalla). Si
--         difiere por race con cambios concurrentes (otro vendedor
--         agregó un consumo, quitó una persona, etc.), RECHAZA con
--         mensaje claro pidiendo refrescar.
--      5. INSERT en reserva_pagos con desglose alquiler/consumo.
--      6. UPDATE escalar reservas.monto_pagado += saldo_alquiler
--         (sólo la parte de alquiler — el escalar mantiene la semántica
--         legacy de "cuánto del alquiler está cobrado").
--      7. UPDATE estado de la reserva (mismo criterio del legacy:
--         'pagada' si alquiler completo, 'senada' si parcial, 'jugada'
--         y 'cancelada' nunca se sobreescriben).
--
--    Mensajes (P0001 → dbErrors pasan directos):
--      - 'No hay sesión activa.'
--      - 'El medio de pago es obligatorio.'
--      - 'Medio de pago inválido.'
--      - 'La persona no existe o no pertenece a tu club.'
--      - 'No se puede cobrar a personas de una reserva cancelada.'
--      - 'Esta persona ya está saldada (pagó $X de $Y).'
--      - 'La cuenta del turno cambió, revisá el monto antes de cobrar
--         (esperabas $X pero el saldo real es $Y).'
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
  v_total_consumos DECIMAL(12,2);
  v_parte_alquiler DECIMAL(12,2);
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

  -- Cantidades para la división. Bajo el lock de la persona, otros
  -- inserts/deletes en reserva_jugadores de esta reserva pueden
  -- ocurrir, pero la validación cruzada con p_monto_esperado abajo
  -- atrapa cualquier discrepancia derivada.
  SELECT COUNT(*) INTO v_cantidad_jugadores
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id AND tipo = 'jugador';

  SELECT COUNT(*) INTO v_cantidad_personas
  FROM reserva_jugadores
  WHERE reserva_id = v_persona.reserva_id;

  -- Total de consumos.
  SELECT COALESCE(SUM(subtotal), 0) INTO v_total_consumos
  FROM reserva_consumos
  WHERE reserva_id = v_persona.reserva_id;

  -- Partes (Forma B con CEIL al peso — equivalente a
  -- calcularDesgloseCuenta del frontend).
  v_parte_alquiler := CASE
    WHEN v_cantidad_jugadores > 0 AND v_reserva.monto_total > 0
    THEN CEIL(v_reserva.monto_total / v_cantidad_jugadores)
    ELSE 0
  END;

  v_parte_consumo := CASE
    WHEN v_cantidad_personas > 0 AND v_total_consumos > 0
    THEN CEIL(v_total_consumos / v_cantidad_personas)
    ELSE 0
  END;

  -- Ya pagado por esta persona, desglosado.
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
  -- cambios concurrentes (otro vendedor agregó consumo o quitó persona
  -- entre el render y el cobro).
  IF p_monto_esperado IS NULL OR p_monto_esperado <> v_monto_real THEN
    RAISE EXCEPTION
      'La cuenta del turno cambió, revisá el monto antes de cobrar (esperabas $% pero el saldo real es $%).',
      COALESCE(p_monto_esperado, 0), v_monto_real;
  END IF;

  -- INSERT del pago con desglose. tipo='pago' siempre (en el modelo
  -- nuevo no hay "seña" por persona — se cobra todo o nada).
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
  -- ALQUILER (los consumos no entran al escalar — su total se
  -- consulta aparte vía reserva_consumos o vía SUM de monto_consumo
  -- en reserva_pagos).
  v_nuevo_monto_pagado := v_reserva.monto_pagado + v_saldo_alquiler;

  -- Estado: misma lógica del legacy. 'jugada' y 'cancelada' nunca se
  -- bajan; 'pagada' si alquiler completo; 'senada' si parcial y venía
  -- de 'pendiente'.
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
   reservas.monto_pagado con la parte de alquiler + UPDATE del
   estado. p_monto_esperado es validación cruzada — si cambió la
   cuenta entre el render y el cobro, rechaza con mensaje claro.';

GRANT EXECUTE ON FUNCTION fn_cobrar_persona_turno(
  BIGINT, VARCHAR, TEXT, DECIMAL
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0014_pagos_por_persona.sql
-- ============================================================================
