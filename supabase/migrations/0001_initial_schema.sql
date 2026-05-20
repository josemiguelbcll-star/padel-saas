-- ============================================================================
-- 0001_initial_schema.sql
-- Sprint 1 — Estructura de plataforma (multi-tenancy)
--
-- Crea las dos tablas base del SaaS y la función helper usada por las
-- futuras políticas RLS de las tablas de negocio:
--   - clubes:             tenants del sistema
--   - usuarios:           perfil extendido sobre auth.users, asociado a un club
--   - current_club_id():  función helper para usar en políticas RLS futuras
--
-- Habilita RLS en ambas tablas y define las políticas mínimas:
--   - clubes:   sólo SELECT del propio club (sección 5.2 del doc maestro)
--   - usuarios: SELECT del propio club + UPDATE restringido a rol 'admin'
--
-- Referencias del Documento Técnico Maestro v1.0:
--   - 4.1 Estructura de plataforma
--   - 5.2 Excepciones al patrón (clubes y usuarios)
--   - 5.3 Función helper para evitar repetición
--
-- Esta migración se ejecuta UNA sola vez en el SQL Editor de Supabase.
-- No se modifica una vez aplicada (regla CLAUDE.md nº 9). Si hace falta
-- corregir algo, se hace en una migración posterior (0002_..., etc).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: clubes (tenants del sistema)
--    Doc maestro 4.1
-- ============================================================================
CREATE TABLE clubes (
  id BIGSERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  slug VARCHAR(60) UNIQUE NOT NULL,
  direccion VARCHAR(255),
  ciudad VARCHAR(80),
  provincia VARCHAR(80),
  telefono VARCHAR(40),
  email VARCHAR(120),
  plan VARCHAR(20) NOT NULL DEFAULT 'gratis'
    CHECK (plan IN ('gratis', 'crece', 'club')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE clubes IS
  'Tenants del sistema. Cada club opera como una organización aislada.';

-- ============================================================================
-- 2. TABLA: usuarios (perfil extendido sobre auth.users)
--    Doc maestro 4.1
-- ============================================================================
CREATE TABLE usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(120) NOT NULL,
  rol VARCHAR(20) NOT NULL DEFAULT 'vendedor'
    CHECK (rol IN ('admin', 'vendedor')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Postgres no crea índice automáticamente para las FK. Lo agregamos
-- manualmente para que el filtro por club_id sea eficiente.
CREATE INDEX idx_usuarios_club ON usuarios(club_id);

COMMENT ON TABLE usuarios IS
  'Datos extendidos del usuario, complementa auth.users.';

-- ============================================================================
-- 3. FUNCIÓN: current_club_id()
--    Doc maestro 5.3
--
--    Devuelve el club_id del usuario autenticado actual.
--
--    - SECURITY DEFINER: corre con permisos del owner. En Supabase el
--      owner típicamente tiene BYPASSRLS, lo que evita recursión cuando
--      se usa dentro de políticas RLS de otras tablas.
--    - STABLE: Postgres puede cachear el resultado durante una misma
--      query y no la ejecuta una vez por fila (mejora importante de
--      performance).
--    - SET search_path: hardening de seguridad. Sin esto, un caller con
--      search_path manipulado podría engañar a la función para que
--      consulte una tabla `usuarios` ajena. Lo fijamos explícitamente.
--
--    IMPORTANTE: en este sprint NO usamos current_club_id() dentro de
--    las políticas de `usuarios` ni `clubes` (ver sección 4 y 5 abajo).
--    Aplicamos la subquery directa contra `usuarios` tal como muestra el
--    doc 5.2. La función queda lista para que las migraciones de tablas
--    de negocio (canchas, reservas, …) la consuman desde el sprint 2.
-- ============================================================================
CREATE OR REPLACE FUNCTION current_club_id()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT club_id FROM usuarios WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION current_club_id() IS
  'Devuelve el club_id del usuario autenticado actual. Pensada para
   usarse dentro de políticas RLS de tablas de negocio a partir del
   sprint 2. STABLE + SECURITY DEFINER.';

-- Permitir a usuarios autenticados invocar la función desde sus queries
-- (la lógica de seguridad sigue siendo el SECURITY DEFINER + auth.uid).
GRANT EXECUTE ON FUNCTION current_club_id() TO authenticated;

-- ============================================================================
-- 4. RLS: clubes
--    Doc maestro 5.2 (excepción al patrón: SÓLO SELECT)
--
--    Los usuarios pueden LEER únicamente su propio club. No definimos
--    políticas de INSERT/UPDATE/DELETE: RLS deniega por default, así que
--    esas operaciones quedan reservadas a Edge Functions con service_role
--    (donde se gestiona el alta y modificación del club).
-- ============================================================================
ALTER TABLE clubes ENABLE ROW LEVEL SECURITY;

-- Concedemos sólo SELECT al rol authenticated. Sin política de INSERT/
-- UPDATE/DELETE estas operaciones quedan bloqueadas tanto por falta de
-- privilegios como por falta de policy.
GRANT SELECT ON clubes TO authenticated;

CREATE POLICY "clubes_select"
ON clubes FOR SELECT TO authenticated
USING (id = (SELECT club_id FROM usuarios WHERE id = auth.uid()));

-- ============================================================================
-- 5. RLS: usuarios
--    Doc maestro 5.2 (excepción al patrón: SELECT amplio, UPDATE sólo admin)
--
--    Nota sobre WITH CHECK: el doc maestro define usuarios_update_solo_admin
--    sólo con USING. La regla nº 3 del CLAUDE.md ("Toda política de
--    INSERT/UPDATE lleva WITH CHECK") nos obliga a replicar las
--    condiciones también en WITH CHECK. Sin esto, un admin podría hacer
--    UPDATE moviendo a un usuario a otro club o "ascendiéndose" alguien
--    a admin fuera de su scope. Las dos cláusulas son idénticas a
--    propósito.
--
--    No definimos políticas de INSERT/DELETE: los usuarios se crean vía
--    Supabase Auth + alta manual (o trigger futuro) y se desactivan
--    seteando `activo = false`, no borrándolos.
-- ============================================================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON usuarios TO authenticated;

CREATE POLICY "usuarios_select"
ON usuarios FOR SELECT TO authenticated
USING (club_id = (SELECT club_id FROM usuarios WHERE id = auth.uid()));

CREATE POLICY "usuarios_update_solo_admin"
ON usuarios FOR UPDATE TO authenticated
USING (
  club_id = (SELECT club_id FROM usuarios WHERE id = auth.uid())
  AND (SELECT rol FROM usuarios WHERE id = auth.uid()) = 'admin'
)
WITH CHECK (
  club_id = (SELECT club_id FROM usuarios WHERE id = auth.uid())
  AND (SELECT rol FROM usuarios WHERE id = auth.uid()) = 'admin'
);

COMMIT;

-- ============================================================================
-- Fin de la migración 0001_initial_schema.sql
-- ============================================================================
