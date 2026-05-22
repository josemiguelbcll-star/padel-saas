-- ============================================================================
-- 0019_plataforma_planes.sql
-- Panel de Plataforma del SaaS — Etapa 1 (cimiento)
--
-- =====================================================================
-- ATENCIÓN — MIGRACIÓN DE SEGURIDAD CRÍTICA.
-- =====================================================================
-- Esta migración introduce el rol SUPERADMIN (dueño del SaaS) que
-- puede ver TODOS los clubes. Las modificaciones a las RLS de `clubes`
-- y `usuarios` son las más sensibles del proyecto: si el helper
-- `current_user_is_plataforma_admin()` retorna TRUE indebidamente,
-- cualquier usuario vería todos los clubes.
--
-- Garantías de diseño:
--   1. El superadmin vive en una TABLA APARTE (`plataforma_admins`),
--      no en `usuarios`. Cero overlap con admins de club; imposible
--      "ascender" un admin de club a superadmin con un UPDATE.
--   2. La tabla `plataforma_admins` NO recibe GRANT INSERT/UPDATE/
--      DELETE a authenticated. El ÚNICO camino de alta es service_role
--      (vía Supabase Studio o Edge Function dedicada — etapa posterior).
--   3. El helper `current_user_is_plataforma_admin()` retorna BOOLEAN
--      puro (EXISTS, no NULL), SECURITY DEFINER + search_path fijo,
--      filtro `activo = TRUE`. Fail-closed natural.
--   4. Las RLS de `clubes` y `usuarios` SUMAN una ruta OR para el
--      superadmin — NO quitan la del club. Un admin de club sigue
--      viendo SOLO su club. Verificación obligatoria post-migración
--      al final del archivo.
--   5. Las RLS de las 17+ tablas de negocio (reservas, ventas, etc.)
--      NO se tocan. El superadmin NO accede a data operativa vía RLS.
--      Si necesita data operativa para soporte, lo hace vía Studio
--      con service_role (queda en audit log de Postgres).
--
-- Esta migración hace ocho cosas:
--
--   1. CREATE TABLE `plataforma_admins` + RLS (SELECT solo entre
--      superadmins, sin INSERT/UPDATE/DELETE para authenticated).
--
--   2. CREATE FUNCTION `current_user_is_plataforma_admin()` — el
--      helper crítico.
--
--   3. CREATE TABLE `modulos`, `planes`, `plan_modulos` (catálogo
--      configurable del modelo de planes). RLS: SELECT abierto al
--      authenticated (el frontend necesita leer para el upsell),
--      INSERT/UPDATE/DELETE solo superadmin.
--
--   4. SEED inicial: 9 módulos + 3 planes + plan_modulos. Todo con
--      ON CONFLICT DO NOTHING para idempotencia.
--
--   5. ALTER TABLE `clubes`:
--        - ADD COLUMN `plan_id` BIGINT NOT NULL (backfill 'pro').
--        - ADD COLUMN `estado` enum (backfill desde `activo`).
--      Los campos viejos `plan` (VARCHAR) y `activo` (BOOLEAN) quedan
--      DEPRECADOS con COMMENT — limpieza en migración posterior cuando
--      confirmemos cero uso.
--
--   6. CREATE FUNCTION `current_club_has_modulo(p_codigo)` — helper
--      para gating de módulos. NO se aplica todavía a ninguna RLS
--      existente (todos los clubes en plan 'pro' tras backfill, igual
--      acceso que antes). Las RLS de tablas premium lo incorporarán
--      en una migración posterior cuando se venda diferenciado.
--
--   7. DROP+CREATE RLS de `clubes` y `usuarios`: SUMAR `OR
--      current_user_is_plataforma_admin()` a la policy SELECT. Las
--      policies UPDATE NO se tocan (el superadmin no edita clubes
--      desde la app en esta etapa — etapa 2 las modifica cuando exista
--      panel visual).
--
--   8. Verificaciones críticas al final del archivo (SQL comentado
--      para correr manualmente y CONFIRMAR el aislamiento multi-tenant).
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLA: plataforma_admins
--
--    Modelo del superadmin. Vive aparte de `usuarios` para mantener
--    el invariante "todo usuario tiene un club" intacto, y para que
--    sea estructuralmente imposible escalar de admin de club a
--    superadmin (requiere INSERT en otra tabla — bloqueado para
--    authenticated).
--
--    Sin `rol` (todos son superadmin). Sin `club_id` (es de la
--    plataforma, no de un club). FK ON DELETE CASCADE a auth.users
--    (mismo patrón que `usuarios`).
-- ============================================================================
CREATE TABLE plataforma_admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre VARCHAR(120) NOT NULL,
  email VARCHAR(120) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notas TEXT
);

COMMENT ON TABLE plataforma_admins IS
  'Superadmins de la plataforma (dueño/equipo del SaaS). Vive aparte
   de `usuarios` para que el invariante multi-tenant "todo usuario
   tiene un club" no se rompa, y para que sea ESTRUCTURALMENTE
   imposible escalar de admin de club a superadmin (requiere INSERT
   en esta tabla, bloqueado para authenticated). Alta exclusiva por
   service_role (Studio o Edge Function dedicada).';


-- ============================================================================
-- 2. HELPER CRÍTICO: current_user_is_plataforma_admin()
--
--    =================================================================
--    PIEZA MÁS SENSIBLE DE TODA LA ETAPA.
--    =================================================================
--    Si retorna TRUE indebidamente, las RLS modificadas de `clubes` y
--    `usuarios` dejan ver TODOS los clubes a cualquiera. Por eso:
--
--      - SECURITY DEFINER + STABLE + search_path = public (hardening
--        contra tampering del search_path; mismo patrón que los
--        helpers existentes current_club_id / current_user_rol).
--
--      - Retorna BOOLEAN puro: EXISTS siempre devuelve t/f, nunca NULL.
--        Sin posibilidad de tri-state que confunda al OR de la RLS.
--
--      - Para retornar TRUE deben cumplirse SIMULTÁNEAMENTE:
--          (a) auth.uid() no NULL (caller autenticado — para anónimo
--              `id = auth.uid()` no matchea ninguna fila → EXISTS=false).
--          (b) Existe fila en plataforma_admins con id = auth.uid().
--          (c) Esa fila tiene activo = TRUE (un superadmin desactivado
--              no es superadmin).
--
--      - Fail-closed: si plataforma_admins no existe (caso edge,
--        migración no aplicada), el helper falla → cualquier RLS que
--        lo invoque también falla → bloqueo total. Sin fallback a TRUE.
--
--    GRANT EXECUTE a authenticated: mismo patrón que current_club_id
--    / current_user_rol. La lógica de seguridad es SECURITY DEFINER +
--    auth.uid(), no el GRANT.
-- ============================================================================
CREATE OR REPLACE FUNCTION current_user_is_plataforma_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM plataforma_admins
    WHERE id = auth.uid()
      AND activo = TRUE
  );
$$;

COMMENT ON FUNCTION current_user_is_plataforma_admin() IS
  '=== HELPER CRÍTICO DE SEGURIDAD ===
   Si retorna TRUE indebidamente, cualquier usuario ve todos los
   clubes (las RLS de clubes/usuarios tienen un OR con este helper).
   Garantías:
   - SECURITY DEFINER + STABLE + search_path = public.
   - BOOLEAN puro (EXISTS, nunca NULL).
   - Tabla plataforma_admins sin GRANT INSERT/UPDATE/DELETE a
     authenticated (único camino de alta: service_role).
   - Filtro activo = TRUE.
   - auth.uid() NULL (anónimo) → FALSE.
   Cualquier modificación a esta función debe pasar por revisión
   exhaustiva de seguridad.';

GRANT EXECUTE ON FUNCTION current_user_is_plataforma_admin() TO authenticated;


-- ============================================================================
-- 3. RLS: plataforma_admins
--
--    SELECT: solo superadmins ven a otros superadmins. Defensa contra
--    phishing/social engineering targeting superadmins desde admins
--    de club (no pueden ni enumerar los emails).
--
--    Sin GRANT INSERT/UPDATE/DELETE a authenticated. Sin policies de
--    INSERT/UPDATE/DELETE. Único camino de escritura: service_role
--    (Studio o Edge Function dedicada — etapa posterior).
-- ============================================================================
ALTER TABLE plataforma_admins ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON plataforma_admins TO authenticated;

CREATE POLICY "plataforma_admins_select"
ON plataforma_admins FOR SELECT TO authenticated
USING (current_user_is_plataforma_admin());


-- ============================================================================
-- 4. TABLAS: modulos, planes, plan_modulos
--
--    Modelo configurable de planes. Cambiar qué módulos incluye un
--    plan NO requiere tocar código — basta UPDATE en plan_modulos.
--
--    `codigo` UNIQUE en modulos y planes: es el identificador estable
--    que se referencia en el frontend (`useModuloHabilitado('buffet')`).
-- ============================================================================
CREATE TABLE modulos (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(40) UNIQUE NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion TEXT,
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE modulos IS
  'Catálogo de módulos del sistema (reservas, buffet, clases, etc.).
   `codigo` es el identificador estable usado en código (frontend y
   helper current_club_has_modulo). `activo=false` deshabilita el
   módulo globalmente (no aparece en ningún plan); útil para deprecar
   módulos sin borrarlos.';

CREATE TABLE planes (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(40) UNIQUE NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion TEXT,
  precio_mensual DECIMAL(12,2) NOT NULL DEFAULT 0
    CHECK (precio_mensual >= 0),
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE planes IS
  'Catálogo de planes del SaaS (basico, intermedio, pro, …).
   `codigo` es el identificador estable referenciado en backfills y
   código. `precio_mensual` queda en 0 hasta que se defina pricing
   real. `activo=false` no permite asignar nuevos clubes a ese plan
   (clubes existentes siguen — la baja de un plan se gestiona migrando
   los clubes a otro).';

CREATE TABLE plan_modulos (
  plan_id BIGINT NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
  modulo_id BIGINT NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, modulo_id)
);

COMMENT ON TABLE plan_modulos IS
  'Many-to-many entre planes y módulos. Cambiar qué módulos incluye
   un plan = UPDATE acá, sin tocar código. ON DELETE CASCADE simétrico
   (si se borra un plan o un módulo, sus relaciones también).';


-- ============================================================================
-- 5. RLS: modulos, planes, plan_modulos
--
--    Defensa en capas — escritura EXCLUSIVA de service_role.
--    ---------------------------------------------------------------
--    El catálogo de planes/módulos es producto de la PLATAFORMA. Un
--    admin de club no tiene ninguna razón para escribirlo. Por eso:
--
--      - GRANT SELECT a authenticated → el frontend lee el catálogo
--        para armar el upsell ("mejorá tu plan para desbloquear X").
--
--      - SIN GRANT INSERT/UPDATE/DELETE a authenticated. Sin GRANT,
--        ninguna sesión authenticated puede ejecutar esas operaciones,
--        incluso si por error alguna policy las permitiera. Defensa
--        en capas (mismo criterio que `plataforma_admins`).
--
--      - SIN GRANT USAGE/SELECT en las secuencias _id_seq. Las
--        secuencias se consumen al INSERT — sin GRANT de INSERT, no
--        hace falta acceso a la secuencia.
--
--      - Las policies "solo superadmin" para INSERT/UPDATE/DELETE
--        igual se crean como DOCUMENTACIÓN DE INTENCIÓN: dejan
--        explícita la regla "solo superadmin escribe el catálogo".
--        Sin GRANT, ninguna sesión authenticated las dispara — la
--        única vía de escritura ES service_role (Studio o futura
--        Edge Function de gestión de plataforma).
--
--      - Seed inicial: lo hace ESTA migración (que corre como
--        superuser). Para etapa 1 NO hay panel del superadmin, así
--        que nadie necesita escribir el catálogo desde una sesión
--        authenticated.
--
--    Cuando construyamos el panel (etapa posterior), evaluaremos:
--    Edge Function con service_role (patrón crear-vendedor) o un
--    GRANT acotado. Esa decisión es DESPUÉS de la 0019, no acá.
-- ============================================================================
ALTER TABLE modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_modulos ENABLE ROW LEVEL SECURITY;

-- SOLO lectura — la escritura queda exclusiva de service_role.
GRANT SELECT ON modulos TO authenticated;
GRANT SELECT ON planes TO authenticated;
GRANT SELECT ON plan_modulos TO authenticated;

-- ---------- modulos ----------
CREATE POLICY "modulos_select"
ON modulos FOR SELECT TO authenticated
USING (TRUE);   -- abierto: cualquier authenticated lo lee para upsell.

-- Policies de escritura como DOCUMENTACIÓN DE INTENCIÓN. Sin GRANT
-- INSERT/UPDATE/DELETE a authenticated, ninguna sesión authenticated
-- las dispara — la escritura es exclusiva de service_role.
CREATE POLICY "modulos_insert_solo_superadmin"
ON modulos FOR INSERT TO authenticated
WITH CHECK (current_user_is_plataforma_admin());

CREATE POLICY "modulos_update_solo_superadmin"
ON modulos FOR UPDATE TO authenticated
USING (current_user_is_plataforma_admin())
WITH CHECK (current_user_is_plataforma_admin());

CREATE POLICY "modulos_delete_solo_superadmin"
ON modulos FOR DELETE TO authenticated
USING (current_user_is_plataforma_admin());

-- ---------- planes ----------
CREATE POLICY "planes_select"
ON planes FOR SELECT TO authenticated
USING (TRUE);

CREATE POLICY "planes_insert_solo_superadmin"
ON planes FOR INSERT TO authenticated
WITH CHECK (current_user_is_plataforma_admin());

CREATE POLICY "planes_update_solo_superadmin"
ON planes FOR UPDATE TO authenticated
USING (current_user_is_plataforma_admin())
WITH CHECK (current_user_is_plataforma_admin());

CREATE POLICY "planes_delete_solo_superadmin"
ON planes FOR DELETE TO authenticated
USING (current_user_is_plataforma_admin());

-- ---------- plan_modulos ----------
CREATE POLICY "plan_modulos_select"
ON plan_modulos FOR SELECT TO authenticated
USING (TRUE);

CREATE POLICY "plan_modulos_insert_solo_superadmin"
ON plan_modulos FOR INSERT TO authenticated
WITH CHECK (current_user_is_plataforma_admin());

CREATE POLICY "plan_modulos_update_solo_superadmin"
ON plan_modulos FOR UPDATE TO authenticated
USING (current_user_is_plataforma_admin())
WITH CHECK (current_user_is_plataforma_admin());

CREATE POLICY "plan_modulos_delete_solo_superadmin"
ON plan_modulos FOR DELETE TO authenticated
USING (current_user_is_plataforma_admin());


-- ============================================================================
-- 6. SEED INICIAL — módulos + planes + plan_modulos
--
--    Todo con ON CONFLICT DO NOTHING (por UNIQUE `codigo` en modulos
--    y planes; por PK compuesta en plan_modulos). Idempotente.
-- ============================================================================

-- ---------- 6.a. Módulos del sistema ----------
INSERT INTO modulos (codigo, nombre, descripcion, orden) VALUES
  ('reservas', 'Reservas', 'Grilla de reservas de canchas', 10),
  ('cuenta_turno', 'Cuenta del turno', 'Personas, consumos y pagos por turno (tipo restaurante)', 20),
  ('buffet', 'Buffet', 'Catálogo de productos, ventas de mostrador y stock', 30),
  ('clases', 'Clases', 'Profesores, agenda de clases y cobros', 40),
  ('caja', 'Caja', 'Apertura/cierre de caja, arqueo, conciliación', 50),
  ('gastos', 'Gastos', 'Registro y categorización de gastos del club', 60),
  ('reportes', 'Reportes / EERR', 'Estado de resultados por unidad de negocio', 70),
  ('gestion_usuarios', 'Gestión de usuarios', 'Alta/edición de vendedores y administradores del club', 80),
  ('marca', 'Identidad de marca', 'Color, logo y nombre personalizado del club', 90)
ON CONFLICT (codigo) DO NOTHING;

-- ---------- 6.b. Planes ----------
INSERT INTO planes (codigo, nombre, descripcion, precio_mensual, orden) VALUES
  ('basico', 'Básico', 'Plan gratuito — reservas básicas. Marca genérica, sin gestión de usuarios.', 0, 10),
  ('intermedio', 'Intermedio', 'Reservas + buffet + cuenta del turno + identidad de marca + gestión de usuarios.', 0, 20),
  ('pro', 'Pro', 'Todo el sistema completo (clases, caja, gastos, reportes).', 0, 30)
ON CONFLICT (codigo) DO NOTHING;

-- ---------- 6.c. plan_modulos — qué incluye cada plan ----------
--    Inserciones usando JOIN por codigo para no depender de IDs
--    hardcodeados (resiliente si los IDs autoincrement cambian).

-- BÁSICO: solo reservas.
INSERT INTO plan_modulos (plan_id, modulo_id)
SELECT p.id, m.id
FROM planes p, modulos m
WHERE p.codigo = 'basico'
  AND m.codigo IN ('reservas')
ON CONFLICT DO NOTHING;

-- INTERMEDIO: reservas + cuenta_turno + buffet + marca + gestion_usuarios.
INSERT INTO plan_modulos (plan_id, modulo_id)
SELECT p.id, m.id
FROM planes p, modulos m
WHERE p.codigo = 'intermedio'
  AND m.codigo IN (
    'reservas', 'cuenta_turno', 'buffet', 'marca', 'gestion_usuarios'
  )
ON CONFLICT DO NOTHING;

-- PRO: todos los módulos activos.
INSERT INTO plan_modulos (plan_id, modulo_id)
SELECT p.id, m.id
FROM planes p, modulos m
WHERE p.codigo = 'pro'
  AND m.activo = TRUE
ON CONFLICT DO NOTHING;


-- ============================================================================
-- 7. ALTER TABLE clubes — plan_id NOT NULL + estado enum
--
--    plan_id: backfill todos los clubes existentes al plan 'pro'
--    (cero impacto funcional — siguen teniendo acceso a todo, igual
--    que pre-0019). Cuando se vendan planes reales, se reasignan
--    manualmente desde Studio o el panel cuando exista.
--
--    estado: enum derivado del booleano `activo` (activo=TRUE →
--    'activo', activo=FALSE → 'suspendido'). El campo `activo` queda
--    deprecado pero NO se dropea — limpieza en migración posterior.
-- ============================================================================

-- 7.a. plan_id
ALTER TABLE clubes
  ADD COLUMN plan_id BIGINT REFERENCES planes(id);

UPDATE clubes
SET plan_id = (SELECT id FROM planes WHERE codigo = 'pro')
WHERE plan_id IS NULL;

ALTER TABLE clubes ALTER COLUMN plan_id SET NOT NULL;

COMMENT ON COLUMN clubes.plan_id IS
  'Plan asignado al club (FK a `planes`). Backfill inicial (0019)
   asignó "pro" a todos los clubes existentes — cero impacto
   funcional. Cuando se venda diferenciado, reasignaciones manuales
   o desde el panel de plataforma (etapa posterior).';

-- 7.b. estado
ALTER TABLE clubes
  ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'activo'
  CHECK (estado IN ('trial', 'activo', 'suspendido', 'baja'));

UPDATE clubes SET estado = 'suspendido' WHERE activo = FALSE;

COMMENT ON COLUMN clubes.estado IS
  'Estado del club desde la perspectiva de la plataforma:
     - "trial":      período de prueba (free, con fecha de fin).
     - "activo":     pagando o gratis activo.
     - "suspendido": acceso bloqueado temporalmente (por falta de pago,
                     decisión de soporte, etc.). Puede reactivarse.
     - "baja":       baja definitiva. Datos conservados pero sin acceso.
   Backfill desde `activo` (TRUE→activo, FALSE→suspendido).';

-- 7.c. COMMENTs deprecating los campos viejos
COMMENT ON COLUMN clubes.plan IS
  'DEPRECADO desde la 0019. Usar `plan_id` (FK a planes). Se conserva
   como referencia legacy mientras el frontend lo lea. Limpieza en
   migración posterior cuando confirmemos cero uso.';

COMMENT ON COLUMN clubes.activo IS
  'DEPRECADO desde la 0019. Usar `estado` (enum). Se conserva por
   compatibilidad con código existente. Limpieza posterior.';


-- ============================================================================
-- 8. HELPER: current_club_has_modulo(p_codigo)
--
--    Para el gating de módulos. Se crea acá (después del ALTER que
--    sumó plan_id a clubes) y queda listo para que las RLS de las
--    tablas premium lo incorporen en una migración posterior cuando
--    se venda diferenciado.
--
--    En ESTA etapa no se aplica a ninguna RLS — todos los clubes en
--    plan 'pro' por backfill, así que el resultado sería idéntico al
--    acceso actual igual.
--
--    Comportamiento por caller:
--      - Admin/vendedor de club: TRUE si su plan incluye p_codigo.
--      - Superadmin: current_club_id() retorna NULL → FALSE (el
--        superadmin no opera módulos de club — accede a data
--        operativa por otras vías si hace falta).
--      - Anónimo: idem FALSE.
-- ============================================================================
CREATE OR REPLACE FUNCTION current_club_has_modulo(p_codigo VARCHAR)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clubes c
    JOIN plan_modulos pm ON pm.plan_id = c.plan_id
    JOIN modulos m ON m.id = pm.modulo_id
    WHERE c.id = current_club_id()
      AND m.codigo = p_codigo
      AND m.activo = TRUE
  );
$$;

COMMENT ON FUNCTION current_club_has_modulo(VARCHAR) IS
  'Retorna TRUE si el club del usuario actual tiene activado el
   módulo `p_codigo` en su plan asignado. Para gating de tablas
   premium en RLS — agregado al WHERE/USING como
   `current_club_has_modulo(''buffet'')`, etc.
   No aplicado todavía a ninguna policy en la 0019 — todos los clubes
   en plan "pro" por backfill, mismo acceso que pre-migración.';

GRANT EXECUTE ON FUNCTION current_club_has_modulo(VARCHAR) TO authenticated;


-- ============================================================================
-- 9. RLS MODIFICADAS: clubes y usuarios (SUMA OR superadmin)
--
--    =================================================================
--    CAMBIO DE MAYOR RIESGO DE LA MIGRACIÓN.
--    =================================================================
--    Las policies SELECT de clubes y usuarios se reemplazan para
--    AGREGAR una ruta OR para el superadmin. La ruta original
--    (`X = current_club_id()`) se mantiene EXACTA — el admin de club
--    sigue viendo SOLO su club. El OR solo agrega una vía adicional
--    para el superadmin.
--
--    Las policies UPDATE NO se tocan en esta etapa. El superadmin no
--    edita clubes/usuarios desde la app en etapa 1 (no hay panel
--    visual). Cuando exista panel (etapa posterior), se modifican
--    las policies UPDATE para sumar OR.
--
--    DROP + CREATE en lugar de ALTER POLICY (ALTER POLICY no permite
--    cambiar la expresión USING en todas las versiones de Postgres).
--
--    VERIFICACIÓN OBLIGATORIA POST-MIGRACIÓN: ver bloque comentado al
--    final del archivo. Probar como admin de club que SELECT FROM
--    clubes retorna SOLO el propio club. El aislamiento multi-tenant
--    es el invariante sagrado.
-- ============================================================================

-- ---------- 9.a. clubes_select ----------
DROP POLICY IF EXISTS "clubes_select" ON clubes;

CREATE POLICY "clubes_select"
ON clubes FOR SELECT TO authenticated
USING (
  id = current_club_id()
  OR current_user_is_plataforma_admin()
);

COMMENT ON POLICY "clubes_select" ON clubes IS
  'Admin de club ve SOLO su club (id = current_club_id()).
   Superadmin ve TODOS los clubes (OR current_user_is_plataforma_admin()).
   El OR es una SUMA de ruta, no quita la del club — el aislamiento
   entre clubes se mantiene exacto.';

-- ---------- 9.b. usuarios_select ----------
DROP POLICY IF EXISTS "usuarios_select" ON usuarios;

CREATE POLICY "usuarios_select"
ON usuarios FOR SELECT TO authenticated
USING (
  club_id = current_club_id()
  OR current_user_is_plataforma_admin()
);

COMMENT ON POLICY "usuarios_select" ON usuarios IS
  'Admin/vendedor de club ve SOLO los usuarios de su club
   (club_id = current_club_id()). Superadmin ve los usuarios de
   TODOS los clubes. El OR suma ruta para superadmin sin abrir
   filtración entre clubes.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0019_plataforma_planes.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Las queries siguientes están comentadas. Después de aplicar la
-- migración, ejecutalas en Studio para verificar que el cimiento
-- quedó correcto y, sobre todo, que el aislamiento multi-tenant NO
-- se rompió.
-- ============================================================================

-- ---------- A. Estructura ----------
-- Verificar que las 4 tablas nuevas existen:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('plataforma_admins', 'modulos', 'planes', 'plan_modulos');
--
-- Verificar columnas nuevas en clubes:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_name = 'clubes' AND column_name IN ('plan_id', 'estado');
--
-- Verificar helpers creados:
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('current_user_is_plataforma_admin', 'current_club_has_modulo');


-- ---------- B. Seed correcto ----------
--   SELECT codigo, nombre, orden FROM modulos ORDER BY orden;
--   -- Debería listar los 9 módulos.
--
--   SELECT codigo, nombre, precio_mensual FROM planes ORDER BY orden;
--   -- Debería listar basico, intermedio, pro.
--
--   SELECT p.codigo AS plan, m.codigo AS modulo
--   FROM plan_modulos pm
--   JOIN planes p ON p.id = pm.plan_id
--   JOIN modulos m ON m.id = pm.modulo_id
--   ORDER BY p.orden, m.orden;
--   -- Debería mostrar:
--   --   basico:     reservas
--   --   intermedio: reservas, cuenta_turno, buffet, marca, gestion_usuarios
--   --   pro:        TODOS los 9 módulos


-- ---------- C. Backfill correcto ----------
--   SELECT id, nombre, plan_id, estado, activo,
--          (SELECT codigo FROM planes WHERE id = clubes.plan_id) AS plan_codigo
--   FROM clubes;
--   -- Todos los clubes con plan_id NOT NULL y plan_codigo = 'pro'.
--   -- estado = 'activo' donde activo=TRUE, 'suspendido' donde FALSE.


-- ---------- D. CRÍTICO — Aislamiento multi-tenant ----------
-- TEST 1: como ADMIN DE TU CLUB (logueado en la app SaaS, NO superadmin):
--   Desde la consola del browser en la app, ejecutar:
--     await window.supabase.from('clubes').select('id, nombre');
--   Debe retornar UN SOLO club (tu club). Si retorna 0 o múltiples,
--   ALGO ESTÁ MAL — el OR rompió la condición original.
--
--   Igual con usuarios:
--     await window.supabase.from('usuarios').select('id, nombre, club_id');
--   Debe retornar SOLO usuarios de tu club_id.
--
-- TEST 2: como SUPERADMIN (creado manualmente — paso siguiente):
--   El SELECT FROM clubes debe retornar TODOS los clubes.
--   El SELECT FROM usuarios debe retornar TODOS los usuarios de todos
--   los clubes.
--
-- TEST 3: helper directo:
--   SELECT current_user_is_plataforma_admin();
--   -- Como admin de club: FALSE.
--   -- Como superadmin: TRUE.
--   -- Como anónimo (sin sesión): FALSE.


-- ---------- E. Seguridad de plataforma_admins ----------
--   SELECT column_name, privilege_type
--   FROM information_schema.column_privileges
--   WHERE table_name = 'plataforma_admins' AND grantee = 'authenticated';
--   -- Solo SELECT debería aparecer. Sin INSERT/UPDATE/DELETE.
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'plataforma_admins';
--   -- Solo "plataforma_admins_select" (SELECT). Sin policies de
--   -- INSERT/UPDATE/DELETE.


-- ---------- F. CREAR EL PRIMER SUPERADMIN (manual) ----------
-- 1. Authentication → Users → "Add user" → crear con email + password.
-- 2. Copiar el UUID del usuario recién creado.
-- 3. Ejecutar:
--      INSERT INTO plataforma_admins (id, nombre, email)
--      VALUES ('<UUID>', 'Tu Nombre', 'tu@email.com');
-- 4. NO insertarlo en `usuarios` (es de plataforma, no de un club).
-- 5. Probar login con ese usuario en la app — el SessionProvider
--    (bloque 2) lo detectará y mostrará la pantalla "bienvenido
--    superadmin" (bloque 3, una vez construida).
-- ============================================================================
