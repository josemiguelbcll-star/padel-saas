-- ============================================================================
-- 0054_ciclo_vida_turno_cerrado.sql
-- Capa operativa del ciclo de vida del turno: campo `cerrado_en` + vista
-- derivada + cierre TERMINAL (bloquea cargar consumos a un turno cerrado).
--
-- =====================================================================
-- QUÉ HACE
-- =====================================================================
-- 1. ALTER reservas ADD COLUMN cerrado_en TIMESTAMPTZ NULL.
--    NO toca el enum `estado` ni el EXCLUDE `no_overlap_reservas`.
-- 2. Índice parcial para la alarma de "turnos viejos sin cerrar".
-- 3. VIEW v_reservas_operativas (security_invoker) = reservas.* + dos
--    flags EXISTS (tiene_consumo, tiene_pago). Fuente de los booleanos
--    para derivar el estado operativo (RESERVADO/ABIERTO/CERRADO/CANCELADO)
--    y para la alarma cross-día.
-- 4. CREATE OR REPLACE fn_cargar_consumo_turno: idéntica a la 0053
--    (debounce anti-doble-submit incluido), con UNA sola guarda nueva:
--    un turno CERRADO (cerrado_en IS NOT NULL) es terminal y NO admite
--    cargar consumos. COBRAR sí sigue permitido post-cierre (eso vive en
--    las funciones de cobro, que esta migración NO toca).
--
-- =====================================================================
-- QUÉ NO TOCA
-- =====================================================================
-- - enum reservas.estado (CHECK de 5 valores intacto).
-- - EXCLUDE no_overlap_reservas (cancelar sigue seteando estado='cancelada'
--   en otra RPC; el slot se libera igual).
-- - funciones de cobro (fn_cobrar_reserva, fn_cobrar_persona_turno).
-- - la guarda 'cancelada' existente (se AGREGA la de cerrado_en al lado).
-- - materialización de turnos fijos.
--
-- PENDIENTE FUTURO (no en esta migración): "reabrir turno" (admin limpia
-- cerrado_en) si se cerró por error.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Campo nuevo: cerrado_en
-- ============================================================================
ALTER TABLE reservas ADD COLUMN cerrado_en TIMESTAMPTZ NULL;

COMMENT ON COLUMN reservas.cerrado_en IS
  'Cierre MANUAL del turno (lo apreta el vendedor). NULL = no cerrado.
   Estado operativo CERRADO se deriva de esta columna. Cerrado es
   terminal: no se cargan consumos nuevos (cobrar sí, para saldar deuda).
   NO participa del enum estado ni del EXCLUDE no_overlap_reservas.';

-- ============================================================================
-- 2. Índice parcial para la alarma de turnos viejos sin cerrar
-- ============================================================================
-- La alarma busca reservas con actividad de fecha anterior a hoy que nunca
-- se cerraron. Indexar solo lo "vivo" (no cerrado y no cancelado) mantiene
-- el índice chico y el query barato.
CREATE INDEX idx_reservas_abiertas ON reservas (club_id, fecha)
  WHERE cerrado_en IS NULL AND estado != 'cancelada';

-- ============================================================================
-- 3. VIEW v_reservas_operativas
-- ============================================================================
-- reservas.* + flags de existencia de consumo/pago. Con security_invoker
-- la view ejecuta con los permisos del que consulta → la RLS de reservas,
-- reserva_consumos y reserva_pagos sigue aplicando (sin esto, una view es
-- del owner y leakearía entre clubes).
CREATE VIEW v_reservas_operativas
WITH (security_invoker = true) AS
SELECT
  r.*,
  EXISTS (
    SELECT 1 FROM reserva_consumos rc WHERE rc.reserva_id = r.id
  ) AS tiene_consumo,
  EXISTS (
    SELECT 1 FROM reserva_pagos rp WHERE rp.reserva_id = r.id
  ) AS tiene_pago
FROM reservas r;

GRANT SELECT ON v_reservas_operativas TO authenticated;

COMMENT ON VIEW v_reservas_operativas IS
  'reservas + tiene_consumo/tiene_pago (EXISTS). security_invoker=true: la
   RLS de las tablas base aplica al consultante. El estado operativo
   (reservado/abierto/cerrado/cancelado) se deriva en el frontend con now()
   (función derivarEstadoOperativo); esta view aporta los hechos de la DB y
   alimenta la alarma cross-día de turnos viejos sin cerrar.';

-- ============================================================================
-- 4. fn_cargar_consumo_turno — idéntica a la 0053 + guarda de cierre
-- ============================================================================
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

  -- ⭐ AGREGADO 0054 — CERRADO es terminal: no se cargan consumos nuevos.
  -- Cobrar SÍ se permite post-cierre (para saldar deuda) — eso vive en las
  -- funciones de cobro, que esta migración no toca. Guarda nueva, al lado
  -- de la de 'cancelada'; no modifica ninguna otra lógica.
  IF v_reserva.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION
      'No se pueden cargar consumos a un turno cerrado.';
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

  -- ⭐ AGREGADO 0053 — DEBOUNCE ANTI-DOBLE-SUBMIT (server-side).
  -- Bajo el FOR UPDATE del producto (que serializa la ráfaga del mismo
  -- producto), buscamos un consumo IDÉNTICO insertado en los últimos
  -- 2 segundos. Si existe, es el doble-tap accidental: NO insertamos
  -- consumo NI movimiento de stock (CRÍTICO — insertar el movimiento
  -- descontaría el stock por segunda vez, que es el otro lado del bug)
  -- y devolvemos la fila ya existente. No-op idempotente y silencioso.
  -- El intervalo de 2s va como literal: es una constante técnica
  -- anti-ráfaga, no configuración de negocio por club.
  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE club_id      = v_club_id
    AND reserva_id   = p_reserva_id
    AND producto_id  = v_producto.id
    AND cantidad     = p_cantidad
    AND tipo_reparto = p_tipo_reparto
    AND usuario_id   = v_usuario_id
    AND fecha_hora  >= NOW() - INTERVAL '2 seconds'
  ORDER BY fecha_hora DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    -- Ráfaga accidental: devolvemos la fila idéntica más reciente sin
    -- tocar reserva_consumos ni movimientos_stock. El stock ya fue
    -- descontado UNA sola vez por la inserción legítima anterior.
    RETURN v_consumo;
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

  -- INSERT del consumo con snapshots + tipo_reparto + línea.
  -- El snapshot de `linea` se MANTIENE (introducido en 0025): sirve
  -- para el EERR (saber si lo cargado al turno fue buffet o shop).
  -- Ahora la línea snapshot puede ser 'buffet' O 'shop' (antes de la
  -- 0026 siempre era 'buffet' por el check removido; ahora refleja
  -- la línea real del producto).
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id,
    tipo_reparto,
    linea
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id,
    p_tipo_reparto,
    v_producto.linea
  )
  RETURNING * INTO v_consumo;

  -- INSERT movimiento de salida atado al consumo nuevo (sin cambios).
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
  'Carga un consumo al turno. 0026: acepta cualquier producto activo.
   0053: debounce anti-doble-submit (consumo idéntico en <2s bajo el
   FOR UPDATE → no-op idempotente). 0054: rechaza si el turno está
   cerrado (cerrado_en IS NOT NULL) — cerrado es terminal. Cobrar sí
   se permite post-cierre.';

COMMIT;

-- ============================================================================
-- Fin de la migración 0054_ciclo_vida_turno_cerrado.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- A. Columna creada:
--    SELECT cerrado_en FROM reservas LIMIT 1;  → existe, NULL por defecto.
-- B. Índice parcial:
--    \d+ reservas  → idx_reservas_abiertas (partial, WHERE cerrado_en IS NULL
--    AND estado != 'cancelada').
-- C. View con RLS del consultante:
--    SELECT id, tiene_consumo, tiene_pago, cerrado_en
--    FROM v_reservas_operativas LIMIT 5;  → solo reservas de TU club.
-- D. Guarda de cierre (como vendedor del club):
--    1) Cerrar un turno: UPDATE reservas SET cerrado_en = NOW() WHERE id = X;
--    2) await window.supabase.rpc('fn_cargar_consumo_turno', {
--         p_reserva_id: X, p_producto_id: <activo>, p_cantidad: 1,
--         p_tipo_reparto: 'general' });
--       → ERROR: 'No se pueden cargar consumos a un turno cerrado.'
-- E. Debounce 0053 intacto: cargar 2 veces el mismo producto al mismo turno
--    (no cerrado) con <2s → segunda llamada devuelve la fila existente, sin
--    duplicar stock.
-- ============================================================================
