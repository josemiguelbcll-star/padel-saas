-- ============================================================================
-- 0038_proveedores.sql
-- Catálogo de proveedores del club (paso previo al módulo de compras
-- unificadas — Nivel B Bloque 2). ABM administrado por admin, con datos
-- opcionales: solo el nombre es obligatorio.
--
-- =====================================================================
-- ALCANCE
-- =====================================================================
-- - Crea tabla `proveedores` con nombre + 8 campos opcionales + activo
--   + fecha_alta.
-- - Unicidad case-insensitive del nombre dentro del club (mismo patrón
--   que productos_unique_nombre_por_club en 0009).
-- - RLS calcada de productos (0009): SELECT al club, INSERT/UPDATE/
--   DELETE admin.
-- - GRANT al rol authenticated; los gates reales viven en las policies.
--
-- NO crea: tabla compras (Bloque 2 del Nivel B), ni FK desde otras
-- tablas a proveedores. Tampoco crea trigger anti-DELETE con
-- dependencias — se sumará cuando aparezcan compras (mismo patrón que
-- trg_productos_no_borrar_con_movimientos en 0009).
--
-- =====================================================================
-- DECISIONES DE MODELADO
-- =====================================================================
-- - `que_provee` como TEXT libre (no FK a línea/categoría): un mismo
--   proveedor puede traer bebidas + algunos shop + alfajores; modelarlo
--   como FK fuerza decisiones binarias que la realidad incumple. Si en
--   el futuro aparece "filtrar proveedores por categoría", se modela
--   con tabla N:M (proveedor_categorias) en migración aparte.
-- - CUIT NO único: dos sucursales del mismo proveedor o un error de
--   carga harían chocar un UNIQUE y frenarían al admin sin razón.
-- - Sin CHECK de formato en cuit/email/teléfono: el frontend valida;
--   el server confía. Coherente con el resto del proyecto.
-- - Datos opcionales = NULL (no string vacío). El frontend convierte
--   "" → NULL antes de insert/update.
--
-- =====================================================================
-- POLICIES
-- =====================================================================
-- Patrón idéntico a productos (0009):
--   - SELECT: cualquier authenticated del club.
--   - INSERT/UPDATE/DELETE: solo admin del club (current_user_rol()).
-- WITH CHECK presente en INSERT y UPDATE (regla CLAUDE.md nº 3).
-- ============================================================================

BEGIN;

CREATE TABLE proveedores (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(120) NOT NULL,

  -- Opcionales: identificación + contacto.
  cuit VARCHAR(20),
  contacto_persona VARCHAR(120),
  contacto_telefono VARCHAR(40),
  contacto_email VARCHAR(120),

  -- Opcionales: operativos.
  condiciones_pago TEXT,
  que_provee TEXT,
  notas TEXT,

  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidad case-insensitive del nombre dentro del club. Mismo patrón
-- que productos: evita que "Coca Cola SA" y "coca cola sa" convivan
-- como dos proveedores distintos. UNIQUE funcional → índice aparte.
CREATE UNIQUE INDEX proveedores_unique_nombre_por_club
  ON proveedores (club_id, lower(nombre));

CREATE INDEX idx_proveedores_club_activo
  ON proveedores (club_id) WHERE activo;

COMMENT ON TABLE proveedores IS
  'Catálogo de proveedores del club. ABM admin. Datos opcionales
   excepto nombre. Las compras (Nivel B Bloque 2) van a referenciar
   esta tabla — cuando exista, sumar trigger anti-DELETE con
   dependencias (mismo patrón que productos).';

COMMENT ON COLUMN proveedores.que_provee IS
  'Texto libre describiendo qué provee. NO referencia línea/categoría
   por diseño: un proveedor puede mezclar líneas (bebidas + shop), y
   forzar FK frenaría casos reales. Si en el futuro se quiere filtrar
   por categoría, modelar tabla N:M aparte.';

COMMENT ON COLUMN proveedores.cuit IS
  'CUIT sin formato canónico ni UNIQUE: los duplicados aparentes
   (sucursales del mismo proveedor) son legítimos y el server no debe
   bloquearlos. Validación de formato — si existe — vive en el frontend.';


-- ============================================================================
-- 2. GRANTs (el gate real vive en las policies)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON proveedores TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE proveedores_id_seq TO authenticated;


-- ============================================================================
-- 3. RLS — patrón idéntico a productos (0009:216-247)
-- ============================================================================
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proveedores_select"
ON proveedores FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "proveedores_insert_solo_admin"
ON proveedores FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "proveedores_update_solo_admin"
ON proveedores FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "proveedores_delete_solo_admin"
ON proveedores FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


COMMIT;

-- ============================================================================
-- Fin de la migración 0038_proveedores.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================

-- ---------- A. Tabla existe con todas las columnas ----------
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'proveedores'
-- ORDER BY ordinal_position;
-- → 12 filas: id, club_id (no null), nombre (no null), cuit (null),
--   contacto_persona (null), contacto_telefono (null), contacto_email
--   (null), condiciones_pago (null), que_provee (null), notas (null),
--   activo (no null, default true), fecha_alta (no null, default now()).

-- ---------- B. RLS habilitada + 4 policies ----------
-- SELECT polname FROM pg_policy
-- WHERE polrelid = 'proveedores'::regclass
-- ORDER BY polname;
-- → 4 filas: proveedores_delete_solo_admin, proveedores_insert_solo_admin,
--   proveedores_select, proveedores_update_solo_admin.

-- ---------- C. UNIQUE case-insensitive ----------
-- Como admin del club X:
--   INSERT INTO proveedores (club_id, nombre) VALUES (X, 'Coca Cola SA');
--   INSERT INTO proveedores (club_id, nombre) VALUES (X, 'coca cola sa');
-- → 2da fila: ERROR 23505 (duplicate key).

-- ---------- D. INSERT solo admin ----------
-- Como vendedor del club X:
--   INSERT INTO proveedores (club_id, nombre) VALUES (X, 'Test');
-- → ERROR 42501 (RLS policy).

-- ---------- E. INSERT con solo nombre (resto opcional) ----------
-- Como admin del club X:
--   INSERT INTO proveedores (club_id, nombre) VALUES (X, 'Minimo Maxi');
-- → fila nueva con todos los opcionales NULL, activo=true.

-- ---------- F. UPDATE activo=false (soft-delete) ----------
-- Como admin:
--   UPDATE proveedores SET activo = false WHERE id = <id>;
-- → 1 fila afectada.

-- ---------- G. Aislamiento entre clubes ----------
-- Como admin del club Y:
--   SELECT * FROM proveedores WHERE id = <id_del_club_X>;
-- → 0 filas (RLS oculta el proveedor del otro club).
-- ============================================================================
