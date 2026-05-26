-- ============================================================================
-- 0056_tesoreria_cuentas.sql
-- Tesorería — ETAPA 1 (fundación): cuentas configurables por club + mapeo
-- medio→cuenta por defecto + saldo inicial + vista de saldo.
--
-- =====================================================================
-- ALCANCE (lo que SÍ y lo que NO)
-- =====================================================================
-- Medios de pago: quedan FIJOS (enum de 5 valores). Esta migración NO los
-- toca. Modelo: el MEDIO es "cómo" llegó la plata (taxonomía universal);
-- la CUENTA es "dónde" está (configurable por club). Dimensiones
-- independientes.
--
-- ETAPA 1 (esta migración) es ADITIVA y AISLADA:
--   1. CREATE TABLE cuentas (configurable por club).
--   2. CREATE TABLE medio_cuenta_default (mapeo medio→cuenta por club).
--   3. Seed: por cada club existente, una cuenta "Efectivo"
--      (es_caja_fisica=true) + medio_cuenta_default['efectivo']→Efectivo.
--      Es el INVARIANTE que preserva la regla de oro del efectivo.
--   4. VIEW v_cuentas_saldo (security_invoker): saldo = saldo_inicial
--      (en Etapa 1 ningún movimiento tiene cuenta_id todavía).
--
-- NO TOCA (clave): las 6 tablas de plata (reserva_pagos, clase_cobros,
-- ventas, gastos, otros_ingresos, gasto_cuotas), las ~9 funciones de
-- cobro/pago, los 6 CHECKs de efectivo, ni fn_cerrar_caja. La regla de oro
-- del efectivo sigue funcionando IDÉNTICA (por el literal 'efectivo').
--
-- =====================================================================
-- REGLA DE ORO RECONCILIADA (preparada, no activada acá)
-- =====================================================================
-- Hoy "afecta el cajón/arqueo" = literal 'efectivo'. La cuenta sembrada
-- "Efectivo" con es_caja_fisica=true + el mapeo efectivo→Efectivo dejan
-- listo el puente: cuando la Etapa 2 cambie fn_cerrar_caja para sumar por
-- cuenta.es_caja_fisica (en vez del literal), el conjunto de filas será
-- IDÉNTICO → comportamiento preservado exacto.
--
-- v_movimientos_cuenta (el "libro mayor" derivado por UNION de las tablas
-- de plata) se construye en la ETAPA 2, cuando esas tablas tengan
-- cuenta_id. Acá no se puede (referenciaría una columna que no existe).
--
-- PENDIENTE FUTURO (no acá): seed de "Efectivo" para clubes NUEVOS
-- (en el alta de club / onboarding), y multimoneda (columna moneda).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: cuentas
-- ============================================================================
CREATE TABLE cuentas (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(80) NOT NULL,
  tipo VARCHAR(20) NOT NULL
    CHECK (tipo IN ('efectivo','banco','billetera','otro')),
  -- es_caja_fisica: las cuentas marcadas entran al ARQUEO del cajón.
  -- Generaliza la regla de oro del efectivo (la saca del literal). Es
  -- COMPORTAMIENTO, independiente de `tipo` (puede haber una caja chica
  -- es_caja_fisica=true y una reserva en caja fuerte es_caja_fisica=false).
  es_caja_fisica BOOLEAN NOT NULL DEFAULT false,
  -- Saldo al momento de empezar a usar tesorería (corte). El saldo vivo se
  -- construye encima (saldo_inicial + Σ movimientos atados, Etapa 2).
  saldo_inicial DECIMAL(12,2) NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  -- Metadato opcional: CBU / alias / nº de cuenta bancaria.
  detalle VARCHAR(120),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- No dos cuentas con el mismo nombre en un club.
  CONSTRAINT cuentas_nombre_unico_por_club UNIQUE (club_id, nombre)
);

CREATE INDEX idx_cuentas_club ON cuentas (club_id, orden, id);

COMMENT ON TABLE cuentas IS
  'Cuentas de tesorería configurables por club (efectivo, banco, billetera,
   etc.). El medio de pago dice "cómo" llegó la plata; la cuenta, "dónde"
   está. es_caja_fisica marca las que entran al arqueo del cajón.';

COMMENT ON COLUMN cuentas.es_caja_fisica IS
  'TRUE = la cuenta entra al arqueo de caja física (cajón). Generaliza la
   regla de oro del efectivo. Comportamiento, no taxonomía (independiente
   de tipo). Invariante: el club tiene >=1 es_caja_fisica y el medio
   efectivo mapea a una.';

COMMENT ON COLUMN cuentas.saldo_inicial IS
  'Saldo de la cuenta al momento del corte (empezar a usar tesorería). El
   saldo vivo = saldo_inicial + Σ movimientos atados (Etapa 2).';

-- ── RLS: SELECT club (vendedores la necesitan para elegir cuenta al
--    cobrar en Etapa 2); ABM solo admin. Sin DELETE (se desactiva con
--    activa=false; una cuenta con movimientos no se borra). ───────────────
ALTER TABLE cuentas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cuentas_select_propio_club"
ON cuentas FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "cuentas_insert_admin"
ON cuentas FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "cuentas_update_admin"
ON cuentas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

GRANT SELECT, INSERT, UPDATE ON cuentas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE cuentas_id_seq TO authenticated;


-- ============================================================================
-- 2. TABLA: medio_cuenta_default
--    Mapeo "en este club, tal medio cae por defecto en tal cuenta".
--    SIN default = AUSENCIA de fila (cuenta_id es NOT NULL). En Etapa 2,
--    un medio sin default obliga al operador a elegir cuenta al cobrar.
-- ============================================================================
CREATE TABLE medio_cuenta_default (
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  medio_pago VARCHAR(20) NOT NULL
    CHECK (medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro')),
  cuenta_id BIGINT NOT NULL REFERENCES cuentas(id) ON DELETE RESTRICT,

  -- Un solo default por (club, medio).
  PRIMARY KEY (club_id, medio_pago)
);

CREATE INDEX idx_medio_cuenta_default_cuenta
  ON medio_cuenta_default (cuenta_id);

COMMENT ON TABLE medio_cuenta_default IS
  'Cuenta por defecto de cada medio de pago, por club. Ausencia de fila =
   ese medio no tiene default → en Etapa 2 el operador elige la cuenta al
   cobrar. El medio efectivo siempre tiene fila (seed + invariante).';

ALTER TABLE medio_cuenta_default ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medio_cuenta_default_select_propio_club"
ON medio_cuenta_default FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "medio_cuenta_default_insert_admin"
ON medio_cuenta_default FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "medio_cuenta_default_update_admin"
ON medio_cuenta_default FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "medio_cuenta_default_delete_admin"
ON medio_cuenta_default FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON medio_cuenta_default TO authenticated;


-- ============================================================================
-- 3. SEED — invariante de la regla de oro (solo clubes EXISTENTES)
--    Por cada club sin cuentas: crear "Efectivo" (es_caja_fisica=true) y
--    mapear el medio 'efectivo' a ella. Idempotente.
--    (Clubes NUEVOS: el seed va en el alta de club — pendiente Etapa 1
--    frontend/onboarding.)
-- ============================================================================
INSERT INTO cuentas (club_id, nombre, tipo, es_caja_fisica, saldo_inicial, orden)
SELECT c.id, 'Efectivo', 'efectivo', true, 0, 0
FROM clubes c
WHERE NOT EXISTS (
  SELECT 1 FROM cuentas cu WHERE cu.club_id = c.id
);

INSERT INTO medio_cuenta_default (club_id, medio_pago, cuenta_id)
SELECT cu.club_id, 'efectivo', cu.id
FROM cuentas cu
WHERE cu.tipo = 'efectivo'
  AND cu.es_caja_fisica = true
  AND cu.nombre = 'Efectivo'
ON CONFLICT (club_id, medio_pago) DO NOTHING;


-- ============================================================================
-- 4. VIEW: v_cuentas_saldo (security_invoker → RLS del consultante)
--    Etapa 1: saldo = saldo_inicial (ningún movimiento tiene cuenta_id aún).
--    Etapa 2: saldo = saldo_inicial + Σ(ingresos) − Σ(egresos) ±
--    transferencias, derivado de v_movimientos_cuenta (UNION de las tablas
--    de plata) — se reemplaza el cuerpo SIN cambiar el contrato del frontend.
-- ============================================================================
CREATE VIEW v_cuentas_saldo
WITH (security_invoker = true) AS
SELECT
  c.*,
  c.saldo_inicial AS saldo
FROM cuentas c;

COMMENT ON VIEW v_cuentas_saldo IS
  'Saldo por cuenta. Etapa 1: saldo = saldo_inicial (sin movimientos
   atados). Etapa 2: saldo_inicial + Σ movimientos (vía v_movimientos_cuenta).
   security_invoker=true → respeta la RLS de cuentas por club.';

COMMIT;

-- ============================================================================
-- Fin de la migración 0056_tesoreria_cuentas.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- A. Tablas + vista creadas:
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('cuentas','medio_cuenta_default','v_cuentas_saldo');
--
-- B. Seed (como admin de un club, en la consola):
--    await window.supabase.from('cuentas').select('*');
--    → 1 fila "Efectivo", tipo='efectivo', es_caja_fisica=true (tu club).
--    await window.supabase.from('medio_cuenta_default').select('*');
--    → 1 fila: medio_pago='efectivo' → cuenta_id de "Efectivo".
--
-- C. Saldo:
--    await window.supabase.from('v_cuentas_saldo').select('nombre,saldo');
--    → Efectivo, saldo=0 (saldo_inicial).
--
-- D. Aislamiento multi-tenant: un usuario de OTRO club no ve estas cuentas.
--
-- E. ABM gateado a admin: un vendedor NO puede insertar/actualizar cuentas
--    (la policy admin lo frena).
--
-- F. NADA roto: cobros, ventas, cierre de caja siguen igual (esta migración
--    no tocó ninguna tabla/función de plata).
-- ============================================================================
