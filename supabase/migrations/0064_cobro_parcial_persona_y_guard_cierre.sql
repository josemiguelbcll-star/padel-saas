-- ============================================================================
-- 0064_cobro_parcial_persona_y_guard_cierre.sql
-- Cobro PARCIAL por persona del turno + cuenta elegible + guard de saldo al
-- cerrar el turno.
--
-- =====================================================================
-- POR QUÉ
-- =====================================================================
-- Hoy el cobro por persona es "todo o nada": fn_cobrar_persona_turno cobra
-- siempre el SALDO COMPLETO de la persona (no acepta un monto). El encargado
-- no puede cobrar una parte (ej. el jugador entrega $5.000 de los $8.000 que
-- debe) y dejar el resto pendiente. Esta migración:
--
--   1. fn_cobrar_persona_turno: +p_monto DECIMAL DEFAULT NULL.
--        - NULL  → cobra el saldo completo (comportamiento ACTUAL, no rompe
--          callers existentes).
--        - valor → cobra ese monto parcial (debe ser > 0 y <= saldo completo).
--      El desglose alquiler/consumo de la fila se PRORRATEA proporcional al
--      monto cobrado, de modo que monto_alquiler + monto_consumo = monto se
--      cumpla exacto (CHECK reserva_pagos_desglose_check). El consumo absorbe
--      el residuo del redondeo (mismo patrón "última absorbe el residuo" del
--      0063). p_cuenta_id (ya existente desde 0058) se sigue usando y
--      escribiendo en la fila — el hook recién ahora lo manda.
--
--   2. fn_cerrar_turno: +guard de saldo. No se cierra un turno con saldo
--      pendiente. El cálculo del saldo replica EXACTO la lógica per-persona
--      de fn_cobrar_persona_turno (Forma B, CEIL, GREATEST(0, parte-pagado)
--      por línea), así coincide con el `todoSaldado` del frontend
--      (calcularSaldosPersonas). Cobrar post-cierre seguía permitido (0054);
--      con este guard, en cambio, ya no se llega a cerrar con deuda.
--
-- =====================================================================
-- QUÉ NO TOCA / INVARIANTES PRESERVADOS
-- =====================================================================
-- - Firma compatible: p_monto al FINAL con DEFAULT NULL (igual que p_cuenta_id
--   en 0058). Llamadas existentes (4 o 5 args) siguen válidas y con idéntico
--   comportamiento.
-- - Validación cruzada con p_monto_esperado: SE CONSERVA para el caso "saldo
--   completo" (p_monto NULL). Para el caso parcial (p_monto NOT NULL), la
--   protección anti-race es p_monto <= saldo recalculado (si otro vendedor
--   bajó el saldo por debajo del monto pedido, rechaza igual).
-- - REGLA DE ORO EERR: monto_consumo sigue siendo el AGREGADO (partido+general)
--   → línea Buffet/Shop; monto_alquiler → Canchas. El prorrateo reparte DENTRO
--   de esas dos líneas, no cambia la atribución.
-- - Regla de oro del efectivo (0058): es_caja_fisica → exige caja abierta.
-- - Lock per-persona + per-reserva, recálculo de partes, UPDATE de estado:
--   intactos. El UPDATE de monto_pagado suma la parte de ALQUILER REALMENTE
--   cobrada (prorrateada); con p_monto NULL eso es exactamente el saldo de
--   alquiler de hoy.
-- - enum reservas.estado, EXCLUDE no_overlap_reservas, materialización: intactos.
--
-- NOTA sobre turnos "legacy" (pagados en el modelo anterior, todo al titular):
--   el guard de cierre es per-persona. Un turno legacy con varias personas
--   cargadas pero pagado solo al titular mostrará saldo pendiente en las otras
--   personas → el guard bloquea el cierre. Esos turnos hoy tienen el cobro por
--   persona bloqueado (banner "modelo anterior"). Es data vieja/de prueba; si
--   apareciera en producción, se resuelve con "reabrir/limpiar" o una exención
--   explícita por esLegacyPagada (no incluida acá, fuera de alcance).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. fn_cobrar_persona_turno — +p_monto (cobro parcial) + prorrateo desglose
--
--    Body basado en la versión vigente (0058: +p_cuenta_id + regla de oro del
--    efectivo generalizada a es_caja_fisica). Cambios de esta migración:
--      ⭐ Firma: +p_monto DECIMAL DEFAULT NULL (al final).
--      ⭐ DECLARE: +v_saldo_completo, +v_monto_cobrado, +v_cobro_alquiler,
--         +v_cobro_consumo (reemplazan el uso de v_monto_real como "saldo").
--      ⭐ Validación: bifurca según p_monto NULL (cruzada con p_monto_esperado,
--         igual que hoy) vs NOT NULL (0 < p_monto <= saldo completo).
--      ⭐ Monto cobrado = COALESCE(p_monto, saldo completo); desglose
--         prorrateado (consumo absorbe el residuo) → CHECK exacto.
--      ⭐ INSERT y monto_pagado usan los valores prorrateados/cobrados.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_cobrar_persona_turno(BIGINT, VARCHAR, TEXT, DECIMAL, BIGINT);

CREATE FUNCTION fn_cobrar_persona_turno(
  p_reserva_jugador_id BIGINT,
  p_medio_pago VARCHAR,
  p_observaciones TEXT,
  p_monto_esperado DECIMAL,
  p_cuenta_id BIGINT DEFAULT NULL,                          -- 0058
  p_monto DECIMAL DEFAULT NULL                              -- ⭐ NUEVO 0064
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
  v_saldo_completo DECIMAL(12,2);                           -- ⭐ NUEVO 0064 (era v_monto_real)
  v_monto_cobrado DECIMAL(12,2);                            -- ⭐ NUEVO 0064
  v_cobro_alquiler DECIMAL(12,2);                           -- ⭐ NUEVO 0064
  v_cobro_consumo DECIMAL(12,2);                            -- ⭐ NUEVO 0064
  v_parte_total DECIMAL(12,2);
  v_ya_pagado_total DECIMAL(12,2);
  v_nuevo_monto_pagado DECIMAL(12,2);
  v_nuevo_estado VARCHAR(20);
  v_pago reserva_pagos;
  v_turno_caja_id BIGINT := NULL;
  v_cuenta_id BIGINT;                                       -- 0058
  v_es_caja BOOLEAN;                                        -- 0058
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

  -- Resolver cuenta + regla de oro generalizada (0058). Falla rápido ANTES
  -- del lock.
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
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar en efectivo.';
    END IF;
  END IF;

  -- Lock de la persona del turno (serializa cobros concurrentes).
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

  -- Ya pagado por esta persona, desglosado (suma TODAS sus filas — soporta
  -- cobros parciales previos: cada parcial dejó su propia fila).
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

  v_saldo_completo := v_saldo_alquiler + v_saldo_consumo;

  -- Ya saldada (sin saldo).
  IF v_saldo_completo <= 0 THEN
    v_parte_total := CASE
      WHEN v_persona.tipo = 'jugador' THEN v_parte_alquiler + v_parte_consumo
      ELSE v_parte_consumo
    END;
    v_ya_pagado_total := v_ya_pagado_alquiler + v_ya_pagado_consumo;
    RAISE EXCEPTION 'Esta persona ya está saldada (pagó $% de $%).',
      v_ya_pagado_total, v_parte_total;
  END IF;

  -- ⭐ NUEVO 0064 — Validación bifurcada según haya monto parcial o no.
  IF p_monto IS NULL THEN
    -- Cobro del saldo COMPLETO: misma validación cruzada de siempre. Si la
    -- cuenta cambió entre el render y el cobro (otro vendedor agregó consumo,
    -- quitó persona, etc.), el monto esperado no coincide → rechaza.
    IF p_monto_esperado IS NULL OR p_monto_esperado <> v_saldo_completo THEN
      RAISE EXCEPTION
        'La cuenta del turno cambió, revisá el monto antes de cobrar (esperabas $% pero el saldo real es $%).',
        COALESCE(p_monto_esperado, 0), v_saldo_completo;
    END IF;
  ELSE
    -- Cobro PARCIAL: el monto debe ser > 0 y no superar el saldo recalculado.
    -- (Esto también cubre el race: si el saldo bajó por debajo del monto
    -- pedido, rechaza con el saldo real.)
    IF p_monto <= 0 THEN
      RAISE EXCEPTION 'El monto a cobrar debe ser mayor a 0.';
    END IF;
    IF p_monto > v_saldo_completo THEN
      RAISE EXCEPTION
        'El monto a cobrar ($%) supera el saldo pendiente de esta persona ($%). Ajustá el monto.',
        p_monto, v_saldo_completo;
    END IF;
  END IF;

  -- ⭐ NUEVO 0064 — Monto efectivamente cobrado + desglose prorrateado.
  -- Con p_monto NULL: alquiler/consumo = saldos tal cual (idéntico a hoy).
  -- Con p_monto parcial: se reparte proporcional al saldo de cada línea y el
  -- CONSUMO absorbe el residuo del redondeo, garantizando
  -- monto_alquiler + monto_consumo = monto EXACTO (CHECK desglose).
  v_monto_cobrado := COALESCE(p_monto, v_saldo_completo);

  IF p_monto IS NULL THEN
    v_cobro_alquiler := v_saldo_alquiler;
    v_cobro_consumo  := v_saldo_consumo;
  ELSE
    v_cobro_alquiler := ROUND(v_saldo_alquiler * p_monto / v_saldo_completo, 2);
    v_cobro_consumo  := v_monto_cobrado - v_cobro_alquiler;  -- residuo → consumo
  END IF;

  -- INSERT del pago. monto_consumo es el AGREGADO (partido+general) — REGLA
  -- DE ORO: todo el consumo es línea Buffet/Shop en el EERR. cuenta_id y
  -- turno_caja_id como en 0058.
  INSERT INTO reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, usuario_id, observaciones,
    jugador_id,
    reserva_jugador_id, monto_alquiler, monto_consumo,
    turno_caja_id, cuenta_id
  ) VALUES (
    v_club_id, v_persona.reserva_id, v_monto_cobrado, p_medio_pago, 'pago', v_usuario_id, p_observaciones,
    v_persona.jugador_id,
    p_reserva_jugador_id, v_cobro_alquiler, v_cobro_consumo,
    v_turno_caja_id, v_cuenta_id
  )
  RETURNING * INTO v_pago;

  -- Escalar monto_pagado de la reserva: suma la parte de ALQUILER REALMENTE
  -- cobrada (prorrateada). Con p_monto NULL = saldo de alquiler (igual a hoy).
  v_nuevo_monto_pagado := v_reserva.monto_pagado + v_cobro_alquiler;

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
  'Cobro por persona del turno (división Forma B). 0023: regla de oro del
   efectivo. 0058: +p_cuenta_id, cuenta_id + atado a caja por es_caja_fisica.
   0064: +p_monto (cobro PARCIAL) — NULL cobra el saldo completo (comportamiento
   previo), valor cobra 0<monto<=saldo con desglose alquiler/consumo prorrateado
   (consumo absorbe el residuo → CHECK exacto). Validación cruzada con
   p_monto_esperado sólo en el caso saldo completo.';

GRANT EXECUTE ON FUNCTION fn_cobrar_persona_turno(
  BIGINT, VARCHAR, TEXT, DECIMAL, BIGINT, DECIMAL
) TO authenticated;


-- ============================================================================
-- 2. fn_cerrar_turno — +guard de saldo (no cierra con deuda pendiente)
--
--    Misma firma (BIGINT) → CREATE OR REPLACE. Se agrega, después de las
--    guardas existentes (no cancelado / no ya cerrado), el cálculo del saldo
--    total pendiente del turno. Replica EXACTO la lógica per-persona de
--    fn_cobrar_persona_turno y de calcularSaldosPersonas (frontend):
--      - parte alquiler / jugador    = CEIL(monto_total / cant_jug)
--      - parte consumo partido / jug = CEIL(total_partido / cant_jug)
--      - parte consumo general / per = CEIL(total_general / cant_pers)
--      - saldo persona = GREATEST(0, parte_alq - pagado_alq)
--                      + GREATEST(0, parte_cons - pagado_cons)
--    Si SUM(saldo persona) > 0 → RAISE con el total pendiente.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cerrar_turno(p_reserva_id BIGINT)
RETURNS reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_reserva reservas;
  v_cantidad_jugadores INT;
  v_cantidad_personas INT;
  v_total_consumos_partido DECIMAL(12,2);
  v_total_consumos_general DECIMAL(12,2);
  v_parte_alquiler DECIMAL(12,2);
  v_parte_consumo_partido DECIMAL(12,2);
  v_parte_consumo_general DECIMAL(12,2);
  v_total_pendiente DECIMAL(12,2);
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Lock de la reserva + validación de tenant.
  SELECT * INTO v_reserva
  FROM reservas
  WHERE id = p_reserva_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La reserva no existe o no pertenece a tu club.';
  END IF;

  -- No se cierra un turno cancelado.
  IF v_reserva.estado = 'cancelada' THEN
    RAISE EXCEPTION 'No se puede cerrar un turno cancelado.';
  END IF;

  -- Ya cerrado → mensaje claro (no-op suave).
  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'El turno ya está cerrado.';
  END IF;

  -- ⭐ NUEVO 0064 — Guard de saldo: no se cierra con deuda pendiente.
  -- Partes base del turno (mismo cálculo que fn_cobrar_persona_turno).
  SELECT
    COUNT(*) FILTER (WHERE tipo = 'jugador'),
    COUNT(*)
  INTO v_cantidad_jugadores, v_cantidad_personas
  FROM reserva_jugadores
  WHERE reserva_id = p_reserva_id;

  SELECT
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'partido'), 0),
    COALESCE(SUM(subtotal) FILTER (WHERE tipo_reparto = 'general'), 0)
  INTO v_total_consumos_partido, v_total_consumos_general
  FROM reserva_consumos
  WHERE reserva_id = p_reserva_id;

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

  -- Saldo total pendiente = suma, sobre cada persona, de su saldo per-línea
  -- (GREATEST(0, parte - pagado)). Los pagos se agregan por reserva_jugador_id
  -- (incluye los parciales del 0064 — varias filas por persona).
  SELECT COALESCE(SUM(
      GREATEST(
        0,
        (CASE WHEN rj.tipo = 'jugador' THEN v_parte_alquiler ELSE 0 END)
          - COALESCE(p.pagado_alquiler, 0)
      )
      + GREATEST(
        0,
        (CASE
           WHEN rj.tipo = 'jugador'
           THEN v_parte_consumo_partido + v_parte_consumo_general
           ELSE v_parte_consumo_general
         END)
          - COALESCE(p.pagado_consumo, 0)
      )
    ), 0)
  INTO v_total_pendiente
  FROM reserva_jugadores rj
  LEFT JOIN (
    SELECT reserva_jugador_id,
           SUM(monto_alquiler) AS pagado_alquiler,
           SUM(monto_consumo)  AS pagado_consumo
    FROM reserva_pagos
    WHERE reserva_id = p_reserva_id
      AND reserva_jugador_id IS NOT NULL
    GROUP BY reserva_jugador_id
  ) p ON p.reserva_jugador_id = rj.id
  WHERE rj.reserva_id = p_reserva_id;

  -- ⭐ NUEVO 0064 — Exención legacy: un turno pagado en el modelo anterior
  -- (estado='pagada' Y sin NINGÚN pago atado a persona — todo se cobró al
  -- titular vía el escalar) no tiene saldo per-persona consistente y tiene el
  -- cobro por persona bloqueado en la UI. Esos turnos se pueden cerrar sin
  -- pasar el guard de saldo (de lo contrario quedarían sin poder cerrarse).
  IF v_total_pendiente > 0
     AND NOT (
       v_reserva.estado = 'pagada'
       AND NOT EXISTS (
         SELECT 1 FROM reserva_pagos
         WHERE reserva_id = p_reserva_id
           AND reserva_jugador_id IS NOT NULL
       )
     )
  THEN
    RAISE EXCEPTION
      'El turno tiene saldo pendiente de $%. Saldá el cobro antes de cerrar.',
      v_total_pendiente;
  END IF;

  -- OK: cerrar. Cerrado es terminal: la 0054 impide cargar consumos; con el
  -- guard de arriba ya no se llega a cerrar con deuda.
  UPDATE reservas
  SET cerrado_en = NOW()
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_cerrar_turno(BIGINT) IS
  'Cierra manualmente un turno (cerrado_en = NOW()). Terminal: no admite cargar
   consumos después (guarda en fn_cargar_consumo_turno, 0054). 0064: agrega
   guard de saldo — rechaza si alguna persona del turno tiene saldo > 0 (mismo
   cálculo per-persona que fn_cobrar_persona_turno / calcularSaldosPersonas).
   Rechaza turnos cancelados o ya cerrados. Gate admin/vendedor (sesión válida).';

GRANT EXECUTE ON FUNCTION fn_cerrar_turno(BIGINT) TO authenticated;

COMMIT;

-- ============================================================================
-- Fin de la migración 0064_cobro_parcial_persona_y_guard_cierre.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Como vendedor del club, con caja abierta:
--
-- A. Cobro saldo completo (compat, p_monto omitido) → idéntico a hoy:
--    await window.supabase.rpc('fn_cobrar_persona_turno', {
--      p_reserva_jugador_id: X, p_medio_pago: 'efectivo',
--      p_observaciones: null, p_monto_esperado: <saldo> });
--    → inserta una fila por el saldo completo; persona queda saldada.
--
-- B. Cobro PARCIAL (p_monto < saldo) → deja saldo pendiente:
--    rpc('fn_cobrar_persona_turno', { p_reserva_jugador_id: X,
--      p_medio_pago: 'efectivo', p_observaciones: null,
--      p_monto_esperado: <saldo>, p_cuenta_id: null, p_monto: 5000 });
--    → fila con monto=5000; monto_alquiler + monto_consumo = 5000 (CHECK ok);
--      la persona sigue con saldo = (saldo - 5000).
--
-- C. Cobro parcial que supera el saldo → RECHAZA:
--    p_monto > saldo → 'El monto a cobrar ($...) supera el saldo pendiente...'
--
-- D. Cobro parcial con monto <= 0 → 'El monto a cobrar debe ser mayor a 0.'
--
-- E. Cierre con saldo pendiente → RECHAZA:
--    rpc('fn_cerrar_turno', { p_reserva_id: X });
--    → 'El turno tiene saldo pendiente de $.... Saldá el cobro antes de cerrar.'
--
-- F. Cierre con todo saldado → OK (cerrado_en = NOW()).
--
-- G. Verificar desglose prorrateado de un parcial sobre un turno con alquiler
--    Y consumo: SELECT monto, monto_alquiler, monto_consumo FROM reserva_pagos
--    WHERE id = <nuevo>;  → suma exacta, proporción ~ a los saldos de cada línea.
-- ============================================================================
