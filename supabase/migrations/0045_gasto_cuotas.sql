-- ============================================================================
-- 0045_gasto_cuotas.sql
-- Cuentas por Pagar (CxP) con plan de pagos en cuotas. El gasto sigue
-- siendo el devengado del EERR; las cuotas son el plan de caja (flujo).
--
-- =====================================================================
-- MODELO
-- =====================================================================
-- Una sola fuente de verdad: el gasto ES la deuda. Las cuotas son su
-- plan de pago.
--   - Gasto pendiente: `gastos.fecha_pago IS NULL`. Su deuda completa
--     vive como cuotas en `gasto_cuotas`.
--   - Gasto pagado (legacy): `gastos.fecha_pago IS NOT NULL`. NO tiene
--     cuotas (modelo previo a CxP). Sigue siendo válido para auditoría
--     histórica; el módulo CxP los ignora.
--   - Gasto nuevo pagado al instante (ABM gastos): igual que legacy —
--     sin cuotas. Solo los gastos PENDIENTES tienen cuotas asociadas.
--   - Gasto nuevo de fn_recibir_oc: SIEMPRE pendiente, SIEMPRE con
--     cuotas (anticipo opcional + N cuotas regulares). Si se paga al
--     recibir, la cuota correspondiente nace pagada — no se toca
--     gastos.fecha_pago.
--
-- Anticipo: representado como cuota número 0 con flag es_anticipo=TRUE.
-- Cuotas regulares numeradas 1..N. Si no hay anticipo, no existe la
-- cuota 0 (cuotas empiezan en 1). Si hay anticipo, existe la 0 +
-- cuotas 1..N.
--
-- =====================================================================
-- ESTADO DERIVADO
-- =====================================================================
-- No se persiste el estado de la deuda. Se calcula on-the-fly:
--   pendiente: 0 cuotas pagadas.
--   parcial:   1..N-1 cuotas pagadas.
--   saldada:   todas las cuotas pagadas.
-- saldo = gastos.monto − SUM(cuotas con fecha_pago).
--
-- =====================================================================
-- INVARIANTE DE MONTO
-- =====================================================================
-- SUM(gasto_cuotas.monto WHERE gasto_id=X) = gastos.monto.
-- NO expresable como CHECK de tabla (cross-row + cross-table). La
-- garantizan las RPCs (fn_registrar_gasto, fn_recibir_oc). Sin trigger
-- en este bloque — si emerge inconsistencia por edición manual desde
-- Studio, sumar trigger. Hoy no hay path de usuario que la rompa.
--
-- =====================================================================
-- EERR — INTACTO
-- =====================================================================
-- useResumenFinanciero lee `gastos.fecha_gasto` (devengado). No mira
-- `fecha_pago` ni `gasto_cuotas`. El fix de mercadería excluida
-- (es_mercaderia=TRUE → fuera del EERR) sigue valiendo. Las cuotas son
-- estrictamente flujo de caja, no impactan el resultado.
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- 1. CREATE TABLE gasto_cuotas + CHECKs + índices + RLS + GRANTs.
-- 2. Backfill: una cuota total (numero=1) por cada gasto pendiente
--    existente (idempotente).
-- 3. DROP + CREATE fn_registrar_gasto v3 con dos params nuevos
--    (p_fecha_vencimiento + p_skip_cuota_automatica).
-- 4. DROP + CREATE fn_recibir_oc v3 con tres params nuevos
--    (p_anticipo + p_cantidad_cuotas + p_fechas_vencimiento) + plan
--    de cuotas + pago al recibir vía cuota (no via gastos.fecha_pago).
-- 5. CREATE fn_pagar_cuota — RPC nueva con FOR UPDATE anti-doble-pago.
--
-- NO toca:
-- - useResumenFinanciero / EERR (las cuotas son flujo, no resultado).
-- - fn_cerrar_venta, fn_cargar_consumo_turno, fn_ajustar_stock.
-- - fn_crear_oc, fn_actualizar_oc, fn_cancelar_oc.
-- - productos.costo (PPP). Sin cambios.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. TABLA: gasto_cuotas
-- ============================================================================
CREATE TABLE gasto_cuotas (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  -- Deuda madre. RESTRICT: un gasto con cuotas no se puede borrar
  -- físicamente (alineado con la inmutabilidad de gastos vigente).
  gasto_id BIGINT NOT NULL REFERENCES gastos(id) ON DELETE RESTRICT,

  -- Número de cuota dentro del gasto.
  --   0      → anticipo (si existe, único por gasto).
  --   1..N   → cuotas regulares.
  numero INT NOT NULL CHECK (numero >= 0),

  -- Flag explícito de anticipo (redundante con numero=0 pero claro al
  -- leer y permite filtros directos sin tener que recordar la convención).
  es_anticipo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Monto de esta cuota. Suma de cuotas (todas) = gastos.monto, lo
  -- garantizan las RPCs.
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),

  -- Vencimiento. NULL = sin vencimiento explícito (gastos legacy
  -- backfilleados o gastos cargados desde ABM sin fecha objetivo).
  -- Los con NULL caen en bucket "Indefinido" del aging del módulo CxP.
  fecha_vencimiento DATE,

  -- Estado de pago (igual modelo que gastos.fecha_pago).
  fecha_pago DATE,
  medio_pago VARCHAR(20) CHECK (
    medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro')
  ),
  turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT,

  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- CHECK 1: pago atómico (mismo patrón que gastos_pago_atomico).
  CONSTRAINT cuota_pago_atomico CHECK (
    (fecha_pago IS NULL AND medio_pago IS NULL AND turno_caja_id IS NULL)
    OR
    (fecha_pago IS NOT NULL AND medio_pago IS NOT NULL)
  ),

  -- CHECK 2: regla de oro del efectivo — pago en efectivo ⇒ caja abierta.
  CONSTRAINT cuota_efectivo_requiere_caja CHECK (
    medio_pago IS DISTINCT FROM 'efectivo' OR turno_caja_id IS NOT NULL
  ),

  -- CHECK 3: coherencia anticipo ↔ numero.
  --   es_anticipo=TRUE  ⇔ numero=0
  --   es_anticipo=FALSE ⇔ numero>=1
  CONSTRAINT cuota_numero_anticipo_coherencia CHECK (
    (es_anticipo = TRUE AND numero = 0)
    OR (es_anticipo = FALSE AND numero >= 1)
  )
);

COMMENT ON TABLE gasto_cuotas IS
  'Plan de pago en cuotas de un gasto pendiente. Una cuota por fila;
   numero=0 es anticipo opcional, numero>=1 son cuotas regulares. El
   estado de la deuda (pendiente/parcial/saldada) se deriva on-the-fly
   sumando cuotas con fecha_pago != NULL. La invariante SUM(monto) =
   gastos.monto la garantizan las RPCs.';

COMMENT ON COLUMN gasto_cuotas.numero IS
  '0 = anticipo (único por gasto vía índice parcial). 1..N = cuotas
   regulares numeradas sin saltos.';

COMMENT ON COLUMN gasto_cuotas.fecha_vencimiento IS
  'Fecha objetivo del pago. NULL = sin vencimiento explícito (gastos
   legacy backfilleados o ABM sin fecha). El módulo CxP los agrupa en
   bucket "Indefinido" del aging.';


-- ============================================================================
-- 2. ÍNDICES
-- ============================================================================
-- Unicidad: una cuota por (gasto, numero). Garantiza que no haya dos
-- cuotas con el mismo número en el mismo gasto.
CREATE UNIQUE INDEX gasto_cuotas_unicas
  ON gasto_cuotas (gasto_id, numero);

-- Unicidad parcial: máximo una cuota anticipo por gasto (defensa
-- adicional sobre el CHECK de coherencia anticipo↔numero).
CREATE UNIQUE INDEX gasto_cuotas_unicidad_anticipo
  ON gasto_cuotas (gasto_id) WHERE es_anticipo = TRUE;

-- Aging del módulo CxP — solo las pendientes, ordenables por
-- vencimiento. Filtra rápido las que aparecen en /finanzas/cxp.
CREATE INDEX idx_gasto_cuotas_pendientes
  ON gasto_cuotas (club_id, fecha_vencimiento)
  WHERE fecha_pago IS NULL;

-- Lookup por gasto (listar cuotas de una deuda en orden).
CREATE INDEX idx_gasto_cuotas_gasto
  ON gasto_cuotas (gasto_id, numero);


-- ============================================================================
-- 3. GRANTs (la RLS hace el gate real, ver paso 4)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON gasto_cuotas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE gasto_cuotas_id_seq TO authenticated;
-- NO DELETE: cuotas inmutables de hecho (alineado con gastos). Si
-- emerge necesidad de anular pago, se hace con flujo de anulación
-- (deuda futura, mismo nivel que fn_anular_gasto).


-- ============================================================================
-- 4. RLS — calcada de gastos
-- ============================================================================
ALTER TABLE gasto_cuotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gasto_cuotas_select"
ON gasto_cuotas FOR SELECT TO authenticated
USING (club_id = current_club_id());

-- INSERT: admin O vendedor (mismo gate que gastos_insert).
-- Lo usan fn_registrar_gasto y fn_recibir_oc (ambos SECURITY INVOKER).
CREATE POLICY "gasto_cuotas_insert"
ON gasto_cuotas FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- UPDATE: admin O vendedor. La consume fn_pagar_cuota.
CREATE POLICY "gasto_cuotas_update"
ON gasto_cuotas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- Sin DELETE policy.


-- ============================================================================
-- 5. Backfill: 1 cuota total por cada gasto pendiente existente
-- ============================================================================
-- Idempotente: NOT EXISTS evita duplicar si la migración se re-ejecuta.
-- Solo gastos pendientes (fecha_pago IS NULL) y activos. Los pagados
-- legacy NO se tocan — mantienen el camino histórico de gastos.fecha_pago.
-- fecha_alta = fecha_alta del gasto (preserva "cuándo se cargó la deuda").
DO $$
DECLARE
  v_backfilled INT;
BEGIN
  INSERT INTO gasto_cuotas (
    club_id, gasto_id, numero, es_anticipo, monto,
    fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
    usuario_id, fecha_alta
  )
  SELECT
    g.club_id, g.id, 1, FALSE, g.monto,
    NULL, NULL, NULL, NULL,
    g.usuario_id, g.fecha_alta
  FROM gastos g
  WHERE g.fecha_pago IS NULL
    AND g.activo = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM gasto_cuotas c WHERE c.gasto_id = g.id
    );

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;
  RAISE NOTICE
    '0045 backfill gasto_cuotas: % cuota(s) generada(s) para gastos pendientes legacy (1 cuota total, sin vencimiento).',
    v_backfilled;
END $$;


-- ============================================================================
-- 6. fn_registrar_gasto v3 — DROP + CREATE con dos params nuevos
-- ============================================================================
-- Cambio respecto a la 0039 (que ya había sumado p_proveedor_id):
--
--   p_fecha_vencimiento DATE DEFAULT NULL
--     Si el gasto nace pendiente, fija el vencimiento de la cuota
--     única que se genera. NULL = sin vencimiento explícito (bucket
--     "Indefinido" del aging). Ignorado si el gasto se paga al
--     instante (no se genera cuota).
--
--   p_skip_cuota_automatica BOOLEAN DEFAULT FALSE
--     Suprime la creación automática de cuota cuando el gasto nace
--     pendiente. Lo usa fn_recibir_oc cuando va a generar su propio
--     plan de anticipo + N cuotas. Para callers normales (ABM gastos),
--     queda FALSE y se crea la cuota total.
--
-- Lógica del cuerpo (mismas validaciones que 0039 + bloque final
-- nuevo):
--   - Si fecha_pago IS NULL (gasto pendiente)
--     AND p_skip_cuota_automatica = FALSE:
--     INSERT 1 cuota en gasto_cuotas con numero=1, monto=v_gasto.monto,
--     fecha_vencimiento=p_fecha_vencimiento, sin pago.
--
-- La signature cambia de 8 a 10 params → DROP + CREATE.
-- Callers existentes con 8 params siguen funcionando (los nuevos son
-- DEFAULT NULL/FALSE).
-- ============================================================================
DROP FUNCTION IF EXISTS fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT
);

CREATE OR REPLACE FUNCTION fn_registrar_gasto(
  p_categoria_id BIGINT,
  p_monto DECIMAL,
  p_fecha_gasto DATE,
  p_proveedor VARCHAR DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_fecha_pago DATE DEFAULT NULL,
  p_medio_pago VARCHAR DEFAULT NULL,
  p_proveedor_id BIGINT DEFAULT NULL,
  p_fecha_vencimiento DATE DEFAULT NULL,
  p_skip_cuota_automatica BOOLEAN DEFAULT FALSE
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

  -- ⭐ NUEVO 0045: si el gasto nace PENDIENTE y el caller no pidió
  -- skip, generar una cuota total por defecto. Modelo uniforme para
  -- CxP: todo gasto pendiente tiene su deuda en gasto_cuotas.
  --
  -- p_skip_cuota_automatica=TRUE lo usa fn_recibir_oc cuando va a
  -- generar su propio plan (anticipo + N cuotas) — para no duplicar
  -- la cuota.
  IF v_gasto.fecha_pago IS NULL AND NOT p_skip_cuota_automatica THEN
    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id
    ) VALUES (
      v_club_id, v_gasto.id, 1, FALSE, v_gasto.monto,
      p_fecha_vencimiento, NULL, NULL, NULL,
      v_usuario_id
    );
  END IF;

  RETURN v_gasto;
END;
$$;

COMMENT ON FUNCTION fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN
) IS
  'Registra un gasto con snapshots de categoría/unidad/proveedor.
   Desde 0045: si el gasto nace pendiente (sin fecha_pago) y
   p_skip_cuota_automatica=FALSE, genera 1 cuota total en
   gasto_cuotas (modelo uniforme para CxP). El caller fn_recibir_oc
   pasa p_skip_cuota_automatica=TRUE cuando va a generar su propio
   plan de anticipo + N cuotas. Gate: admin O vendedor del club.';

GRANT EXECUTE ON FUNCTION fn_registrar_gasto(
  BIGINT, DECIMAL, DATE, VARCHAR, TEXT, DATE, VARCHAR, BIGINT, DATE, BOOLEAN
) TO authenticated;


-- ============================================================================
-- 7. fn_recibir_oc v3 — DROP + CREATE con plan de cuotas
-- ============================================================================
-- Cambios respecto a 0043:
--
-- Params nuevos:
--   p_anticipo DECIMAL DEFAULT 0
--     Entrega al recibir. Si > 0, se crea cuota 0 (es_anticipo=TRUE)
--     con vencimiento = p_fecha_recepcion. Si = 0, no se crea cuota 0
--     (cuotas empiezan en 1).
--
--   p_cantidad_cuotas INT DEFAULT 1
--     Cantidad de cuotas regulares (1..N). Default 1 = total único en
--     una sola cuota.
--
--   p_fechas_vencimiento DATE[] DEFAULT NULL
--     Array con exactamente N fechas (una por cuota regular), en
--     orden ascendente. La RPC valida cardinalidad y orden.
--
-- Lógica del plan:
--   - Suma total = p_anticipo + SUM(cuotas regulares) = v_monto_gasto.
--   - Cuota base = ROUND((v_monto_gasto - p_anticipo) / N, 2).
--   - Última cuota absorbe el residuo de centavos: SUM exacto.
--   - p_anticipo < v_monto_gasto (no = ni > ; usar N=1 sin anticipo
--     para pagar todo al instante).
--
-- Pago al recibir (p_fecha_pago + p_medio_pago):
--   - Si p_anticipo > 0: el anticipo nace pagado.
--   - Si p_cantidad_cuotas = 1 y p_anticipo = 0: la cuota única nace
--     pagada.
--   - Otro caso (multi-cuota sin anticipo + pago): RAISE accionable
--     (ambiguo qué cuota se está pagando).
--
-- ⭐ El gasto ahora SIEMPRE nace pendiente: fn_recibir_oc llama a
-- fn_registrar_gasto con p_fecha_pago=NULL, p_medio_pago=NULL,
-- p_skip_cuota_automatica=TRUE. El pago al recibir, si aplica, se
-- materializa marcando la cuota correspondiente como pagada. Estado:
-- gastos.fecha_pago queda NULL en todo gasto con plan de cuotas.
--
-- Validación de caja efectivo: cuando p_medio_pago='efectivo' y hay
-- pago al recibir, fn_recibir_oc resuelve current_club_caja_abierta()
-- por su cuenta (antes lo hacía fn_registrar_gasto, pero ahora ese
-- gasto nace pendiente).
--
-- Resto IDÉNTICO a 0043: gate admin, verifico estado='pedida', snapshot
-- de condición fiscal, lock productos ASC, PPP por item según fiscal,
-- IVA discriminado, monto del gasto según fiscal (RI=neto, mono=total),
-- DELETE compra_items vigentes, INSERT compra_items + movimientos +
-- UPDATE productos.costo, UPDATE compras a 'recibida'.
--
-- Atomicidad: si fn_registrar_gasto o cualquier paso falla, ROLLBACK
-- total. La OC queda en 'pedida' sin cambios.
--
-- Signature cambia de 7 a 10 params → DROP + CREATE.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_recibir_oc(
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR
);

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
  p_fechas_vencimiento DATE[] DEFAULT NULL
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
  -- ⭐ NUEVO 0045: plan de cuotas
  v_monto_resto DECIMAL(12,2);
  v_cuota_base DECIMAL(12,2);
  v_cuota_actual DECIMAL(12,2);
  v_pagar_anticipo BOOLEAN := FALSE;
  v_pagar_unica BOOLEAN := FALSE;
  v_turno_caja_efectivo BIGINT := NULL;
  v_cuota_fecha_pago DATE;
  v_cuota_medio_pago VARCHAR;
  v_cuota_turno_caja BIGINT;
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

  -- ── ⭐ NUEVO 0045: Validaciones del plan de cuotas ─────────────────
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
  -- Fechas en orden ascendente estricto.
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

  -- ── Proveedor (existe garantizado por FK de compras.proveedor_id) ─
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

    -- Cálculos derivados NETO + IVA + costo PPP.
    v_cant := v_bultos[v_i] * v_und_por_bulto[v_i];
    v_costo_unit_neto := ROUND(v_costos_por_bulto[v_i] / v_und_por_bulto[v_i]::DECIMAL, 2);
    v_subtotal_neto := v_bultos[v_i]::DECIMAL * v_costos_por_bulto[v_i];
    v_subtotal_iva := ROUND(v_subtotal_neto * v_tasas_iva[v_i] / 100, 2);
    v_subtotal_total := v_subtotal_neto + v_subtotal_iva;

    -- PPP según condición fiscal del club.
    IF v_condicion_fiscal = 'responsable_inscripto' THEN
      v_costo_unit_ppp := v_costo_unit_neto;
    ELSE
      v_costo_unit_ppp := ROUND(
        (v_costos_por_bulto[v_i] * (1 + v_tasas_iva[v_i] / 100))
        / v_und_por_bulto[v_i]::DECIMAL,
      2);
    END IF;

    -- stock_actual bajo el lock + PPP.
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

    -- Acumular totales para el gasto.
    v_monto_neto := v_monto_neto + v_subtotal_neto;
    v_monto_iva := v_monto_iva + v_subtotal_iva;
    v_monto_total := v_monto_total + v_subtotal_total;
  END LOOP;

  -- ── Monto del GASTO según condición fiscal (0043) ──────────────────
  -- responsable_inscripto: gasto = NETO (IVA es crédito fiscal).
  -- monotributista:        gasto = TOTAL con IVA (no recupera).
  IF v_condicion_fiscal = 'responsable_inscripto' THEN
    v_monto_gasto := v_monto_neto;
  ELSE
    v_monto_gasto := v_monto_total;
  END IF;

  -- ── ⭐ NUEVO 0045: validación anticipo contra monto del gasto ─────
  IF p_anticipo >= v_monto_gasto THEN
    RAISE EXCEPTION
      'El anticipo (%) no puede ser igual ni mayor al monto del gasto (%). Para pagar todo al instante usá 1 sola cuota sin anticipo.',
      p_anticipo, v_monto_gasto;
  END IF;

  -- ── ⭐ NUEVO 0045: resolver qué cuota se paga al recibir ──────────
  -- Solo aplica si vino pago (p_fecha_pago + p_medio_pago).
  IF p_fecha_pago IS NOT NULL THEN
    IF p_anticipo > 0 THEN
      v_pagar_anticipo := TRUE;
    ELSIF p_cantidad_cuotas = 1 THEN
      v_pagar_unica := TRUE;
    ELSE
      RAISE EXCEPTION
        'No se puede pagar al recibir en un plan multi-cuota sin anticipo. Indicá un anticipo > 0 o reducí a una sola cuota.';
    END IF;

    -- Si el pago es efectivo, validar caja abierta y capturar el turno.
    -- (Antes lo hacía fn_registrar_gasto al pasarle el pago directo;
    -- ahora el gasto nace pendiente y el pago va por cuota, validamos
    -- acá para que el efectivo siga atado a la caja del día.)
    IF p_medio_pago = 'efectivo' THEN
      v_turno_caja_efectivo := current_club_caja_abierta();
      IF v_turno_caja_efectivo IS NULL THEN
        RAISE EXCEPTION
          'No hay caja abierta. Pedile a la administración que abra la caja del día antes de pagar en efectivo.';
      END IF;
    END IF;
  END IF;

  -- ── DELETE compra_items vigentes (los de la pedida, sin movimientos) ─
  DELETE FROM compra_items WHERE compra_id = p_compra_id;

  -- ── Crear el gasto (SIEMPRE pendiente — el pago va por cuotas) ────
  -- ⭐ Cambio 0045: pasamos p_fecha_pago=NULL, p_medio_pago=NULL
  -- siempre. El pago al recibir, si aplica, se materializa marcando
  -- la cuota correspondiente como pagada (no setea gastos.fecha_pago).
  -- p_skip_cuota_automatica=TRUE para que fn_registrar_gasto NO genere
  -- la cuota total automática (acá generamos el plan completo abajo).
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
    p_fecha_pago := NULL,                     -- ⭐ 0045: siempre NULL
    p_medio_pago := NULL,                     -- ⭐ 0045: siempre NULL
    p_proveedor_id := v_proveedor.id,
    p_fecha_vencimiento := NULL,              -- ⭐ 0045: no aplica (skip)
    p_skip_cuota_automatica := TRUE           -- ⭐ 0045: generamos plan abajo
  );

  -- ── ⭐ NUEVO 0045: generar el plan de cuotas ──────────────────────
  v_monto_resto := v_monto_gasto - p_anticipo;

  -- Cuota 0 — anticipo (si > 0).
  IF p_anticipo > 0 THEN
    IF v_pagar_anticipo THEN
      -- El anticipo se paga al recibir.
      v_cuota_fecha_pago := p_fecha_pago;
      v_cuota_medio_pago := p_medio_pago;
      v_cuota_turno_caja := v_turno_caja_efectivo;       -- NULL si medio != efectivo
    ELSE
      v_cuota_fecha_pago := NULL;
      v_cuota_medio_pago := NULL;
      v_cuota_turno_caja := NULL;
    END IF;

    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id
    ) VALUES (
      v_club_id, v_gasto.id, 0, TRUE, p_anticipo,
      p_fecha_recepcion, v_cuota_fecha_pago, v_cuota_medio_pago, v_cuota_turno_caja,
      v_usuario_id
    );
  END IF;

  -- Cuotas 1..N regulares.
  -- Base = ROUND(resto / N, 2). Última cuota absorbe el residuo para
  -- que SUM(cuotas regulares) = v_monto_resto EXACTO (suma exacta
  -- con gastos.monto + anticipo = v_monto_gasto).
  v_cuota_base := ROUND(v_monto_resto / p_cantidad_cuotas::DECIMAL, 2);
  FOR v_i IN 1..p_cantidad_cuotas LOOP
    IF v_i = p_cantidad_cuotas THEN
      v_cuota_actual := v_monto_resto - (v_cuota_base * (p_cantidad_cuotas - 1));
    ELSE
      v_cuota_actual := v_cuota_base;
    END IF;

    -- ¿Se paga esta cuota al recibir? Solo si es la única (v_pagar_unica
    -- ⇔ N=1 sin anticipo + pago).
    IF v_pagar_unica AND v_i = 1 THEN
      v_cuota_fecha_pago := p_fecha_pago;
      v_cuota_medio_pago := p_medio_pago;
      v_cuota_turno_caja := v_turno_caja_efectivo;
    ELSE
      v_cuota_fecha_pago := NULL;
      v_cuota_medio_pago := NULL;
      v_cuota_turno_caja := NULL;
    END IF;

    INSERT INTO gasto_cuotas (
      club_id, gasto_id, numero, es_anticipo, monto,
      fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
      usuario_id
    ) VALUES (
      v_club_id, v_gasto.id, v_i, FALSE, v_cuota_actual,
      p_fechas_vencimiento[v_i], v_cuota_fecha_pago, v_cuota_medio_pago, v_cuota_turno_caja,
      v_usuario_id
    );
  END LOOP;

  -- ── INSERT compra_items + movimientos + UPDATE productos.costo ────
  -- Resto IDÉNTICO a 0043 — sin cambios en la lógica de stock + PPP.
  FOR v_i IN 1..v_n LOOP
    SELECT * INTO v_producto FROM productos WHERE id = v_pids[v_i];

    -- Recalcular derivados (idénticos al loop anterior, son baratos).
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

  -- ── UPDATE cabecera compras: 'recibida' + todos los datos ─────────
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
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR, DECIMAL, INT, DATE[]
) IS
  'Recibe una OC en estado=''pedida''. Genera plan de cuotas (anticipo
   opcional + N cuotas regulares). El gasto nace SIEMPRE pendiente
   (gastos.fecha_pago=NULL); el pago al recibir, si aplica, marca la
   cuota correspondiente como pagada — no toca gastos.fecha_pago.
   Snapshotea condicion_fiscal_club, lockea productos ASC, sube stock,
   recalcula PPP según condición fiscal (NETO si RI, TOTAL con IVA si
   monotributo), crea el gasto vía fn_registrar_gasto con
   p_skip_cuota_automatica=TRUE (acá generamos el plan). Atómica: si
   cualquier paso falla, ROLLBACK total. Pasa estado a ''recibida''.
   Gate: admin only.';

GRANT EXECUTE ON FUNCTION fn_recibir_oc(
  BIGINT, DATE, JSONB, VARCHAR, VARCHAR, DATE, VARCHAR, DECIMAL, INT, DATE[]
) TO authenticated;


-- ============================================================================
-- 8. fn_pagar_cuota — marcar una cuota como pagada
-- ============================================================================
-- Pagar una cuota pendiente. NO toca gastos.fecha_pago — el estado de
-- la deuda madre se deriva de la suma de cuotas pagadas.
--
-- Concurrencia: SELECT FOR UPDATE sobre la fila de la cuota antes de
-- validar fecha_pago. Si dos usuarios intentan pagar la misma cuota
-- al mismo tiempo, el segundo espera al COMMIT del primero y ve
-- fecha_pago seteada → RAISE 'Esta cuota ya está pagada'.
--
-- Regla de oro del efectivo: si p_medio_pago='efectivo', valida caja
-- abierta vía current_club_caja_abierta() y captura turno_caja_id.
-- Sin caja → RAISE accionable.
--
-- Gate: admin O vendedor (mismo que fn_registrar_gasto).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_pagar_cuota(
  p_cuota_id BIGINT,
  p_fecha_pago DATE,
  p_medio_pago VARCHAR
)
RETURNS gasto_cuotas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_cuota gasto_cuotas;
  v_turno_caja_id BIGINT := NULL;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;
  IF current_user_rol() NOT IN ('admin','vendedor') THEN
    RAISE EXCEPTION 'No tenés permisos para pagar cuotas.';
  END IF;

  -- Validaciones de input.
  IF p_fecha_pago IS NULL THEN
    RAISE EXCEPTION 'La fecha de pago es obligatoria.';
  END IF;
  IF p_medio_pago IS NULL
     OR p_medio_pago NOT IN ('efectivo','transferencia','mp','tarjeta','otro') THEN
    RAISE EXCEPTION 'Medio de pago inválido.';
  END IF;

  -- ── Lock exclusivo de la cuota + validación bajo el lock ──────────
  -- SELECT FOR UPDATE serializa pagos concurrentes a la misma cuota.
  -- Si la cuota no existe o no pertenece al club, RAISE. Si ya fue
  -- pagada (chequeo BAJO el lock — protege contra race entre dos
  -- llamadas simultáneas), RAISE accionable.
  SELECT * INTO v_cuota
  FROM gasto_cuotas
  WHERE id = p_cuota_id AND club_id = v_club_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuota no existe o no pertenece a tu club.';
  END IF;
  IF v_cuota.fecha_pago IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta cuota ya está pagada (% por %).',
      v_cuota.fecha_pago, v_cuota.medio_pago;
  END IF;

  -- ── Regla de oro del efectivo ─────────────────────────────────────
  -- Si pago en efectivo, atar a la caja abierta. Falla rápido antes
  -- del UPDATE.
  IF p_medio_pago = 'efectivo' THEN
    v_turno_caja_id := current_club_caja_abierta();
    IF v_turno_caja_id IS NULL THEN
      RAISE EXCEPTION
        'No hay caja abierta. Pedile a la administración que abra la caja del día antes de pagar en efectivo.';
    END IF;
  END IF;

  -- ── Marcar como pagada ────────────────────────────────────────────
  -- NO se toca gastos.fecha_pago. El estado del gasto (pendiente /
  -- parcial / saldado) se deriva on-the-fly de la suma de cuotas.
  UPDATE gasto_cuotas
  SET fecha_pago = p_fecha_pago,
      medio_pago = p_medio_pago,
      turno_caja_id = v_turno_caja_id
  WHERE id = p_cuota_id
  RETURNING * INTO v_cuota;

  RETURN v_cuota;
END;
$$;

COMMENT ON FUNCTION fn_pagar_cuota(BIGINT, DATE, VARCHAR) IS
  'Marca una cuota pendiente como pagada. Toma lock FOR UPDATE sobre
   la fila para prevenir doble-pago concurrente (re-chequea fecha_pago
   bajo el lock). Si medio_pago=efectivo, aplica regla de oro: valida
   caja abierta y captura turno_caja_id. NO toca gastos.fecha_pago —
   el estado de la deuda madre se deriva on-the-fly de la suma de
   cuotas. Gate: admin O vendedor del club.';

GRANT EXECUTE ON FUNCTION fn_pagar_cuota(BIGINT, DATE, VARCHAR) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0045_gasto_cuotas.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Estructura: tabla, CHECKs, índices ----------
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'gasto_cuotas'
-- ORDER BY ordinal_position;
-- → 11 columnas: id, club_id, gasto_id, numero, es_anticipo, monto,
--   fecha_vencimiento, fecha_pago, medio_pago, turno_caja_id,
--   usuario_id, fecha_alta.
--
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'gasto_cuotas'::regclass AND contype = 'c';
-- → 3 CHECKs: cuota_pago_atomico, cuota_efectivo_requiere_caja,
--   cuota_numero_anticipo_coherencia.
--
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'gasto_cuotas' ORDER BY indexname;
-- → 5 índices: PK + gasto_cuotas_unicas +
--   gasto_cuotas_unicidad_anticipo + idx_gasto_cuotas_pendientes +
--   idx_gasto_cuotas_gasto.

-- ---------- B. Backfill de gastos pendientes legacy ----------
-- SELECT COUNT(*) FROM gastos WHERE fecha_pago IS NULL AND activo = TRUE;
-- SELECT COUNT(*) FROM gasto_cuotas WHERE fecha_vencimiento IS NULL;
-- → Ambos cuentan lo mismo (1 cuota por gasto pendiente legacy).
--
-- SELECT g.id AS gasto_id, g.monto AS gasto_monto,
--        c.numero, c.monto AS cuota_monto, c.fecha_vencimiento
-- FROM gastos g
-- JOIN gasto_cuotas c ON c.gasto_id = g.id
-- WHERE g.fecha_pago IS NULL AND g.activo = TRUE
-- ORDER BY g.id;
-- → Una cuota por gasto, numero=1, monto=gasto.monto, vencimiento=NULL.

-- ---------- C. OC a plazo con anticipo + 3 cuotas (SUM exacto) -------
-- Tu club RI con monto_gasto = $10.000 NETO (tasa_iva=0):
--   await window.supabase.rpc('fn_recibir_oc', {
--     p_compra_id: <id_pedida>,
--     p_fecha_recepcion: '2026-05-23',
--     p_items_recepcion: [{ producto_id: <X>, cantidad_bultos: 10,
--                           unidades_por_bulto: 1, costo_por_bulto: 1000,
--                           tasa_iva: 0 }],
--     p_anticipo: 2500,
--     p_cantidad_cuotas: 3,
--     p_fechas_vencimiento: ['2026-06-23','2026-07-23','2026-08-23']
--   });
-- → SELECT numero, es_anticipo, monto, fecha_vencimiento, fecha_pago
--   FROM gasto_cuotas WHERE gasto_id = <gasto_id> ORDER BY numero;
-- → 4 filas:
--     numero=0, es_anticipo=TRUE,  monto=2500.00, venc=2026-05-23, pago=NULL
--     numero=1, es_anticipo=FALSE, monto=2500.00, venc=2026-06-23, pago=NULL
--     numero=2, es_anticipo=FALSE, monto=2500.00, venc=2026-07-23, pago=NULL
--     numero=3, es_anticipo=FALSE, monto=2500.00, venc=2026-08-23, pago=NULL
-- → SUM = 10000.00 EXACTO.
-- → gastos.fecha_pago = NULL (el plan vive en cuotas).

-- ---------- D. División con residuo de centavos ---------------------
-- Mismo escenario pero monto_gasto = $1.000 con N=3 sin anticipo:
-- → 3 cuotas: 333.33, 333.33, 333.34. SUM = 1000.00 EXACTO.

-- ---------- E. Recibir al contado (1 cuota pagada al instante) ------
-- Sin anticipo, N=1, pago al recibir:
--   await window.supabase.rpc('fn_recibir_oc', {
--     ...,
--     p_anticipo: 0,
--     p_cantidad_cuotas: 1,
--     p_fechas_vencimiento: ['2026-05-23'],
--     p_fecha_pago: '2026-05-23',
--     p_medio_pago: 'transferencia'
--   });
-- → gasto_cuotas: 1 fila con numero=1, monto=monto_gasto,
--   fecha_pago='2026-05-23', medio_pago='transferencia',
--   turno_caja_id=NULL (no efectivo).
-- → gastos.fecha_pago = NULL (el pago está en la cuota).

-- ---------- F. Anticipo pagado al recibir, cuotas pendientes ────────
-- anticipo=2500, N=3, pago al recibir:
--   await window.supabase.rpc('fn_recibir_oc', {
--     ...,
--     p_anticipo: 2500,
--     p_cantidad_cuotas: 3,
--     p_fechas_vencimiento: [f1, f2, f3],
--     p_fecha_pago: '2026-05-23',
--     p_medio_pago: 'efectivo'   -- requiere caja abierta
--   });
-- → cuota numero=0: fecha_pago='2026-05-23', medio='efectivo',
--   turno_caja_id=<caja abierta>.
-- → cuotas 1, 2, 3: pago=NULL.

-- ---------- G. fn_pagar_cuota path feliz ----------------------------
-- De la OC del paso C (anticipo pendiente):
--   await window.supabase.rpc('fn_pagar_cuota', {
--     p_cuota_id: <id_anticipo>,
--     p_fecha_pago: '2026-05-25',
--     p_medio_pago: 'transferencia'
--   });
-- → La cuota queda con fecha_pago='2026-05-25',
--   medio_pago='transferencia', turno_caja_id=NULL.
-- → Saldo del gasto = 10000 - 2500 = 7500 (calculado on-the-fly).
-- → gastos.fecha_pago sigue NULL.

-- ---------- H. RAISE multi-cuota sin anticipo + pago al recibir ────
--   await window.supabase.rpc('fn_recibir_oc', {
--     ...,
--     p_anticipo: 0,
--     p_cantidad_cuotas: 3,
--     p_fechas_vencimiento: [f1, f2, f3],
--     p_fecha_pago: '2026-05-23',
--     p_medio_pago: 'transferencia'
--   });
-- → ERROR: 'No se puede pagar al recibir en un plan multi-cuota sin
--   anticipo. Indicá un anticipo > 0 o reducí a una sola cuota.'

-- ---------- I. RAISE anticipo >= monto del gasto --------------------
-- monto_gasto=10000, p_anticipo=10000:
-- → ERROR: 'El anticipo (10000) no puede ser igual ni mayor al monto
--   del gasto (10000.00). Para pagar todo al instante usá 1 sola
--   cuota sin anticipo.'

-- ---------- J. RAISE fechas no ascendentes --------------------------
-- p_fechas_vencimiento: ['2026-06-23','2026-05-23','2026-07-23']:
-- → ERROR: 'Las fechas de vencimiento deben estar en orden
--   ascendente. Fecha 1 (2026-06-23) no es anterior a fecha 2
--   (2026-05-23).'

-- ---------- K. RAISE array size mismatch ----------------------------
-- p_cantidad_cuotas=3 con p_fechas_vencimiento=[f1, f2]:
-- → ERROR: 'Necesitás exactamente 3 fecha(s) de vencimiento, una por
--   cuota. Recibido: 2.'

-- ---------- L. RAISE re-pago (cuota ya pagada) ----------------------
-- Intentar pagar la cuota del paso G por segunda vez:
-- → ERROR: 'Esta cuota ya está pagada (2026-05-25 por transferencia).'

-- ---------- M. Anti doble-pago concurrente --------------------------
-- En 2 conexiones simultáneas sobre la misma cuota PENDIENTE:
--   conn1> BEGIN; SELECT fn_pagar_cuota(<id>, '2026-05-25', 'transferencia');
--   conn2> BEGIN; SELECT fn_pagar_cuota(<id>, '2026-05-25', 'mp');
--          (espera por FOR UPDATE de conn1)
--   conn1> COMMIT;
--   conn2> (continúa, lee fecha_pago seteado bajo el lock)
--          → ERROR 'Esta cuota ya está pagada (2026-05-25 por transferencia).'
--          ROLLBACK.
-- → Solo 1 fila pagada. Sin race condition.

-- ---------- N. Regla de oro del efectivo en fn_pagar_cuota ─────────
-- Sin caja abierta, intentar pagar cuota en efectivo:
--   await window.supabase.rpc('fn_pagar_cuota', {
--     p_cuota_id: <X>, p_fecha_pago: '2026-05-25', p_medio_pago: 'efectivo'
--   });
-- → ERROR: 'No hay caja abierta. Pedile a la administración que abra
--   la caja del día antes de pagar en efectivo.'
-- → La cuota sigue pendiente.

-- ---------- O. fn_registrar_gasto desde ABM crea cuota total ──────
-- Cargar gasto pendiente desde el ABM de gastos:
--   await window.supabase.rpc('fn_registrar_gasto', {
--     p_categoria_id: <X>, p_monto: 5000, p_fecha_gasto: '2026-05-23',
--     p_fecha_vencimiento: '2026-06-30'
--   });
-- → gastos: 1 fila nueva, fecha_pago=NULL.
-- → gasto_cuotas: 1 fila nueva, numero=1, es_anticipo=FALSE,
--   monto=5000.00, fecha_vencimiento='2026-06-30', fecha_pago=NULL.

-- ---------- P. fn_registrar_gasto pagado al instante NO crea cuota ─
-- Cargar gasto con pago al instante (camino legacy):
--   await window.supabase.rpc('fn_registrar_gasto', {
--     p_categoria_id: <X>, p_monto: 5000, p_fecha_gasto: '2026-05-23',
--     p_fecha_pago: '2026-05-23', p_medio_pago: 'transferencia'
--   });
-- → gastos: 1 fila nueva, fecha_pago='2026-05-23'.
-- → gasto_cuotas: 0 cuotas para ese gasto (pagado legacy, sin cuotas).
-- → El gasto NO aparece en el módulo CxP (ya está saldado).

-- ---------- Q. fn_recibir_oc + fn_registrar_gasto sin duplicar ────
-- fn_recibir_oc llama a fn_registrar_gasto con
-- p_skip_cuota_automatica=TRUE. Verificar que el gasto generado por
-- una recepción NO tiene cuota duplicada (solo las del plan):
-- → SELECT COUNT(*) FROM gasto_cuotas WHERE gasto_id = <gasto_de_oc>;
-- → Coincide con anticipo (0 o 1) + p_cantidad_cuotas. Sin extras.

-- ---------- R. EERR no cambió ──────────────────────────────────────
-- Antes de aplicar la 0045: tomar snapshot de useResumenFinanciero
-- del mes actual (ingresos, costos_directos, gastos_operativos,
-- resultado_neto, etc.).
-- Después de aplicar: mismo cálculo del mismo mes.
-- → Sin cambios en valores. Las cuotas son flujo de caja y no entran
-- al EERR. gastos.fecha_pago no influye en el cálculo
-- (useResumenFinanciero lee gastos.fecha_gasto = devengado).
-- compras_mercaderia_periodo sigue mostrando lo mismo.

-- ---------- S. fn_cerrar_venta sigue intacta ───────────────────────
-- Vender un producto post-0045:
--   await window.supabase.rpc('fn_cerrar_venta', { ... });
-- → venta_items.costo_unitario = productos.costo actual (PPP no se
--   vio afectado). movimientos_stock con fuente='venta', compra_id
--   NULL. Mismo comportamiento que pre-0045.

-- ---------- T. ROLLBACK total si fn_registrar_gasto falla ─────────
-- fn_recibir_oc con efectivo sin caja abierta:
--   await window.supabase.rpc('fn_recibir_oc', {
--     ...,
--     p_anticipo: 2500,
--     p_cantidad_cuotas: 3,
--     p_fechas_vencimiento: [f1, f2, f3],
--     p_fecha_pago: '2026-05-23',
--     p_medio_pago: 'efectivo'    -- caja cerrada
--   });
-- → ERROR temprano: 'No hay caja abierta...' (de fn_recibir_oc al
--   resolver v_turno_caja_efectivo, antes de tocar nada).
-- → ROLLBACK: la OC sigue en 'pedida'. Sin gasto, sin cuotas, sin
--   movimientos, sin productos.costo cambiado.

-- ---------- U. Estado derivado de la deuda ─────────────────────────
-- Para una compra a plazo recibida con 4 cuotas (anticipo + 3):
--
--   SELECT g.monto AS total,
--          COALESCE(SUM(c.monto) FILTER (WHERE c.fecha_pago IS NOT NULL), 0) AS pagado,
--          g.monto - COALESCE(SUM(c.monto) FILTER (WHERE c.fecha_pago IS NOT NULL), 0) AS saldo,
--          CASE
--            WHEN COUNT(*) FILTER (WHERE c.fecha_pago IS NULL) = 0 THEN 'saldada'
--            WHEN COUNT(*) FILTER (WHERE c.fecha_pago IS NOT NULL) = 0 THEN 'pendiente'
--            ELSE 'parcial'
--          END AS estado
--   FROM gastos g
--   LEFT JOIN gasto_cuotas c ON c.gasto_id = g.id
--   WHERE g.id = <X>
--   GROUP BY g.id, g.monto;
-- → Devuelve total, pagado, saldo, estado correctamente.
-- ============================================================================
