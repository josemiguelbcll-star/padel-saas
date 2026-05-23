-- ============================================================================
-- 0039_compras_unificadas.sql
-- Compra unificada con Precio Promedio Ponderado (PPP). Nueva tabla
-- `compras` (cabecera) + `compra_items` (detalle). La RPC
-- fn_registrar_compra atómicamente:
--   1. Valida proveedor + línea + items.
--   2. Lockea productos en orden ASC (no deadlock con fn_cerrar_venta).
--   3. Calcula PPP por producto sobre stock_actual + costo previo.
--   4. INSERT compras + compra_items + movimientos_stock (compra_id FK).
--   5. UPDATE productos.costo con el nuevo PPP.
--   6. Crea el gasto vía fn_registrar_gasto (ahora con p_proveedor_id).
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- - ALTER `categorias_gasto`: + es_mercaderia BOOLEAN + UNIQUE parcial
--   por unidad. Backfill por nombre default del seed.
-- - ALTER `gastos`: + proveedor_id FK a proveedores (ON DELETE SET NULL).
-- - ALTER `movimientos_stock`: + compra_id FK a compras (ON DELETE
--   RESTRICT) + reemplazo del CHECK mov_stock_coherencia_fuente para
--   acotar compra_id a fuentes de compra.
-- - CREATE TABLE `compras` (cabecera) y `compra_items` (detalle), RLS
--   + GRANTs idéntica a productos.
-- - DROP + CREATE fn_registrar_gasto: 8º parámetro p_proveedor_id
--   DEFAULT NULL. Snapshot del nombre desde proveedores.nombre si
--   viene proveedor_id. Compatible con las 7-param callers existentes.
-- - CREATE OR REPLACE fn_inicializar_finanzas: cuerpo IDÉNTICO al de
--   0036 (6 unidades, 23 categorías) + UPDATE final que marca las 2
--   categorías de mercadería con es_mercaderia=TRUE.
-- - CREATE fn_registrar_compra: RPC nueva, admin only.
--
-- NO toca:
-- - fn_cerrar_venta (sigue snapshoteando v_producto.costo — ahora
--   alimentado por PPP).
-- - fn_cargar_consumo_turno (idem).
-- - fn_ajustar_stock (no toca costo).
-- - fn_registrar_movimiento_stock (legacy; queda viva, sin compra_id).
-- - El ABM admin de productos (useUpdateProducto) sigue como excepción
--   manual.
--
-- =====================================================================
-- FUENTE DE MOVIMIENTOS
-- =====================================================================
-- Reutilizamos fuente='compra_manual' para los movimientos generados
-- por la nueva RPC. Distinguen de las legacy por compra_id IS NOT NULL.
-- No agregamos 'compra' al enum: cero impacto en el CHECK existente y
-- semánticamente correcto.
--
-- =====================================================================
-- PPP — FÓRMULA Y BORDES
-- =====================================================================
-- SI stock_actual <= 0 OR productos.costo IS NULL:
--   nuevo_costo := costo_unitario_compra        (reinicia el promedio)
-- SINO:
--   nuevo_costo := ROUND(
--     (stock_actual * productos.costo + cantidad * costo_unitario_compra)
--     / (stock_actual + cantidad),
--   2)
--
-- Defense-in-depth: stock_actual se trunca a max(0, sum) — los CHECKs
-- vigentes no permiten salidas que dejen stock < 0, pero si ocurriera
-- no rompemos el cálculo.
--
-- stock_actual se lee BAJO el lock FOR UPDATE de productos, ANTES de
-- insertar los movimientos de esta compra. El UPDATE de productos.costo
-- se hace después de los INSERT (orden didáctico — el cálculo ya está
-- hecho en variable local).
--
-- =====================================================================
-- CONCURRENCIA — LOCKS EN ORDEN ASC
-- =====================================================================
-- PERFORM ... FOR UPDATE sobre productos ordenado ASC por id. Mismo
-- patrón que fn_cerrar_venta (0009/0025). Una compra y una venta
-- concurrentes sobre los mismos productos se serializan sin deadlock:
-- ambas toman locks en el mismo orden y la segunda espera.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1.1. ALTER categorias_gasto: + es_mercaderia + UNIQUE parcial por unidad
-- ============================================================================
ALTER TABLE categorias_gasto
  ADD COLUMN es_mercaderia BOOLEAN NOT NULL DEFAULT FALSE;

-- Máximo una categoría con es_mercaderia=TRUE por unidad (per club, porque
-- la unidad ya es per club por su FK club_id). Si una unidad no tiene
-- mercadería marcada, fn_registrar_compra falla con mensaje accionable.
CREATE UNIQUE INDEX categorias_gasto_unique_mercaderia_por_unidad
  ON categorias_gasto (unidad_id) WHERE es_mercaderia = TRUE;

COMMENT ON COLUMN categorias_gasto.es_mercaderia IS
  'TRUE = esta categoría recibe el gasto generado por fn_registrar_compra
   para productos de la unidad asociada. Máximo UNA por unidad (UNIQUE
   parcial). El seed marca Mercadería (buffet) y Mercadería shop (shop);
   si el admin renombró antes de la 0039, hay que marcarla manual desde
   Configuración → Categorías de gasto.';


-- ============================================================================
-- 1.2. ALTER gastos: + proveedor_id FK a proveedores
-- ============================================================================
-- ON DELETE SET NULL: si en el futuro se borra un proveedor (cuando exista
-- el trigger anti-DELETE con dependencias va a bloquear, pero queda red de
-- seguridad), el gasto histórico se queda sin link al catálogo pero el
-- snapshot gastos.proveedor (VARCHAR) preserva el nombre.
ALTER TABLE gastos
  ADD COLUMN proveedor_id BIGINT REFERENCES proveedores(id) ON DELETE SET NULL;

CREATE INDEX idx_gastos_proveedor_id
  ON gastos (proveedor_id) WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN gastos.proveedor_id IS
  'FK al catálogo de proveedores (0038). NULL para gastos pre-0039 o
   gastos sin proveedor del catálogo. El nombre se snapshotea siempre
   en gastos.proveedor (VARCHAR) al cargar.';


-- ============================================================================
-- 1.3. CREATE TABLE compras (cabecera)
-- ============================================================================
CREATE TABLE compras (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  -- Proveedor del catálogo. RESTRICT: no se puede borrar proveedor con
  -- compras (red de seguridad por encima de la policy DELETE de la 0038).
  proveedor_id BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE RESTRICT,

  -- Tipo de compra. Bloque 2 SOLO acepta 'compra' server-side; los
  -- otros valores existen para que el Bloque 2.5 (bonificación) y el
  -- futuro de consignación se enchufen sin migración destructiva.
  tipo VARCHAR(20) NOT NULL DEFAULT 'compra'
    CHECK (tipo IN ('compra','bonificacion','consignacion')),

  -- Línea de la compra. TODOS los items deben ser de esta línea. Resuelve
  -- a qué categoría de mercadería va el gasto generado.
  linea VARCHAR(10) NOT NULL
    CHECK (linea IN ('buffet','shop')),

  fecha_compra DATE NOT NULL,

  -- Snapshot del total al cierre = SUM(compra_items.subtotal).
  monto_total DECIMAL(12,2) NOT NULL CHECK (monto_total >= 0),

  -- FK al gasto creado por esta compra. NOT NULL en tipo='compra';
  -- NULL en bonificación/consignación (no generan gasto al recibir).
  gasto_id BIGINT REFERENCES gastos(id) ON DELETE RESTRICT,

  observaciones TEXT,

  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- CHECK: tipo='compra' implica gasto_id NOT NULL.
  -- bonificacion/consignacion: gasto_id IS NULL.
  CONSTRAINT compras_gasto_segun_tipo CHECK (
    (tipo = 'compra' AND gasto_id IS NOT NULL)
    OR (tipo IN ('bonificacion','consignacion') AND gasto_id IS NULL)
  )
);

CREATE INDEX idx_compras_club_fecha
  ON compras (club_id, fecha_compra DESC);
CREATE INDEX idx_compras_proveedor
  ON compras (proveedor_id);
CREATE INDEX idx_compras_gasto
  ON compras (gasto_id) WHERE gasto_id IS NOT NULL;
CREATE INDEX idx_compras_tipo
  ON compras (club_id, tipo);

COMMENT ON TABLE compras IS
  'Cabecera de una compra unificada. Bloque 2: solo tipo=''compra''
   (genera gasto vía fn_registrar_gasto y aplica PPP a productos.costo).
   tipo=''bonificacion'' (2.5) y ''consignacion'' (futuro) NO generan
   gasto al recibir y, en el caso de consignación, NO aplican PPP.';

COMMENT ON COLUMN compras.linea IS
  'Snapshot al recibir. Todos los compra_items son de esta línea. La RPC
   resuelve la categoría de gasto por (unidad.tipo = linea AND
   es_mercaderia=TRUE).';

COMMENT ON COLUMN compras.gasto_id IS
  'FK al gasto generado por esta compra. NOT NULL para tipo=''compra''
   (CHECK compras_gasto_segun_tipo). En bonificación/consignación queda
   NULL — la compra no es un gasto en el momento de recibirla.';


-- ============================================================================
-- 1.4. CREATE TABLE compra_items (detalle)
-- ============================================================================
CREATE TABLE compra_items (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  compra_id BIGINT NOT NULL REFERENCES compras(id) ON DELETE RESTRICT,
  producto_id BIGINT NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,

  -- Snapshot al recibir, idéntico patrón que venta_items.producto_nombre.
  producto_nombre VARCHAR(120) NOT NULL,

  cantidad INT NOT NULL CHECK (cantidad > 0),

  -- Costo al que entró ESTA unidad en ESTA compra. NUNCA NULL: en una
  -- compra real conocés el costo. En bonificación = costo de mercado;
  -- en consignación = costo acordado de pago al vender.
  costo_unitario_compra DECIMAL(12,2) NOT NULL
    CHECK (costo_unitario_compra >= 0),

  -- cantidad * costo_unitario_compra al recibir.
  subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),

  -- Snapshot de la línea del producto al recibir. La RPC enforza que
  -- coincida con compras.linea (no se puede expresar cross-row en CHECK).
  linea VARCHAR(10) NOT NULL CHECK (linea IN ('buffet','shop'))
);

CREATE INDEX idx_compra_items_compra ON compra_items (compra_id);
CREATE INDEX idx_compra_items_producto ON compra_items (producto_id);

COMMENT ON TABLE compra_items IS
  'Líneas de una compra unificada. Snapshots de producto_nombre, costo
   unitario, subtotal y línea para que el histórico no dependa del
   catálogo vivo (mismo patrón que venta_items / reserva_consumos).';

COMMENT ON COLUMN compra_items.costo_unitario_compra IS
  'Costo unitario al que entró esta unidad en esta compra. NUNCA NULL.
   Es el input principal del cálculo PPP en fn_registrar_compra.';


-- ============================================================================
-- 1.5. ALTER movimientos_stock: + compra_id + nuevo CHECK de coherencia
-- ============================================================================
ALTER TABLE movimientos_stock
  ADD COLUMN compra_id BIGINT REFERENCES compras(id) ON DELETE RESTRICT;

CREATE INDEX idx_mov_stock_compra
  ON movimientos_stock(compra_id) WHERE compra_id IS NOT NULL;

COMMENT ON COLUMN movimientos_stock.compra_id IS
  'FK a compras (0039). NOT NULL para movimientos generados por
   fn_registrar_compra (fuente=''compra_manual'' con detalle).
   NULL para entradas legacy via fn_registrar_movimiento_stock o
   compras del bot. Distinción cosmética en UI; el CHECK
   mov_stock_coherencia_fuente garantiza que solo fuentes de compra
   pueden tener compra_id NOT NULL.';

-- Reemplazo del CHECK de coherencia (vigente desde 0013):
-- - venta / consumo_turno / reposicion_consumo / ajuste: compra_id IS NULL.
-- - compra_manual / compra_bot_whatsapp: compra_id puede ser NULL (legacy)
--   o NOT NULL (compra unificada).
ALTER TABLE movimientos_stock
  DROP CONSTRAINT IF EXISTS mov_stock_coherencia_fuente;

ALTER TABLE movimientos_stock
  ADD CONSTRAINT mov_stock_coherencia_fuente CHECK (
    (fuente = 'venta'
        AND cantidad < 0
        AND venta_id IS NOT NULL
        AND reserva_consumo_id IS NULL
        AND compra_id IS NULL)
    OR (fuente = 'consumo_turno'
        AND cantidad < 0
        AND venta_id IS NULL
        AND compra_id IS NULL)
    OR (fuente = 'reposicion_consumo'
        AND cantidad > 0
        AND venta_id IS NULL
        AND reserva_consumo_id IS NULL
        AND compra_id IS NULL)
    OR (fuente IN ('compra_manual','compra_bot_whatsapp')
        AND cantidad > 0
        AND venta_id IS NULL
        AND reserva_consumo_id IS NULL)
    OR (fuente = 'ajuste'
        AND venta_id IS NULL
        AND reserva_consumo_id IS NULL
        AND compra_id IS NULL)
  );

COMMENT ON CONSTRAINT mov_stock_coherencia_fuente ON movimientos_stock IS
  'Coherencia fuente ↔ signo ↔ venta_id ↔ reserva_consumo_id ↔ compra_id.
   Reemplazado en 0039 para acotar compra_id a fuentes de compra
   (compra_manual y compra_bot_whatsapp). Resto del CHECK idéntico al
   de 0013. Para consumo_turno NO se exige reserva_consumo_id NOT NULL
   (el SET NULL del FK al borrar el consumo dejaría la fila incoherente);
   la garantía de INSERT la pone fn_cargar_consumo_turno.';


-- ============================================================================
-- 2. Backfill es_mercaderia en categorias_gasto
-- ============================================================================
-- Marca TRUE las categorías que aún tienen el nombre del seed (LOWER
-- exact match) bajo una unidad de tipo buffet/shop. Clubes que renombraron
-- antes de la 0039 NO se tocan automáticamente — el admin tiene que
-- marcar manualmente desde Configuración → Categorías de gasto (cuando
-- se sume el toggle en frontend) o vía SQL directo.
--
-- Idempotente: re-ejecutar no cambia nada (el UNIQUE parcial bloquearía
-- segundas marcas, y este UPDATE es la primera marca).
-- ============================================================================
DO $$
DECLARE
  v_marcadas INT;
  v_unidades_sin INT;
BEGIN
  UPDATE categorias_gasto cg
  SET es_mercaderia = TRUE
  FROM unidades_negocio u
  WHERE cg.unidad_id = u.id
    AND u.tipo IN ('buffet','shop')
    AND LOWER(cg.nombre) IN ('mercadería','mercaderia','mercadería shop','mercaderia shop')
    AND cg.es_mercaderia = FALSE;

  GET DIAGNOSTICS v_marcadas = ROW_COUNT;

  SELECT COUNT(*) INTO v_unidades_sin
  FROM unidades_negocio u
  WHERE u.tipo IN ('buffet','shop')
    AND NOT EXISTS (
      SELECT 1 FROM categorias_gasto cg
      WHERE cg.unidad_id = u.id AND cg.es_mercaderia = TRUE
    );

  RAISE NOTICE '0039 backfill es_mercaderia: % categoría(s) marcada(s).', v_marcadas;
  IF v_unidades_sin > 0 THEN
    RAISE NOTICE '0039 backfill ADVERTENCIA: % unidad(es) buffet/shop quedó/quedaron sin categoría de mercadería marcada (renombrada por el admin antes de 0039). Marcarla manualmente para habilitar fn_registrar_compra en esa línea.', v_unidades_sin;
  END IF;
END $$;


-- ============================================================================
-- 3. GRANTs + RLS — compras
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON compras TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE compras_id_seq TO authenticated;
GRANT SELECT, INSERT ON compra_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE compra_items_id_seq TO authenticated;
-- NO DELETE: las compras son inmutables (Bloque 2). La anulación se
-- diseña como deuda más adelante (mismo patrón que ventas).

ALTER TABLE compras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compras_select"
ON compras FOR SELECT TO authenticated
USING (club_id = current_club_id());

-- INSERT/UPDATE solo admin. La RPC fn_registrar_compra usa SECURITY
-- INVOKER, así que pasa por estas policies en runtime. No INSERTeamos
-- compras desde el frontend directo — solo vía RPC.
CREATE POLICY "compras_insert_solo_admin"
ON compras FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "compras_update_solo_admin"
ON compras FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 4. RLS — compra_items (mismas reglas que venta_items)
-- ============================================================================
ALTER TABLE compra_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compra_items_select"
ON compra_items FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "compra_items_insert_solo_admin"
ON compra_items FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 5. fn_registrar_gasto — DROP old + CREATE with p_proveedor_id (8º param)
-- ============================================================================
-- Cambio de signature: 7 → 8 params (sumamos p_proveedor_id BIGINT
-- DEFAULT NULL al final). CREATE OR REPLACE con distinto número de
-- params crearía un overload, así que DROP primero.
--
-- Compatibilidad: las callers existentes pasan los primeros 7 (named
-- o positional); el 8º DEFAULT NULL no rompe.
--
-- Lógica nueva del proveedor:
--   - Si p_proveedor_id viene: validar existe + activo + del club,
--     snapshotear gastos.proveedor = proveedores.nombre.
--   - Si p_proveedor_id es NULL: comportamiento idéntico al 0028
--     (snapshot manual desde p_proveedor).
-- ============================================================================
DROP FUNCTION IF EXISTS fn_registrar_gasto(BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR);

CREATE OR REPLACE FUNCTION fn_registrar_gasto(
  p_categoria_id BIGINT,
  p_monto DECIMAL,
  p_fecha_gasto DATE,
  p_proveedor VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_proveedor_id BIGINT DEFAULT NULL
)
RETURNS gastos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_categoria categorias_gasto;
  v_unidad unidades_negocio;
  v_proveedor proveedores;
  v_proveedor_snapshot VARCHAR(120) := p_proveedor;
  v_turno_caja_id BIGINT := NULL;
  v_gasto gastos;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para registrar gastos.';
  END IF;

  -- Validaciones de input.
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del gasto debe ser mayor a 0.';
  END IF;

  IF p_fecha_gasto IS NULL THEN
    RAISE EXCEPTION 'La fecha del gasto es obligatoria.';
  END IF;

  -- Pago atómico: o ambos vienen, o ninguno.
  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si pagás el gasto, tenés que indicar fecha de pago Y medio de pago. Si no, dejá ambos vacíos (queda pendiente).';
  END IF;

  -- Validar medio_pago si viene.
  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- Resolver categoría → unidad (con check de club).
  SELECT * INTO v_categoria
  FROM categorias_gasto
  WHERE id = p_categoria_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría no existe o no pertenece a tu club.';
  END IF;

  IF NOT v_categoria.activa THEN
    RAISE EXCEPTION
      'La categoría "%" está desactivada — no se pueden cargar gastos sobre ella. Pedile al admin que la reactive o elegí otra.',
      v_categoria.nombre;
  END IF;

  SELECT * INTO v_unidad
  FROM unidades_negocio
  WHERE id = v_categoria.unidad_id AND club_id = v_club_id;

  IF NOT FOUND THEN
    -- No debería pasar (FK garantiza unidad_id válido), pero defense in depth.
    RAISE EXCEPTION 'La unidad de negocio asociada a la categoría no existe.';
  END IF;

  -- Resolver proveedor si viene proveedor_id. El snapshot del nombre
  -- gana sobre p_proveedor (texto suelto) cuando proveedor_id está
  -- presente — más confiable que texto que el admin pudo tipear mal.
  IF p_proveedor_id IS NOT NULL THEN
    SELECT * INTO v_proveedor
    FROM proveedores
    WHERE id = p_proveedor_id AND club_id = v_club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
    END IF;
    IF NOT v_proveedor.activo THEN
      RAISE EXCEPTION
        'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de cargar el gasto.',
        v_proveedor.nombre;
    END IF;

    v_proveedor_snapshot := v_proveedor.nombre;
  END IF;

  -- REGLA DE ORO DEL EFECTIVO: si pago en efectivo, atar a la caja
  -- abierta. Falla rápido antes del INSERT.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de cobrar/pagar en efectivo.';
    END IF;
  END IF;

  -- INSERT con snapshots de categoría, unidad y proveedor.
  INSERT INTO gastos (
    club_id,
    categoria_id, categoria_nombre,
    unidad_id, unidad_nombre, unidad_tipo,
    monto, fecha_gasto,
    fecha_pago, medio_pago, turno_caja_id,
    proveedor, proveedor_id,
    observaciones,
    usuario_id
  ) VALUES (
    v_club_id,
    v_categoria.id, v_categoria.nombre,
    v_unidad.id, v_unidad.nombre, v_unidad.tipo,
    p_monto, p_fecha_gasto,
    p_fecha_pago, p_medio_pago, v_turno_caja_id,
    v_proveedor_snapshot, p_proveedor_id,
    p_observaciones,
    v_usuario_id
  )
  RETURNING * INTO v_gasto;

  RETURN v_gasto;
END;
$$;

COMMENT ON FUNCTION fn_registrar_gasto(BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT) IS
  'Registra un gasto con snapshots de categoría/unidad/proveedor. Acepta
   pago opcional (fecha_pago + medio_pago juntos o nada = pendiente). Si
   medio_pago=efectivo, aplica regla de oro: requiere caja abierta y
   setea turno_caja_id atómicamente. Si p_proveedor_id viene, snapshotea
   el nombre desde proveedores.nombre (gana sobre p_proveedor). Gate:
   admin O vendedor del club. Modificada en 0039 (+ p_proveedor_id 8º
   param) — compatible con callers que pasan los primeros 7.';

GRANT EXECUTE ON FUNCTION fn_registrar_gasto(BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT)
  TO authenticated;


-- ============================================================================
-- 6. fn_inicializar_finanzas — CREATE OR REPLACE (3ra versión: 0027 → 0036 → 0039)
-- ============================================================================
-- Cuerpo IDÉNTICO al de 0036 (6 unidades, 23 categorías). Cambio único:
-- UPDATE final que marca es_mercaderia=TRUE en las 2 categorías de
-- mercadería ('Mercadería' bajo Buffet, 'Mercadería shop' bajo Shop).
-- El UPDATE es idempotente — re-ejecutarlo no rompe (UNIQUE parcial
-- permite la misma marca, y WHERE NOT es_mercaderia evita ROW_COUNT
-- ruido).
--
-- La signature (BIGINT) no cambia → CREATE OR REPLACE limpia, sin DROP.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_inicializar_finanzas(p_club_id BIGINT)
RETURNS TABLE (
  unidades_creadas INT,
  categorias_creadas INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_club_id BIGINT;
  v_caller_rol VARCHAR;
  v_u_canchas BIGINT;       v_u_canchas_creada BOOLEAN;
  v_u_clases BIGINT;        v_u_clases_creada BOOLEAN;
  v_u_buffet BIGINT;        v_u_buffet_creada BOOLEAN;
  v_u_shop BIGINT;          v_u_shop_creada BOOLEAN;
  v_u_estructura BIGINT;    v_u_estructura_creada BOOLEAN;
  v_u_financiero BIGINT;    v_u_financiero_creada BOOLEAN;
  v_unidades INT := 0;
  v_categorias INT := 0;
BEGIN
  -- =================================================================
  -- GATE de seguridad (idéntico a 0027/0036).
  -- =================================================================
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_caller_club_id := current_club_id();
    v_caller_rol := current_user_rol();

    IF v_caller_club_id IS NULL THEN
      RAISE EXCEPTION 'No hay sesión activa.';
    END IF;
    IF v_caller_club_id <> p_club_id THEN
      RAISE EXCEPTION 'Solo podés inicializar las finanzas de tu propio club.';
    END IF;
    IF v_caller_rol IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Solo el administrador del club puede inicializar las finanzas.';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clubes WHERE id = p_club_id) THEN
    RAISE EXCEPTION 'Club no encontrado.';
  END IF;

  -- =================================================================
  -- UNIDADES (6 — idéntico a 0036)
  -- =================================================================
  SELECT v_id, v_creada INTO v_u_canchas, v_u_canchas_creada
  FROM _fin_init_unidad(p_club_id, 'Canchas', 'canchas', 10);
  IF v_u_canchas_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_clases, v_u_clases_creada
  FROM _fin_init_unidad(p_club_id, 'Clases', 'clases', 20);
  IF v_u_clases_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_buffet, v_u_buffet_creada
  FROM _fin_init_unidad(p_club_id, 'Buffet', 'buffet', 30);
  IF v_u_buffet_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_shop, v_u_shop_creada
  FROM _fin_init_unidad(p_club_id, 'Shop', 'shop', 40);
  IF v_u_shop_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_estructura, v_u_estructura_creada
  FROM _fin_init_unidad(p_club_id, 'Estructura', 'estructura', 50);
  IF v_u_estructura_creada THEN v_unidades := v_unidades + 1; END IF;

  SELECT v_id, v_creada INTO v_u_financiero, v_u_financiero_creada
  FROM _fin_init_unidad(p_club_id, 'Financiero', 'financiero', 60);
  IF v_u_financiero_creada THEN v_unidades := v_unidades + 1; END IF;

  -- =================================================================
  -- CATEGORÍAS (23 — idéntico a 0036)
  -- =================================================================

  -- Canchas (3)
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Mantenimiento canchas', 10) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Iluminación', 20)          THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_canchas, 'Productos limpieza', 30)   THEN v_categorias := v_categorias + 1; END IF;

  -- Clases (2)
  IF _fin_init_categoria(p_club_id, v_u_clases, 'Pagos a profesores', 10) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_clases, 'Material didáctico', 20) THEN v_categorias := v_categorias + 1; END IF;

  -- Buffet (2)
  IF _fin_init_categoria(p_club_id, v_u_buffet, 'Mercadería', 10)         THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_buffet, 'Reposición vajilla', 20) THEN v_categorias := v_categorias + 1; END IF;

  -- Shop (2)
  IF _fin_init_categoria(p_club_id, v_u_shop, 'Mercadería shop', 10)      THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_shop, 'Marketing artículos', 20)  THEN v_categorias := v_categorias + 1; END IF;

  -- Estructura (10) — INTACTO. "Gastos bancarios" se mantiene aquí por
  -- compat con gastos históricos snapshoteados.
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Alquiler local', 10)              THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Servicios (luz/agua/gas/internet)', 20) THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Sueldos y cargas sociales', 30)   THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Impuestos y tasas', 40)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Mantenimiento general', 50)       THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Limpieza', 60)                    THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Marketing general', 70)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Insumos oficina', 80)             THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Gastos bancarios', 90)            THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_estructura, 'Otros', 100)                      THEN v_categorias := v_categorias + 1; END IF;

  -- Financiero (4) — desde 0036
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Comisiones bancarias', 10)        THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Comisiones MP / tarjetas', 20)    THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Intereses pagados', 30)           THEN v_categorias := v_categorias + 1; END IF;
  IF _fin_init_categoria(p_club_id, v_u_financiero, 'Mantenimiento de cuenta', 40)     THEN v_categorias := v_categorias + 1; END IF;

  -- ⭐ NUEVO 0039 — Marcar es_mercaderia=TRUE en las 2 categorías de
  -- mercadería del seed. Idempotente: solo afecta filas que tengan el
  -- nombre exacto del seed y aún no estén marcadas. Clubes que
  -- renombraron antes de la 0039 no se ven afectados (acción manual).
  -- El UNIQUE parcial categorias_gasto_unique_mercaderia_por_unidad
  -- protege que no se marquen dos por unidad.
  UPDATE categorias_gasto
  SET es_mercaderia = TRUE
  WHERE club_id = p_club_id
    AND unidad_id = v_u_buffet
    AND LOWER(nombre) = 'mercadería'
    AND es_mercaderia = FALSE;

  UPDATE categorias_gasto
  SET es_mercaderia = TRUE
  WHERE club_id = p_club_id
    AND unidad_id = v_u_shop
    AND LOWER(nombre) = 'mercadería shop'
    AND es_mercaderia = FALSE;

  RAISE NOTICE 'fn_inicializar_finanzas para club %: % unidad(es) creadas, % categoría(s) creadas (idempotente).',
    p_club_id, v_unidades, v_categorias;

  RETURN QUERY SELECT v_unidades, v_categorias;
END;
$$;

COMMENT ON FUNCTION fn_inicializar_finanzas(BIGINT) IS
  'Siembra 6 unidades y 23 categorías de gasto típicas de un club de
   pádel (incluye Financiero desde 0036). Desde 0039: marca
   es_mercaderia=TRUE en Mercadería (Buffet) y Mercadería shop (Shop)
   para que fn_registrar_compra resuelva la categoría destino del
   gasto sin depender del nombre. Idempotente — re-ejecutable sin
   duplicar (helpers internas usan ON CONFLICT DO NOTHING; los UPDATE
   de marca tienen WHERE es_mercaderia=FALSE). Gate: solo admin del
   propio club, o service_role para invocaciones desde Edge Functions.';


-- ============================================================================
-- 7. fn_registrar_compra — RPC nueva (Bloque 2)
-- ============================================================================
-- Atómica. Gate: admin only del club (impacto contable + costos).
--
-- ORDEN DEL FLUJO — diseñado para que la cabecera de `compras` se
-- inserte UNA SOLA VEZ con todos los valores definitivos (tipo='compra',
-- gasto_id NOT NULL, monto_total final). El CHECK compras_gasto_segun_tipo
-- se cumple en el primer INSERT, sin estado intermedio ni UPDATE de
-- reescritura. La clave: como monto_total se computa puramente del
-- input, y compras.gasto_id apunta al gasto pero el gasto NO necesita
-- conocer compra_id, podemos crear el gasto primero.
--
-- Flujo:
--   1. Validar sesión + admin + club.
--   2. Validar inputs (linea, fecha, items, pago atómico, medio).
--   3. Resolver proveedor (existe + activo + del club).
--   4. Resolver categoría de mercadería (unidad.tipo = linea AND
--      es_mercaderia=TRUE AND activa). RAISE accionable si no hay.
--   5. Detectar duplicados de producto_id en items → RAISE.
--   6. Extraer arrays paralelos ORDENADOS ASC por producto_id (lock).
--   7. Validar cantidades / costos (no necesita lock).
--   8. Calcular monto_total en memoria (SUM de cantidad × costo) — el
--      input alcanza, no requiere lock.
--   9. Lock exclusivo FOR UPDATE sobre productos en orden ASC (mismo
--      patrón que fn_cerrar_venta — sin deadlock cruzado).
--  10. Validar cada producto bajo el lock + leer stock_actual + calcular
--      PPP por producto. Guardar PPPs en v_nuevos_costos[]. SIN ESCRIBIR.
--  11. Crear el gasto vía fn_registrar_gasto (con p_proveedor_id +
--      monto + observación autocontenida — no depende de compra_id).
--      La trazabilidad estructural vive en compras.gasto_id, no en
--      gastos.observaciones. Si esta llamada falla (ej. caja cerrada),
--      ROLLBACK total — nada se escribió todavía.
--  12. INSERT cabecera compras con valores DEFINITIVOS (tipo='compra',
--      gasto_id = v_gasto.id, monto_total = v_monto_total). El CHECK
--      compras_gasto_segun_tipo pasa en el primer y único INSERT.
--  13. Loop bajo el lock vigente: INSERT compra_items + INSERT
--      movimientos_stock (compra_id NOT NULL) + UPDATE productos.costo
--      con v_nuevos_costos[v_i].
--  14. RETURN v_compra.
--
-- Atomicidad: una sola transacción. Si fn_registrar_gasto (paso 11)
-- falla, todavía no escribimos en compras/items/movimientos/productos.
-- Si el loop final (paso 13) falla por cualquier razón, el ROLLBACK
-- también revierte el gasto recién creado en paso 11.
--
-- Lock holding: el FOR UPDATE del paso 9 se mantiene hasta COMMIT.
-- La llamada anidada a fn_registrar_gasto y los INSERT del loop final
-- corren bajo ese mismo lock — el stock no se mueve detrás nuestro.
--
-- Errores accionables (mensajes en P0001 → dbErrors pasa directo):
--   - 'No hay sesión activa.'
--   - 'Solo el administrador puede registrar compras.'
--   - 'La línea de la compra debe ser buffet o shop.'
--   - 'La compra tiene que tener al menos un producto.'
--   - 'Hay productos duplicados en la compra. Consolidá cada producto en una sola línea.'
--   - 'La cantidad debe ser mayor a 0 (item X).'
--   - 'El costo unitario debe ser >= 0 (item X).'
--   - 'Si la compra está paga, indicá fecha de pago Y medio de pago. Si no, dejá ambos vacíos (pendiente).'
--   - 'Medio de pago inválido.'
--   - 'El proveedor no existe o no pertenece a tu club.'
--   - 'El proveedor "X" está desactivado. Reactivalo desde Configuración → Proveedores antes de cargar la compra.'
--   - 'Tu club no tiene una categoría marcada como mercadería para la unidad de X. Andá a Configuración → Categorías de gasto y marcá una.'
--   - 'El producto X no existe o no pertenece a tu club.'
--   - 'El producto "X" está desactivado, no se puede comprar.'
--   - 'El producto "X" es de la línea Y, no podés cargarlo en una compra de Z.'
--   - + los errores de fn_registrar_gasto (caja cerrada, etc.).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_registrar_compra(
  p_proveedor_id BIGINT,
  p_linea VARCHAR,
  p_fecha_compra DATE,
  p_items JSONB,
  p_observaciones TEXT DEFAULT NULL,
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
  v_proveedor proveedores;
  v_categoria categorias_gasto;
  v_compra compras;
  v_gasto gastos;
  v_pids BIGINT[];
  v_cants INT[];
  v_costos DECIMAL(12,2)[];
  v_nuevos_costos DECIMAL(12,2)[];
  v_i INT;
  v_n INT;
  v_producto productos;
  v_stock INT;
  v_nuevo_costo DECIMAL(12,2);
  v_subtotal DECIMAL(12,2);
  v_monto_total DECIMAL(12,2) := 0;
  v_obs_gasto TEXT;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede registrar compras.';
  END IF;

  -- ── Validaciones básicas de input ─────────────────────────────────
  IF p_linea IS NULL OR p_linea NOT IN ('buffet','shop') THEN
    RAISE EXCEPTION 'La línea de la compra debe ser buffet o shop.';
  END IF;

  IF p_fecha_compra IS NULL THEN
    RAISE EXCEPTION 'La fecha de la compra es obligatoria.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La compra tiene que tener al menos un producto.';
  END IF;

  -- Pago atómico (mismo CHECK que fn_registrar_gasto).
  IF (p_fecha_pago IS NOT NULL) <> (p_medio_pago IS NOT NULL) THEN
    RAISE EXCEPTION
      'Si la compra está paga, indicá fecha de pago Y medio de pago. Si no, dejá ambos vacíos (pendiente).';
  END IF;

  IF p_medio_pago IS NOT NULL
     AND p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ── Proveedor: existe + activo + del club ─────────────────────────
  SELECT * INTO v_proveedor
  FROM proveedores
  WHERE id = p_proveedor_id AND club_id = v_club_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El proveedor no existe o no pertenece a tu club.';
  END IF;
  IF NOT v_proveedor.activo THEN
    RAISE EXCEPTION
      'El proveedor "%" está desactivado. Reactivalo desde Configuración → Proveedores antes de cargar la compra.',
      v_proveedor.nombre;
  END IF;

  -- ── Categoría de mercadería para esta línea ───────────────────────
  -- Resuelve por flag es_mercaderia, NO por nombre. Permite que el admin
  -- renombre "Mercadería" sin romper la compra.
  SELECT cg.* INTO v_categoria
  FROM categorias_gasto cg
  JOIN unidades_negocio u ON u.id = cg.unidad_id
  WHERE cg.club_id = v_club_id
    AND u.tipo = p_linea
    AND cg.es_mercaderia = TRUE
    AND cg.activa = TRUE
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Tu club no tiene una categoría marcada como mercadería para la unidad de %. Andá a Configuración → Categorías de gasto y marcá una.',
      p_linea;
  END IF;

  -- ── Detectar duplicados de producto_id en items ───────────────────
  -- Rechazamos en lugar de consolidar silencioso: cargar dos líneas del
  -- mismo producto con costos distintos suele ser un error humano.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) x
    GROUP BY (x->>'producto_id')::BIGINT
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos duplicados en la compra. Consolidá cada producto en una sola línea.';
  END IF;

  -- ── Extraer arrays paralelos ORDENADOS ASC por producto_id ────────
  -- Imprescindible para lockear en orden ASC y evitar deadlocks
  -- cruzados con fn_cerrar_venta.
  SELECT
    array_agg((x->>'producto_id')::BIGINT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'cantidad')::INT ORDER BY (x->>'producto_id')::BIGINT),
    array_agg((x->>'costo_unitario_compra')::DECIMAL(12,2) ORDER BY (x->>'producto_id')::BIGINT)
  INTO v_pids, v_cants, v_costos
  FROM jsonb_array_elements(p_items) x;

  v_n := array_length(v_pids, 1);

  -- ── Validar cantidades / costos básicos (no necesita lock) ────────
  FOR v_i IN 1..v_n LOOP
    IF v_cants[v_i] IS NULL OR v_cants[v_i] <= 0 THEN
      RAISE EXCEPTION 'La cantidad debe ser mayor a 0 (item %).', v_i;
    END IF;
    IF v_costos[v_i] IS NULL OR v_costos[v_i] < 0 THEN
      RAISE EXCEPTION 'El costo unitario debe ser >= 0 (item %).', v_i;
    END IF;
  END LOOP;

  -- ── Calcular monto_total en memoria ────────────────────────────────
  -- Pure data del input — no requiere lock. Sirve para llamar a
  -- fn_registrar_gasto con el monto correcto ANTES de insertar compras.
  v_monto_total := 0;
  FOR v_i IN 1..v_n LOOP
    v_monto_total := v_monto_total + ROUND(v_cants[v_i]::DECIMAL * v_costos[v_i], 2);
  END LOOP;

  -- ── Lock exclusivo sobre productos en orden ASC ───────────────────
  -- Mismo orden que fn_cerrar_venta / fn_cargar_consumo_turno /
  -- fn_ajustar_stock. Una venta o compra concurrente sobre los mismos
  -- productos se serializa: la segunda espera al COMMIT de la primera
  -- y ve sus cambios (stock, costo) ya aplicados. El lock se mantiene
  -- hasta COMMIT de esta transacción.
  PERFORM 1 FROM productos
  WHERE id = ANY(v_pids) AND club_id = v_club_id
  ORDER BY id ASC
  FOR UPDATE;

  -- ── Validar productos + leer stock + calcular PPP bajo lock ───────
  -- NO escribimos nada todavía. Solo lectura + cómputo en memoria.
  -- Guardamos los PPPs en v_nuevos_costos[] para aplicar en el loop
  -- final, después de tener compra_id.
  v_nuevos_costos := ARRAY[]::DECIMAL(12,2)[];
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El producto % no existe o no pertenece a tu club.', v_pids[v_i];
    END IF;
    IF NOT v_producto.activo THEN
      RAISE EXCEPTION 'El producto "%" está desactivado, no se puede comprar.', v_producto.nombre;
    END IF;
    IF v_producto.linea <> p_linea THEN
      RAISE EXCEPTION
        'El producto "%" es de la línea %, no podés cargarlo en una compra de %.',
        v_producto.nombre, v_producto.linea, p_linea;
    END IF;

    -- stock_actual bajo el lock (truncamos negativo a 0 defense-in-depth).
    SELECT GREATEST(0, COALESCE(SUM(cantidad), 0))::INT INTO v_stock
    FROM movimientos_stock
    WHERE producto_id = v_producto.id;

    -- PPP con bordes. División por cero imposible: la rama ELSE
    -- ejecuta solo cuando v_stock > 0; v_cants[v_i] > 0 ya validado.
    IF v_stock <= 0 OR v_producto.costo IS NULL THEN
      v_nuevo_costo := ROUND(v_costos[v_i], 2);
    ELSE
      v_nuevo_costo := ROUND(
        (v_stock::DECIMAL * v_producto.costo
         + v_cants[v_i]::DECIMAL * v_costos[v_i])
        / (v_stock::DECIMAL + v_cants[v_i]::DECIMAL),
      2);
    END IF;

    v_nuevos_costos := v_nuevos_costos || v_nuevo_costo;
  END LOOP;

  -- ── Crear el gasto PRIMERO (vía fn_registrar_gasto) ───────────────
  -- Observación autocontenida — no depende de compra_id. La trazabilidad
  -- estructural vive en compras.gasto_id, no en gastos.observaciones.
  -- Si esta llamada falla (ej. medio_pago=efectivo sin caja abierta),
  -- la transacción entera ROLLBACK — todavía no escribimos compras ni
  -- movimientos ni productos.costo. Falla limpia.
  v_obs_gasto := 'Compra a ' || v_proveedor.nombre || ' del ' || p_fecha_compra::TEXT;

  SELECT * INTO v_gasto FROM fn_registrar_gasto(
    p_categoria_id := v_categoria.id,
    p_monto := v_monto_total,
    p_fecha_gasto := p_fecha_compra,
    p_proveedor := NULL,                  -- el snapshot lo pone la RPC desde proveedor_id
    p_observaciones := v_obs_gasto,
    p_fecha_pago := p_fecha_pago,
    p_medio_pago := p_medio_pago,
    p_proveedor_id := v_proveedor.id
  );

  -- ── INSERT cabecera compras con valores DEFINITIVOS ───────────────
  -- tipo='compra' + gasto_id NOT NULL + monto_total ya conocido.
  -- El CHECK compras_gasto_segun_tipo pasa en el primer y único INSERT.
  INSERT INTO compras (
    club_id, proveedor_id, tipo, linea, fecha_compra,
    monto_total, gasto_id, observaciones, usuario_id
  ) VALUES (
    v_club_id, v_proveedor.id, 'compra', p_linea, p_fecha_compra,
    v_monto_total, v_gasto.id, p_observaciones, v_usuario_id
  )
  RETURNING * INTO v_compra;

  -- ── Loop de escritura: items + movimientos + UPDATE costo ─────────
  -- Bajo el mismo lock FOR UPDATE adquirido más arriba (sigue vivo
  -- hasta COMMIT). v_nuevos_costos[v_i] ya está calculado.
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto
    FROM productos
    WHERE id = v_pids[v_i] AND club_id = v_club_id;

    v_subtotal := ROUND(v_cants[v_i]::DECIMAL * v_costos[v_i], 2);

    -- INSERT compra_items con snapshots.
    INSERT INTO compra_items (
      club_id, compra_id, producto_id, producto_nombre,
      cantidad, costo_unitario_compra, subtotal, linea
    ) VALUES (
      v_club_id, v_compra.id, v_producto.id, v_producto.nombre,
      v_cants[v_i], v_costos[v_i], v_subtotal, v_producto.linea
    );

    -- INSERT movimientos_stock — fuente='compra_manual', compra_id NOT
    -- NULL para distinguir de las legacy (fn_registrar_movimiento_stock).
    INSERT INTO movimientos_stock (
      club_id, producto_id, cantidad, fuente,
      venta_id, reserva_consumo_id, compra_id,
      observaciones, usuario_id
    ) VALUES (
      v_club_id, v_producto.id, v_cants[v_i], 'compra_manual',
      NULL, NULL, v_compra.id,
      'Compra #' || v_compra.id::TEXT,
      v_usuario_id
    );

    -- UPDATE productos.costo con el PPP recién calculado.
    UPDATE productos
    SET costo = v_nuevos_costos[v_i]
    WHERE id = v_producto.id;
  END LOOP;

  RETURN v_compra;
END;
$$;

COMMENT ON FUNCTION fn_registrar_compra(BIGINT, VARCHAR, DATE, JSONB, TEXT, DATE, VARCHAR) IS
  'Registra una compra unificada con PPP. Atómica: valida proveedor +
   línea + items, lockea productos en orden ASC, calcula monto y PPPs
   en memoria, crea el gasto vía fn_registrar_gasto, inserta compras
   YA con gasto_id + tipo=''compra'' definitivos (CHECK estricto pasa
   en el primer INSERT — sin estado intermedio), inserta compra_items +
   movimientos_stock (compra_id NOT NULL), actualiza productos.costo
   con el promedio ponderado. Gate: admin only. Reusa
   fuente=''compra_manual'' con compra_id como discriminante de la
   legacy fn_registrar_movimiento_stock.';

GRANT EXECUTE ON FUNCTION fn_registrar_compra(BIGINT, VARCHAR, DATE, JSONB, TEXT, DATE, VARCHAR)
  TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0039_compras_unificadas.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Estructura: columnas y CHECK ----------
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name IN ('compras','compra_items')
-- ORDER BY table_name, ordinal_position;
-- → compras: 12 columnas. compra_items: 9 columnas.
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname IN (
--   'compras_gasto_segun_tipo',
--   'mov_stock_coherencia_fuente',
--   'categorias_gasto_unique_mercaderia_por_unidad'
-- );
-- → 3 filas con los CHECKs / unique parcial definidos.

-- ---------- B. Backfill es_mercaderia ----------
-- SELECT u.nombre AS unidad, cg.nombre AS categoria, cg.es_mercaderia
-- FROM categorias_gasto cg
-- JOIN unidades_negocio u ON u.id = cg.unidad_id
-- WHERE u.tipo IN ('buffet','shop')
-- ORDER BY u.tipo, cg.orden;
-- → Filas con "Mercadería" / "Mercadería shop" tienen es_mercaderia=TRUE.
--   Otras de la unidad (ej. "Reposición vajilla") tienen FALSE.

-- ---------- C. fn_registrar_compra path feliz ----------
-- Como admin del club, con un proveedor activo del club, sobre productos
-- de buffet:
--   await window.supabase.rpc('fn_registrar_compra', {
--     p_proveedor_id: <id>,
--     p_linea: 'buffet',
--     p_fecha_compra: '2026-05-23',
--     p_items: [
--       { producto_id: <id_coca>, cantidad: 24, costo_unitario_compra: 250.50 },
--       { producto_id: <id_agua>, cantidad: 12, costo_unitario_compra: 180.00 }
--     ],
--     p_observaciones: 'Compra test',
--     p_fecha_pago: '2026-05-23',
--     p_medio_pago: 'transferencia'
--   });
-- → 1 fila en compras (tipo='compra', gasto_id NOT NULL), 2 en compra_items,
--   2 en movimientos_stock (compra_id apunta a la compra), 1 en gastos
--   con proveedor_id + proveedor_nombre snapshot.
-- → productos.costo actualizado con el PPP de cada producto.

-- ---------- D. PPP: caso normal (stock previo > 0 + costo previo) ----------
-- Producto con stock=10 y costo=100. Compra +5 a costo=120.
-- PPP esperado: (10*100 + 5*120) / (10+5) = (1000+600)/15 = 106.67.
-- Tras la compra:
--   SELECT costo FROM productos WHERE id = <X>;
-- → 106.67

-- ---------- E. PPP: borde stock=0 ----------
-- Producto con stock=0 y costo=500 (de una carga vieja). Compra +20 a costo=300.
-- PPP esperado: 300 (se reinicia — no hay unidades para promediar).
-- Tras la compra:
--   SELECT costo FROM productos WHERE id = <X>;
-- → 300

-- ---------- F. PPP: borde costo previo NULL ----------
-- Producto recién creado con stock=5 (cargado pre-PPP via fn_registrar_movimiento_stock)
-- y costo=NULL. Compra +10 a costo=80.
-- PPP esperado: 80 (no podemos promediar contra NULL).
-- Tras la compra:
--   SELECT costo FROM productos WHERE id = <X>;
-- → 80

-- ---------- G. Producto de otra línea ----------
-- Compra de buffet incluyendo un producto de shop:
-- → ERROR: 'El producto "Pelotas Bull Padel 2 Un." es de la línea shop,
--   no podés cargarlo en una compra de buffet.'
-- → ROLLBACK total (cero filas en compras, compra_items, movimientos, gastos).

-- ---------- H. Proveedor desactivado ----------
-- Desactivar un proveedor y luego intentar compra con su id:
-- → ERROR: 'El proveedor "X" está desactivado. Reactivalo desde
--   Configuración → Proveedores antes de cargar la compra.'

-- ---------- I. Caja cerrada + medio_pago=efectivo ----------
-- Sin caja abierta del día, compra efectivo:
-- → ERROR de fn_registrar_gasto: 'No hay caja abierta...'.
-- → ROLLBACK total (la transacción de la compra entera se aborta).

-- ---------- J. Producto duplicado en items ----------
-- p_items con el mismo producto_id dos veces:
-- → ERROR: 'Hay productos duplicados en la compra. Consolidá cada
--   producto en una sola línea.'

-- ---------- K. Gate vendedor ----------
-- Como vendedor (no admin), intentar fn_registrar_compra:
-- → ERROR: 'Solo el administrador puede registrar compras.'

-- ---------- L. fn_cerrar_venta sigue intacta ----------
-- Después de la 0039, una venta normal de productos:
--   - venta_items.costo_unitario debe reflejar el productos.costo
--     ACTUAL (PPP recién calculado, no el pre-compra).
--   - movimientos_stock con fuente='venta', compra_id IS NULL.
-- → OK.

-- ---------- M. Concurrencia (manual, dos conexiones) ----------
-- conn1> BEGIN; SELECT fn_registrar_compra(...);  -- toma lock productos
-- conn2> BEGIN; SELECT fn_cerrar_venta(...);       -- espera el lock
-- conn1> COMMIT;
-- conn2> (continúa, lee productos.costo recién actualizado, snapshotea
--         en venta_items.costo_unitario el costo nuevo) COMMIT.
-- → Sin deadlock. Stock y costos consistentes al final.

-- ---------- N. fn_inicializar_finanzas idempotente sobre club existente ----------
-- Re-ejecutar sobre un club que ya tiene las 6 unidades y 23 categorías:
--   SELECT * FROM fn_inicializar_finanzas(<club_id>);
-- → 0 unidades_creadas, 0 categorias_creadas. Pero el UPDATE de
--   es_mercaderia=TRUE corrige si alguna no estaba marcada (por ejemplo
--   si el backfill no la encontró por nombre).
-- ============================================================================
