-- ============================================================================
-- 0013_consumos_turno.sql
-- Cuenta del turno — Paso 2: cargar consumos del buffet al turno
--
-- Tercera etapa del módulo "cuenta del turno tipo restaurante" (ver
-- "Visión de producto: el turno como cuenta" en CLAUDE.md). Después de
-- enriquecer la ficha de jugadores (0011) y modelar las personas del
-- turno (0012), ahora sumamos los consumos: productos del buffet
-- cargados a la cuenta del turno, separados de las ventas de mostrador.
--
-- Esta migración hace cinco cosas:
--
--   1. Crea la tabla `reserva_consumos`: cada fila es un producto
--      cargado al turno con snapshots de nombre/precio/costo (mismo
--      patrón que venta_items). FK reserva_id ON DELETE RESTRICT (es
--      plata/stock — la trazabilidad gana).
--
--   2. Agrega columna `reserva_consumo_id` a movimientos_stock para
--      atar la salida de stock al consumo que la originó (auditoría).
--      FK ON DELETE SET NULL (ver "Modelo B" abajo).
--
--   3. Re-crea los 2 CHECKs viejos de movimientos_stock para sumar las
--      dos fuentes nuevas:
--        - 'consumo_turno'      → salida por carga al turno
--        - 'reposicion_consumo' → entrada por quitado de un consumo
--      Sin tocar el CHECK `cantidad <> 0` (no aplica).
--
--   4. RPC `fn_cargar_consumo_turno`: valida stock + atómicamente
--      inserta el consumo y el movimiento de salida.
--
--   5. RPC `fn_quitar_consumo_turno` (multi-tabla, atómica):
--        a. Inserta movimiento de reposición (fuente='reposicion_consumo',
--           cantidad positiva).
--        b. Borra la fila de `reserva_consumos`. El movimiento de SALIDA
--           original NO se borra: queda como evidencia histórica del
--           libro con `reserva_consumo_id=NULL` (vía ON DELETE SET NULL).
--
-- DECISIÓN CLAVE — "Modelo B" para quitar consumo:
-- ─────────────────────────────────────────────────────────────────────
-- El movimiento de salida original NO se borra cuando se quita un
-- consumo. Esto preserva la auditabilidad del libro de inventario (la
-- promesa estructural de movimientos_stock desde 0009: cada salida
-- queda registrada para siempre). En su lugar:
--   - Se inserta un movimiento NUEVO de reposición (positivo) con
--     fuente 'reposicion_consumo' (explícita, distinguible de 'ajuste'
--     genérico — los reportes pueden cuantificar "stock movido por
--     quitados de turno" sin confundir con ajustes manuales).
--   - Se borra la fila de `reserva_consumos`. El FK SET NULL deja el
--     movimiento original con `reserva_consumo_id=NULL` y `fuente=
--     'consumo_turno'` — sigue contando para el cálculo de stock (y
--     se cancela aritméticamente con el movimiento de reposición).
--
-- IMPLICANCIA en el CHECK de coherencia:
-- ─────────────────────────────────────────────────────────────────────
-- Para `fuente='consumo_turno'`, la rama del CHECK NO exige
-- `reserva_consumo_id IS NOT NULL`. Razón: al borrar el consumo, el FK
-- SET NULL deja el movimiento con `reserva_consumo_id=NULL`; si el
-- CHECK fuera estricto, el SET NULL fallaría. La garantía de
-- "consumo_turno tiene reserva_consumo_id al INSERT" la sostiene la
-- RPC `fn_cargar_consumo_turno`, NO el CHECK (similar a cómo otras
-- garantías estructurales del codebase viven en RPCs cuando no se
-- pueden expresar como CHECK puro). Documentado en el COMMENT del
-- constraint.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). NO toca:
--   - RLS de movimientos_stock (siguen como 0009).
--   - CHECK `movimientos_stock_cantidad_check` (cantidad <> 0, sigue).
--   - Ventas de mostrador (`ventas`, `venta_items`, `fn_cerrar_venta`).
--   - Cobro del alquiler (`fn_cobrar_reserva`, `reserva_pagos`).
--   - Personas del turno (`reserva_jugadores`, RPCs del 0012).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: reserva_consumos
--
--    Cada fila = un producto cargado a la cuenta del turno.
--
--    Snapshots: producto_nombre, precio_unitario, costo_unitario,
--    subtotal — igual que venta_items. Si el producto cambia (o se
--    borra) después, el total del turno y el margen siguen siendo
--    fieles al momento de la carga.
--
--    costo_unitario nullable: el producto puede no tener costo cargado
--    (ver decisión de la 0010 — sinceridad del dato). En ese caso el
--    margen del consumo es "no calculable" para reportes.
--
--    reserva_id ON DELETE RESTRICT: aunque las reservas no se borran
--    desde la UI (se cancelan), si admin algún día intenta borrar una
--    reserva con consumos vía SQL, el FK lo frena. Lo obliga a quitar
--    los consumos primero (que reponen stock atómicamente). Coherente
--    con la trazabilidad de plata del resto del codebase.
--
--    producto_id ON DELETE RESTRICT: el trigger anti-borrado de
--    productos (0009) ya cubre el mensaje accionable, porque los
--    consumos generan movimientos_stock que activan el chequeo
--    existente.
-- ============================================================================
CREATE TABLE reserva_consumos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  reserva_id BIGINT NOT NULL REFERENCES reservas(id) ON DELETE RESTRICT,
  producto_id BIGINT NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  producto_nombre VARCHAR(120) NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL CHECK (precio_unitario >= 0),
  costo_unitario DECIMAL(12,2) CHECK (costo_unitario >= 0),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reserva_consumos_reserva ON reserva_consumos(reserva_id);
CREATE INDEX idx_reserva_consumos_club_fecha
  ON reserva_consumos(club_id, fecha_hora);
CREATE INDEX idx_reserva_consumos_producto ON reserva_consumos(producto_id);

COMMENT ON TABLE reserva_consumos IS
  'Consumos de buffet cargados a una reserva (cuenta del turno tipo
   restaurante). Cada fila representa un producto vendido como parte de
   la cuenta del turno (NO de una venta de mostrador — esa va en
   ventas/venta_items).

   Cada consumo dispara un movimiento de stock fuente=consumo_turno
   apuntado vía movimientos_stock.reserva_consumo_id. Si el consumo se
   quita (fn_quitar_consumo_turno):
     1. Se inserta un movimiento fuente=reposicion_consumo (positivo)
        que devuelve el producto al inventario.
     2. Se borra la fila de reserva_consumos. El FK ON DELETE SET NULL
        deja el movimiento de salida original con reserva_consumo_id=
        NULL — queda como evidencia histórica del libro (NO se borra,
        preserva la auditabilidad de movimientos_stock).

   Snapshots de nombre/precio/costo al cargar — el total del turno y
   los reportes de margen son fieles aunque el producto cambie
   después.';

COMMENT ON COLUMN reserva_consumos.costo_unitario IS
  'Snapshot del costo del producto al momento de la carga. NULL si el
   producto no tenía costo cargado (ver decisión de la 0010). Margen
   "no calculable" para esta línea en reportes.';


-- ============================================================================
-- 2. GRANT sobre tabla y secuencia (RLS filtra después)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON reserva_consumos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE reserva_consumos_id_seq TO authenticated;


-- ============================================================================
-- 3. RLS — reserva_consumos
--
--    SELECT + INSERT + DELETE: abiertos a authenticated del club.
--      - INSERT: el vendedor carga consumos al turno (operativo, igual
--        que cobrar reservas).
--      - DELETE: el vendedor quita consumos al vuelo si se equivocó
--        ("ay no era Coca era Sprite") — patrón operativo, no destructivo
--        (la reposición es automática vía la RPC).
--    UPDATE: sólo admin. No hay caso operativo (editar un consumo no
--    existe en la UI — se quita y se carga uno nuevo). Defensivo.
-- ============================================================================
ALTER TABLE reserva_consumos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reserva_consumos_select"
ON reserva_consumos FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "reserva_consumos_insert"
ON reserva_consumos FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "reserva_consumos_delete"
ON reserva_consumos FOR DELETE TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "reserva_consumos_update_solo_admin"
ON reserva_consumos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 4. ALTER movimientos_stock: nueva columna reserva_consumo_id
--
--    FK ON DELETE SET NULL — clave del Modelo B:
--    cuando se borra un consumo (vía fn_quitar_consumo_turno), el
--    movimiento de salida original queda con reserva_consumo_id=NULL
--    pero la fila NO se borra. El libro de inventario preserva la
--    evidencia "salió por consumo del turno (origen ya no rastreable)"
--    y el movimiento de reposición compensa aritméticamente.
-- ============================================================================
ALTER TABLE movimientos_stock
  ADD COLUMN reserva_consumo_id BIGINT
  REFERENCES reserva_consumos(id) ON DELETE SET NULL;

CREATE INDEX idx_mov_stock_reserva_consumo
  ON movimientos_stock(reserva_consumo_id)
  WHERE reserva_consumo_id IS NOT NULL;

COMMENT ON COLUMN movimientos_stock.reserva_consumo_id IS
  'FK al consumo que originó este movimiento (sólo para fuentes
   consumo_turno y reposicion_consumo). ON DELETE SET NULL: al quitar
   un consumo del turno, el FK se desvincula pero el movimiento de
   salida queda en el libro como evidencia histórica.';


-- ============================================================================
-- 5. Reemplazar los 2 CHECKs viejos de movimientos_stock
--
--    Nombres verificados en pg_constraint de la base actual:
--      - movimientos_stock_fuente_check    → CHECK del enum de fuente
--      - mov_stock_coherencia_fuente       → CHECK de coherencia
--      - movimientos_stock_cantidad_check  → cantidad <> 0 (NO se toca)
--
--    Usamos IF EXISTS por idempotencia (mismo patrón que la 0012).
-- ============================================================================
ALTER TABLE movimientos_stock
  DROP CONSTRAINT IF EXISTS movimientos_stock_fuente_check;

ALTER TABLE movimientos_stock
  DROP CONSTRAINT IF EXISTS mov_stock_coherencia_fuente;

-- ---------- 5.a. Enum de fuente con las 2 fuentes nuevas ----------
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_fuente_enum CHECK (
    fuente IN (
      'compra_manual',
      'venta',
      'ajuste',
      'compra_bot_whatsapp',
      'consumo_turno',
      'reposicion_consumo'
    )
  );

-- ---------- 5.b. Coherencia fuente ↔ signo ↔ venta_id ↔ reserva_consumo_id ----------
--
-- Para `consumo_turno`: NO exigimos reserva_consumo_id NOT NULL en el
-- CHECK porque al borrar el consumo el SET NULL del FK dejaría la
-- fila con reserva_consumo_id=NULL y un CHECK estricto fallaría. La
-- garantía "consumo_turno tiene reserva_consumo_id al INSERT" la
-- sostiene fn_cargar_consumo_turno.
--
-- Para `reposicion_consumo`: reserva_consumo_id es NULL (la reposición
-- se inserta JUSTO ANTES de borrar el consumo; no apunta a él —
-- el contexto se documenta en observaciones del movimiento).
ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_coherencia_fuente CHECK (
    (fuente = 'venta'
        AND cantidad < 0
        AND venta_id IS NOT NULL
        AND reserva_consumo_id IS NULL)
    OR (fuente = 'consumo_turno'
        AND cantidad < 0
        AND venta_id IS NULL)
    OR (fuente = 'reposicion_consumo'
        AND cantidad > 0
        AND venta_id IS NULL
        AND reserva_consumo_id IS NULL)
    OR (fuente IN ('compra_manual','compra_bot_whatsapp')
        AND cantidad > 0
        AND venta_id IS NULL
        AND reserva_consumo_id IS NULL)
    OR (fuente = 'ajuste'
        AND venta_id IS NULL
        AND reserva_consumo_id IS NULL)
  );

COMMENT ON CONSTRAINT mov_stock_coherencia_fuente ON movimientos_stock IS
  'Coherencia fuente ↔ signo ↔ venta_id ↔ reserva_consumo_id. Para
   consumo_turno no se exige reserva_consumo_id NOT NULL en el CHECK
   (ver header de la 0013): al quitar un consumo el SET NULL del FK
   dejaría el movimiento con reserva_consumo_id=NULL y un CHECK
   estricto fallaría. La garantía "consumo_turno tiene reserva_consumo_id
   al INSERT" la pone fn_cargar_consumo_turno.';


-- ============================================================================
-- 6. RPC: fn_cargar_consumo_turno
--
--    Atómica (regla CLAUDE.md nº 6). En una sola transacción:
--      1. Valida session, cantidad, reserva, producto.
--      2. SELECT FOR UPDATE del producto (lock para evitar oversold
--         concurrente con ventas o cargas paralelas de stock).
--      3. Verifica stock suficiente.
--      4. INSERT en reserva_consumos con snapshots de nombre/precio/costo.
--      5. INSERT en movimientos_stock (fuente='consumo_turno', cantidad
--         negativa, reserva_consumo_id apuntando al consumo nuevo).
--      6. RETURN la fila de reserva_consumos.
--
--    Mensajes (todos P0001 → pasan directo via dbErrors):
--      - 'No hay sesión activa.'
--      - 'La cantidad debe ser mayor a 0.'
--      - 'La reserva no existe o no pertenece a tu club.'
--      - 'No se pueden cargar consumos a una reserva cancelada.'
--      - 'El producto no existe o no pertenece a tu club.'
--      - 'El producto "X" está desactivado, no se puede vender.'
--      - 'Stock insuficiente de "X": hay Y unidades, querés cargar Z.'
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_cargar_consumo_turno(
  p_reserva_id BIGINT,
  p_producto_id BIGINT,
  p_cantidad INT
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

  -- INSERT consumo con snapshots.
  INSERT INTO reserva_consumos (
    club_id, reserva_id, producto_id,
    producto_nombre, precio_unitario, costo_unitario,
    cantidad, subtotal, usuario_id
  ) VALUES (
    v_club_id, p_reserva_id, v_producto.id,
    v_producto.nombre, v_producto.precio, v_producto.costo,
    p_cantidad, v_producto.precio * p_cantidad, v_usuario_id
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
  'Carga un producto a la cuenta del turno. Atómica: INSERT en
   reserva_consumos (con snapshot de precio/costo) + INSERT en
   movimientos_stock (salida, fuente=consumo_turno). SELECT FOR UPDATE
   del producto previene oversold concurrente. Valida stock, producto
   activo, reserva no-cancelada y pertenencia al club.';

GRANT EXECUTE ON FUNCTION fn_cargar_consumo_turno(
  BIGINT, BIGINT, INT
) TO authenticated;


-- ============================================================================
-- 7. RPC: fn_quitar_consumo_turno
--
--    Atómica multi-tabla (Modelo B del header):
--      1. SELECT FOR UPDATE del consumo (lock para race contra quitar
--         concurrente).
--      2. Valida pertenencia al club.
--      3. INSERT movimiento de REPOSICIÓN: fuente='reposicion_consumo',
--         cantidad positiva, observaciones documentando el origen.
--      4. DELETE de reserva_consumos. ON DELETE SET NULL del FK deja el
--         movimiento de SALIDA original con reserva_consumo_id=NULL
--         (no se borra: preserva el libro).
--
--    Resultado en movimientos_stock para el producto:
--      - Movimiento original   -X  (fuente=consumo_turno, reserva_consumo_id=NULL después del DELETE)
--      - Movimiento reposición +X  (fuente=reposicion_consumo)
--      Suma neta: 0. Stock del producto vuelve al original.
--
--    Mensajes (P0001 → pasan directo via dbErrors):
--      - 'No hay sesión activa.'
--      - 'El consumo no existe o no pertenece a tu club.'
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_quitar_consumo_turno(
  p_consumo_id BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_consumo reserva_consumos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  -- Lock del consumo: dos quitar-concurrentes del mismo consumo se
  -- serializan; el segundo ve que ya fue borrado y falla limpiamente.
  SELECT * INTO v_consumo
  FROM reserva_consumos
  WHERE id = p_consumo_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El consumo no existe o no pertenece a tu club.';
  END IF;

  -- INSERT movimiento de reposición. Las observaciones documentan el
  -- origen para auditoría (el movimiento original queda en el libro
  -- pero pierde el FK al consumo después del DELETE).
  INSERT INTO movimientos_stock (
    club_id, producto_id, cantidad, fuente,
    venta_id, reserva_consumo_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_consumo.producto_id, v_consumo.cantidad, 'reposicion_consumo',
    NULL, NULL,
    format('Reposición por quitado del consumo #%s del turno #%s',
           v_consumo.id, v_consumo.reserva_id),
    v_usuario_id
  );

  -- DELETE del consumo. ON DELETE SET NULL del FK deja el movimiento
  -- original (cantidad negativa, fuente='consumo_turno') con
  -- reserva_consumo_id=NULL pero la fila NO se borra.
  DELETE FROM reserva_consumos WHERE id = p_consumo_id;
END;
$$;

COMMENT ON FUNCTION fn_quitar_consumo_turno IS
  'Quita un consumo del turno y repone el stock (Modelo B del 0013).
   Multi-tabla atómica: INSERT movimiento de reposición
   (fuente=reposicion_consumo, cantidad positiva) + DELETE de
   reserva_consumos. El movimiento de SALIDA original NO se borra: el
   FK ON DELETE SET NULL lo desvincula pero queda como evidencia
   histórica del libro de inventario. Stock neto del producto vuelve
   al valor previo a la carga.';

GRANT EXECUTE ON FUNCTION fn_quitar_consumo_turno(BIGINT) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0013_consumos_turno.sql
-- ============================================================================
