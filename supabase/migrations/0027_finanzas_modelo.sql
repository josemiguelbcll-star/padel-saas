-- ============================================================================
-- 0027_finanzas_modelo.sql
-- Módulo Financiero — Bloque 1 (modelo + precarga de fábrica).
--
-- =====================================================================
-- CONCEPTO
-- =====================================================================
-- Cada club organiza su negocio en UNIDADES (canchas, buffet, shop,
-- clases, estructura, etc.) configurables — nada hardcodeado.
--
-- Gastos DIRECTOS van atribuidos a una unidad (vía categoría). Gastos
-- de ESTRUCTURA van a una unidad tipo='estructura' (transversales:
-- alquiler, luz, sueldos).
--
-- Criterio devengado:
--   - fecha_gasto / fecha (otros_ingresos)  = a qué PERÍODO pertenece
--   - fecha_pago / fecha_cobro              = cuándo sale/entra la plata
-- Pueden ser distintas. fecha_pago NULL = pendiente de pago.
--
-- Ingresos se suman por unidad, mezclando todos los medios de pago.
-- El medio_pago solo decide si toca la caja (regla de oro del efectivo).
--
-- =====================================================================
-- ESTA MIGRACIÓN (0027)
-- =====================================================================
-- 1. Crea las 4 tablas: unidades_negocio, categorias_gasto, gastos,
--    otros_ingresos.
-- 2. Snapshots desnormalizados en gastos y otros_ingresos
--    (categoria_nombre, unidad_nombre, unidad_tipo) — patrón
--    venta_items/reserva_consumos. El EERR histórico no se rompe si
--    el admin renombra una unidad o reasigna una categoría.
-- 3. RLS multi-tenant: SELECT abierto a todo el club, INSERT/UPDATE
--    según rol. Sin DELETE policy (registros de plata son inmutables).
-- 4. fn_inicializar_finanzas(p_club_id): siembra 5 unidades y 17
--    categorías típicas de un club de pádel. Idempotente.
--
-- La 0028 viene después con: fn_registrar_gasto, fn_registrar_otro_ingreso,
-- y la modificación de fn_cerrar_caja para incluir gastos/otros_ingresos
-- en efectivo en el cálculo del esperado.
--
-- =====================================================================
-- REGLA DE ROL (registros operativos vs catálogo)
-- =====================================================================
-- - unidades_negocio + categorias_gasto: ABM solo admin (estructura
--   del negocio). SELECT todo el club.
-- - gastos + otros_ingresos: alta y modificación por admin O vendedor
--   (el vendedor puede pagar/cobrar algo del cajón durante su turno y
--   clasificarlo en el momento). SELECT todo el club.
-- - Sin DELETE en ninguna (registros de plata = soft-delete con
--   `activo=FALSE` cuando se implemente fn_anular en v2).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: unidades_negocio
-- ============================================================================
--    Cada club organiza sus unidades de forma flexible. El `tipo`
--    determina de dónde se agregan los ingresos en el EERR:
--      - canchas      → ingresos de reservas
--      - clases       → ingresos de clase_cobros
--      - buffet       → ingresos de ventas (linea='buffet')
--      - shop         → ingresos de ventas (linea='shop')
--      - auspicios    → ingresos manuales via otros_ingresos
--      - membresias   → ingresos manuales via otros_ingresos
--      - estructura   → SIN ingresos asociados (solo gastos transversales)
--      - otro         → escape para casos no cubiertos
--
--    UNIQUE PARCIAL: solo UNA unidad por club con tipo automático
--    (canchas/clases/buffet/shop) — porque los ingresos vienen de
--    tablas únicas y no se pueden desambiguar entre múltiples
--    unidades del mismo tipo. Los tipos manuales pueden tener varias.
-- ============================================================================
CREATE TABLE unidades_negocio (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(80) NOT NULL,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN (
    'canchas','clases','buffet','shop',
    'auspicios','membresias','estructura','otro'
  )),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  orden INT NOT NULL DEFAULT 0,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidad case-insensitive del nombre por club.
CREATE UNIQUE INDEX unidades_negocio_unique_nombre
  ON unidades_negocio (club_id, lower(nombre));

-- Unicidad PARCIAL para tipos con fuente de ingresos automática.
CREATE UNIQUE INDEX unidades_negocio_tipo_unico_si_automatico
  ON unidades_negocio (club_id, tipo)
  WHERE tipo IN ('canchas','clases','buffet','shop');

CREATE INDEX idx_unidades_negocio_club ON unidades_negocio (club_id, orden);

COMMENT ON TABLE unidades_negocio IS
  'Unidades de negocio del club. Determinan el agrupamiento del EERR.
   Tipo enum cerrado; cuando emerja una unidad nueva (ej. estacionamiento),
   se agrega vía migración.';

COMMENT ON COLUMN unidades_negocio.tipo IS
  'canchas/clases/buffet/shop: fuente de ingresos automática (uno por club).
   auspicios/membresias: ingresos manuales via otros_ingresos.
   estructura: sin ingresos, solo gastos transversales.
   otro: escape genérico.';


-- ============================================================================
-- 2. TABLA: categorias_gasto
-- ============================================================================
--    Cada categoría pertenece a UNA unidad. Si Buffet y Shop tienen
--    ambos "Mercadería", son dos filas distintas. Las ABM (alta,
--    cambio, desactivar) son del admin.
-- ============================================================================
CREATE TABLE categorias_gasto (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  unidad_id BIGINT NOT NULL REFERENCES unidades_negocio(id) ON DELETE RESTRICT,
  nombre VARCHAR(80) NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  orden INT NOT NULL DEFAULT 0,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX categorias_gasto_unique_nombre
  ON categorias_gasto (club_id, unidad_id, lower(nombre));

CREATE INDEX idx_categorias_gasto_unidad ON categorias_gasto (unidad_id, orden);


-- ============================================================================
-- 3. TABLA: gastos
-- ============================================================================
--    Registro contable de un gasto. Con SNAPSHOTS de categoría y
--    unidad (mismo patrón que venta_items/reserva_consumos) — si el
--    admin renombra una categoría o reasigna una a otra unidad, el
--    EERR histórico sigue siendo fiel a la clasificación al momento
--    de cargar.
--
--    Devengado vs caja:
--      - fecha_gasto NOT NULL: período al que pertenece (EERR).
--      - fecha_pago NULL = pendiente de pago. Si seteado, también
--        medio_pago obligatorio (CHECK gastos_pago_atomico).
--      - turno_caja_id NOT NULL solo si medio_pago='efectivo'
--        (CHECK gastos_efectivo_requiere_caja — regla de oro).
--        Lo setea fn_registrar_gasto en la 0028.
--
--    INMUTABLE de hecho: sin DELETE policy. Soft-delete con
--    `activo=FALSE` cuando se implemente fn_anular_gasto (v2 — deuda
--    anotada en el plan).
-- ============================================================================
CREATE TABLE gastos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  -- FK al catálogo (sin CASCADE — preserva historial si se borra el catálogo)
  categoria_id BIGINT NOT NULL REFERENCES categorias_gasto(id) ON DELETE RESTRICT,

  -- SNAPSHOTS al momento de la carga (patrón venta_items)
  categoria_nombre VARCHAR(80) NOT NULL,
  unidad_id BIGINT NOT NULL REFERENCES unidades_negocio(id) ON DELETE RESTRICT,
  unidad_nombre VARCHAR(80) NOT NULL,
  unidad_tipo VARCHAR(30) NOT NULL CHECK (unidad_tipo IN (
    'canchas','clases','buffet','shop',
    'auspicios','membresias','estructura','otro'
  )),

  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),

  -- Devengado
  fecha_gasto DATE NOT NULL,

  -- Caja (pago)
  fecha_pago DATE,
  medio_pago VARCHAR(20) CHECK (
    medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro')
  ),
  turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT,

  proveedor VARCHAR(120),
  observaciones TEXT,

  activo BOOLEAN NOT NULL DEFAULT TRUE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- CHECK 1: pago atómico (pendiente o pagado, sin estados intermedios).
  CONSTRAINT gastos_pago_atomico CHECK (
    (fecha_pago IS NULL AND medio_pago IS NULL AND turno_caja_id IS NULL)
    OR
    (fecha_pago IS NOT NULL AND medio_pago IS NOT NULL)
  ),

  -- CHECK 2: regla de oro del efectivo — si pagaste en efectivo,
  -- el gasto SIEMPRE queda atado a la caja abierta de ese momento.
  CONSTRAINT gastos_efectivo_requiere_caja CHECK (
    medio_pago IS DISTINCT FROM 'efectivo' OR turno_caja_id IS NOT NULL
  )
);

CREATE INDEX idx_gastos_club_fecha ON gastos (club_id, fecha_gasto DESC);
CREATE INDEX idx_gastos_unidad ON gastos (unidad_id, fecha_gasto DESC);
CREATE INDEX idx_gastos_turno_caja
  ON gastos (turno_caja_id) WHERE turno_caja_id IS NOT NULL;

COMMENT ON COLUMN gastos.fecha_gasto IS
  'Período al que pertenece el gasto (EERR — devengado). Puede ser
   anterior, igual o posterior a fecha_pago.';

COMMENT ON COLUMN gastos.fecha_pago IS
  'Cuándo salió la plata efectivamente (caja/banco). NULL = pendiente
   de pago. Si se setea, medio_pago también obligatorio.';

COMMENT ON COLUMN gastos.turno_caja_id IS
  'Caja a la que se ató este gasto. NOT NULL cuando medio_pago=efectivo
   (lo setea fn_registrar_gasto en la 0028). NULL en pendientes y en
   pagos no-efectivo.';


-- ============================================================================
-- 4. TABLA: otros_ingresos
-- ============================================================================
--    Ingresos manuales que NO pasan por reservas/ventas/clase_cobros
--    (auspicios, membresías, etc.). MISMA estructura que gastos pero
--    del lado ingreso.
--
--    Los ingresos operativos NO se duplican acá — el EERR los lee de
--    sus tablas originales (reservas, ventas, clase_cobros).
-- ============================================================================
CREATE TABLE otros_ingresos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),

  unidad_id BIGINT NOT NULL REFERENCES unidades_negocio(id) ON DELETE RESTRICT,
  unidad_nombre VARCHAR(80) NOT NULL,
  unidad_tipo VARCHAR(30) NOT NULL CHECK (unidad_tipo IN (
    'canchas','clases','buffet','shop',
    'auspicios','membresias','estructura','otro'
  )),

  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),

  -- Devengado
  fecha DATE NOT NULL,

  -- Caja (cobro)
  fecha_cobro DATE,
  medio_pago VARCHAR(20) CHECK (
    medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro')
  ),
  turno_caja_id BIGINT REFERENCES turnos_caja(id) ON DELETE RESTRICT,

  observaciones TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT otros_ingresos_cobro_atomico CHECK (
    (fecha_cobro IS NULL AND medio_pago IS NULL AND turno_caja_id IS NULL)
    OR
    (fecha_cobro IS NOT NULL AND medio_pago IS NOT NULL)
  ),
  CONSTRAINT otros_ingresos_efectivo_requiere_caja CHECK (
    medio_pago IS DISTINCT FROM 'efectivo' OR turno_caja_id IS NOT NULL
  )
);

CREATE INDEX idx_otros_ingresos_club_fecha ON otros_ingresos (club_id, fecha DESC);
CREATE INDEX idx_otros_ingresos_unidad ON otros_ingresos (unidad_id, fecha DESC);
CREATE INDEX idx_otros_ingresos_turno_caja
  ON otros_ingresos (turno_caja_id) WHERE turno_caja_id IS NOT NULL;


-- ============================================================================
-- 5. RLS y GRANTs
-- ============================================================================

-- ── unidades_negocio (catálogo, ABM admin) ───────────────────────────
ALTER TABLE unidades_negocio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unidades_negocio_select_propio_club"
ON unidades_negocio FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "unidades_negocio_insert_admin"
ON unidades_negocio FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "unidades_negocio_update_admin"
ON unidades_negocio FOR UPDATE TO authenticated
USING (club_id = current_club_id() AND current_user_rol() = 'admin')
WITH CHECK (club_id = current_club_id() AND current_user_rol() = 'admin');

-- Sin DELETE policy → fail-closed (desactivar con activa=FALSE).

GRANT SELECT, INSERT, UPDATE ON unidades_negocio TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE unidades_negocio_id_seq TO authenticated;


-- ── categorias_gasto (catálogo, ABM admin) ───────────────────────────
ALTER TABLE categorias_gasto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categorias_gasto_select_propio_club"
ON categorias_gasto FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "categorias_gasto_insert_admin"
ON categorias_gasto FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "categorias_gasto_update_admin"
ON categorias_gasto FOR UPDATE TO authenticated
USING (club_id = current_club_id() AND current_user_rol() = 'admin')
WITH CHECK (club_id = current_club_id() AND current_user_rol() = 'admin');

-- Sin DELETE policy.

GRANT SELECT, INSERT, UPDATE ON categorias_gasto TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE categorias_gasto_id_seq TO authenticated;


-- ── gastos (operativo, admin Y vendedor) ─────────────────────────────
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gastos_select_propio_club"
ON gastos FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "gastos_insert_admin_o_vendedor"
ON gastos FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- UPDATE para soporte futuro de fn_anular_gasto (soft-delete) y
-- fn_pagar_gasto (marcar pendiente como pagado). Por ahora, los
-- registros son inmutables de hecho (no hay RPC que UPDATE).
CREATE POLICY "gastos_update_admin_o_vendedor"
ON gastos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- Sin DELETE policy.

GRANT SELECT, INSERT, UPDATE ON gastos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE gastos_id_seq TO authenticated;


-- ── otros_ingresos (operativo, admin Y vendedor) ─────────────────────
ALTER TABLE otros_ingresos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "otros_ingresos_select_propio_club"
ON otros_ingresos FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "otros_ingresos_insert_admin_o_vendedor"
ON otros_ingresos FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

CREATE POLICY "otros_ingresos_update_admin_o_vendedor"
ON otros_ingresos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() IN ('admin','vendedor')
);

-- Sin DELETE policy.

GRANT SELECT, INSERT, UPDATE ON otros_ingresos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE otros_ingresos_id_seq TO authenticated;


-- ============================================================================
-- 6. Helpers privadas (para fn_inicializar_finanzas)
-- ============================================================================
--    Prefijo `_fin_init_*` indica helpers internas. SIN GRANT a
--    authenticated → solo accesibles desde fn_inicializar_finanzas o
--    desde service_role.
--
--    UPSERT idempotente: si la unidad/categoría ya existe (por nombre
--    case-insensitive dentro del club), devuelve el id existente sin
--    duplicar. Permite ejecutar fn_inicializar_finanzas múltiples
--    veces sin error ni duplicación.
-- ============================================================================

CREATE OR REPLACE FUNCTION _fin_init_unidad(
  p_club_id BIGINT,
  p_nombre VARCHAR,
  p_tipo VARCHAR,
  p_orden INT,
  OUT v_id BIGINT,
  OUT v_creada BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO unidades_negocio (club_id, nombre, tipo, orden)
  VALUES (p_club_id, p_nombre, p_tipo, p_orden)
  ON CONFLICT (club_id, lower(nombre)) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    v_creada := TRUE;
  ELSE
    v_creada := FALSE;
    SELECT id INTO v_id
    FROM unidades_negocio
    WHERE club_id = p_club_id AND lower(nombre) = lower(p_nombre);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _fin_init_categoria(
  p_club_id BIGINT,
  p_unidad_id BIGINT,
  p_nombre VARCHAR,
  p_orden INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO categorias_gasto (club_id, unidad_id, nombre, orden)
  VALUES (p_club_id, p_unidad_id, p_nombre, p_orden)
  ON CONFLICT (club_id, unidad_id, lower(nombre)) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id IS NOT NULL;  -- TRUE si la creó, FALSE si ya existía
END;
$$;


-- ============================================================================
-- 7. fn_inicializar_finanzas(p_club_id)
-- ============================================================================
--    Siembra el set de fábrica para un club:
--
--    5 UNIDADES:
--      - Canchas (canchas)
--      - Clases (clases)
--      - Buffet (buffet)
--      - Shop (shop)
--      - Estructura (estructura)
--
--    17 CATEGORÍAS:
--      Canchas:     Mantenimiento canchas, Iluminación, Productos limpieza
--      Clases:      Pagos a profesores, Material didáctico
--      Buffet:      Mercadería, Reposición vajilla
--      Shop:        Mercadería shop, Marketing artículos
--      Estructura:  Alquiler local, Servicios (luz/agua/gas/internet),
--                   Sueldos y cargas sociales, Impuestos y tasas,
--                   Mantenimiento general, Limpieza, Marketing general,
--                   Insumos oficina, Gastos bancarios, Otros
--
--    Idempotente: ejecutar dos veces no duplica nada (las helpers
--    usan ON CONFLICT DO NOTHING).
--
--    Gate de seguridad: SECURITY DEFINER + chequeo explícito de
--    `current_club_id() = p_club_id AND current_user_rol() = 'admin'`.
--    Solo el admin del propio club puede inicializar. Las llamadas
--    via service_role (ej. desde una Edge Function que cree un club
--    nuevo) bypassean el gate de auth.uid pero quedan registradas en
--    los logs de Supabase.
--
--    Retorna conteos para que el caller sepa cuánto se creó.
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
  v_u_canchas BIGINT;     v_u_canchas_creada BOOLEAN;
  v_u_clases BIGINT;      v_u_clases_creada BOOLEAN;
  v_u_buffet BIGINT;      v_u_buffet_creada BOOLEAN;
  v_u_shop BIGINT;        v_u_shop_creada BOOLEAN;
  v_u_estructura BIGINT;  v_u_estructura_creada BOOLEAN;
  v_unidades INT := 0;
  v_categorias INT := 0;
BEGIN
  -- =================================================================
  -- GATE de seguridad. Diferenciamos 3 casos vía auth.role()
  -- (helper oficial de Supabase, mismo nivel que auth.uid()):
  --
  --   1. service_role (Edge Function): auth.role() = 'service_role',
  --      auth.uid() = NULL, current_club_id() = NULL → aceptamos
  --      sin más chequeos (la Edge Function ya validó lo suyo).
  --   2. usuario autenticado real: auth.role() = 'authenticated',
  --      auth.uid() seteado → gate normal (club propio + admin).
  --   3. anónimo / sin JWT: auth.role() = 'anon', auth.uid() = NULL
  --      → RECHAZAR. Sin esto, un anónimo podría llamar la RPC y
  --      sembrar data en cualquier club (vulnerabilidad).
  -- =================================================================
  IF auth.role() = 'service_role' THEN
    NULL;  -- service_role: skip gate
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
  -- 5 UNIDADES (con orden para listados consistentes)
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

  -- =================================================================
  -- CATEGORÍAS por unidad
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

  -- Estructura (10)
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

  RAISE NOTICE 'fn_inicializar_finanzas para club %: % unidad(es) creadas, % categoría(s) creadas (idempotente, las que ya existían no se duplicaron).',
    p_club_id, v_unidades, v_categorias;

  RETURN QUERY SELECT v_unidades, v_categorias;
END;
$$;

COMMENT ON FUNCTION fn_inicializar_finanzas(BIGINT) IS
  'Siembra 5 unidades y 17 categorías de gasto típicas de un club de
   pádel. Idempotente — re-ejecutable sin duplicar (helpers internas
   usan ON CONFLICT DO NOTHING). Gate: solo admin del propio club, o
   service_role para invocaciones desde Edge Functions futuras.';

-- GRANT EXECUTE a authenticated → cualquier admin del club puede
-- llamarla (el gate del body filtra). service_role la puede llamar
-- siempre (bypassea RLS por default).
GRANT EXECUTE ON FUNCTION fn_inicializar_finanzas(BIGINT) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0027_finanzas_modelo.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Tablas creadas ----------
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('unidades_negocio','categorias_gasto','gastos','otros_ingresos')
-- ORDER BY table_name;
-- → 4 filas.

-- ---------- B. CHECKs críticos en gastos ----------
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'gastos'::regclass AND contype = 'c'
-- ORDER BY conname;
-- → Debería listar: gastos_pago_atomico, gastos_efectivo_requiere_caja,
--   gastos_monto_check, gastos_unidad_tipo_check, gastos_medio_pago_check.

-- ---------- C. UNIQUE parcial de tipos automáticos ----------
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'unidades_negocio' AND indexname LIKE '%tipo_unico%';
-- → indexdef debe contener "WHERE tipo IN ('canchas', 'clases', 'buffet', 'shop')".

-- ---------- D. Aislamiento multi-tenant (RLS) ----------
-- Como admin de un club:
--   SELECT COUNT(*) FROM unidades_negocio;
-- → solo las del propio club (vacío hasta que se inicialice).
--
-- Intento de INSERT sin ser admin (logueado como vendedor):
--   INSERT INTO unidades_negocio (club_id, nombre, tipo) VALUES (<club>, 'Test', 'otro');
-- → debe fallar por RLS (insufficient_privilege o policy violation).

-- ---------- E. fn_inicializar_finanzas — primer uso (Signo Padel) ----------
-- Logueate como admin de Signo y en consola del browser:
--   await window.supabase.rpc('fn_inicializar_finanzas', { p_club_id: <ID de Signo> });
-- → { data: [{ unidades_creadas: 5, categorias_creadas: 17 }], error: null }
--
-- Verificar:
--   SELECT * FROM unidades_negocio ORDER BY orden;  → 5 filas con tipos correctos.
--   SELECT u.nombre AS unidad, c.nombre AS categoria, c.orden
--   FROM categorias_gasto c
--   JOIN unidades_negocio u ON u.id = c.unidad_id
--   ORDER BY u.orden, c.orden;
-- → 17 filas, agrupadas por unidad.

-- ---------- F. Idempotencia ----------
-- Ejecutar OTRA vez la misma RPC:
--   await window.supabase.rpc('fn_inicializar_finanzas', { p_club_id: <ID de Signo> });
-- → { data: [{ unidades_creadas: 0, categorias_creadas: 0 }], error: null }
-- → Sin duplicación. Las unidades/categorías existentes se respetan.

-- ---------- G. Gate de seguridad — club ajeno ----------
-- Logueado como admin de Signo, intentar inicializar OTRO club:
--   await window.supabase.rpc('fn_inicializar_finanzas', { p_club_id: 99999 });
-- → 'Solo podés inicializar las finanzas de tu propio club.' (P0001)

-- ---------- H. Gate de seguridad — rol vendedor ----------
-- Como vendedor de Signo:
--   await window.supabase.rpc('fn_inicializar_finanzas', { p_club_id: <ID de Signo> });
-- → 'Solo el administrador del club puede inicializar las finanzas.' (P0001)
-- ============================================================================
