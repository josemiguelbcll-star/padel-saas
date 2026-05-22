-- ============================================================================
-- 0018_usuarios_modulo.sql
-- Gestión de usuarios/vendedores del club — bloque 1 (DB)
--
-- Hoy los roles admin/vendedor existen y se usan (RLS, current_user_rol(),
-- permisos de pantallas), pero NO hay pantalla para gestionar usuarios:
-- se crean a mano en Supabase Auth. Vamos a sumar:
--   - Edge Function `crear-vendedor` (bloque 2) — crea en auth.users +
--     INSERT en `usuarios` server-side con service_role.
--   - Sección "Usuarios" en Configuración (bloques 4-5) — listar, crear,
--     editar rol, activar/desactivar.
--
-- Esta migración prepara el lado DB para esos bloques:
--
--   1. ADD COLUMN `email` a `usuarios` (denormalización del email que
--      vive en `auth.users`). Sin el snapshot acá, la UI tendría que
--      consultar `auth.users` desde el front — imposible sin
--      service_role. La Edge Function llenará este campo al crear; el
--      backfill llena los usuarios existentes.
--
--   2. Backfill desde `auth.users` (la migración corre como superuser
--      → puede SELECT directo, bypassa RLS de auth).
--
--   3. REVOKE UPDATE table-level (concedido en 0001) + GRANT UPDATE
--      column-level explícito sobre `(nombre, rol, activo, email)`.
--      Refleja explícitamente qué columnas son updateables desde el
--      front. `id`, `club_id`, `fecha_alta` quedan inmutables — son
--      auditoría/identidad estructural. Mismo patrón column-level
--      que ya usamos en `clubes` (0003 + 0016 + 0017).
--      Esto es seguro: verifiqué que NO hay UPDATEs a `usuarios`
--      desde el frontend en el codebase actual.
--
--   4. Trigger `tr_proteger_ultimo_admin_activo` sobre `usuarios`.
--      BEFORE UPDATE OF (rol, activo) — sólo se evalúa cuando alguna
--      de esas columnas cambia. Si la fila ES admin activo y va a
--      dejar de serlo (cambio de rol O cambio a activo=false), valida
--      que haya OTRO admin activo en el mismo club. Sin él, RAISE.
--      Server-side, infalible vs UPDATEs desde el front, Studio, o
--      RPCs futuras. Defense in depth.
--
-- IMPORTANTE — NO toca la política RLS existente:
--   `usuarios_update_solo_admin` (0002) sigue restringiendo el UPDATE
--   a admin del mismo club. El GRANT column-level se SUMA a la
--   restricción RLS — la policy dice quién puede, el GRANT dice qué
--   columnas. El trigger es la red de seguridad de la regla del
--   último admin.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ADD COLUMN email — snapshot denormalizado de auth.users.email
--
--    Nullable porque el backfill puede dejar NULL para usuarios
--    huérfanos (raro — un `usuarios` cuya fila en `auth.users` fue
--    borrada y luego restaurada sin el campo, por ej.). En el flujo
--    normal (Edge Function `crear-vendedor`) la Edge Function lo
--    llena siempre.
--
--    CHECK length > 0 cuando no es NULL — defensivo contra strings
--    vacíos. Sin regex de email — el formato lo valida la Edge
--    Function (zod) y Supabase Auth al crear.
-- ============================================================================
ALTER TABLE usuarios
  ADD COLUMN email VARCHAR(120) NULL
  CHECK (email IS NULL OR length(email) > 0);

COMMENT ON COLUMN usuarios.email IS
  'Snapshot del email del usuario en `auth.users.email`. Denormalizado
   porque el front no puede leer `auth.users` sin service_role.
   Se llena al crear vía Edge Function `crear-vendedor` (0018-bloque-2).
   Backfill aplicado a usuarios pre-0018. Si el usuario cambia su
   email en Auth (raro), este snapshot queda desync hasta que se
   re-sincronice manualmente o vía trigger futuro AFTER UPDATE en
   auth.users.';


-- ============================================================================
-- 2. Backfill desde auth.users
--
--    UPDATE simple — la migración corre como superuser, puede leer
--    auth.users sin RLS. Sólo afecta filas con email NULL (idempotente
--    si se re-corre, aunque ADD COLUMN ya falla en re-run).
-- ============================================================================
UPDATE usuarios u
SET email = au.email
FROM auth.users au
WHERE au.id = u.id
  AND u.email IS NULL;


-- ============================================================================
-- 3. REVOKE UPDATE table-level + GRANT UPDATE column-level
--
--    El 0001 concedió UPDATE a nivel TABLA (todas las columnas
--    updateables sujeto a la policy). Lo restringimos column-level
--    para que `id`, `club_id`, `fecha_alta` queden NO updateables
--    desde el front (incluso si la policy lo permitiera).
--
--    Por qué es seguro: verifiqué que no hay UPDATEs a `usuarios`
--    desde el frontend hoy. Los nuevos hooks (useActualizarUsuario,
--    bloque 4) UPDATE-arán exactamente las 4 columnas concedidas.
-- ============================================================================
REVOKE UPDATE ON usuarios FROM authenticated;
GRANT UPDATE (nombre, rol, activo, email) ON usuarios TO authenticated;


-- ============================================================================
-- 4. Trigger: protección del último admin activo
--
--    Regla: un club NUNCA puede quedar sin admin activo. Si el club
--    se queda sin admin, nadie puede editar marca, configurar
--    horarios, gestionar usuarios — quedaría bloqueado.
--
--    El trigger BEFORE UPDATE OF (rol, activo) sólo se evalúa cuando
--    una de esas dos columnas cambia (optimización Postgres — no
--    dispara en UPDATE de `nombre` o `email`).
--
--    Lógica:
--      - Si OLD ES admin activo (OLD.rol='admin' AND OLD.activo=TRUE)
--      - Y NEW deja de ser admin activo (NEW.rol<>'admin' OR NEW.activo=FALSE)
--      - Entonces validar que hay OTRO admin activo en el mismo club.
--      - Si no hay → RAISE EXCEPTION con mensaje accionable.
--
--    Sin chequeo en INSERT (siempre OK crear admins). Sin chequeo en
--    DELETE (no borramos usuarios — desactivamos).
--
--    SECURITY DEFINER: corre como owner para que el COUNT(*) pueda
--    leer todos los usuarios del club sin importar la RLS del caller
--    (que ya está validada por la policy `usuarios_update_solo_admin`).
--    SET search_path = public por hardening (mismo patrón que los
--    helpers existentes).
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_proteger_ultimo_admin_activo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otros_admin_activos INT;
BEGIN
  -- Sólo nos interesa el caso "la fila DEJA de ser admin activo".
  -- Si OLD ya era vendedor o inactivo, o si NEW sigue siendo admin
  -- activo, no validamos nada.
  IF OLD.rol = 'admin'
     AND OLD.activo = TRUE
     AND (NEW.rol <> 'admin' OR NEW.activo = FALSE)
  THEN
    SELECT COUNT(*) INTO v_otros_admin_activos
    FROM usuarios
    WHERE club_id = OLD.club_id
      AND rol = 'admin'
      AND activo = TRUE
      AND id <> OLD.id;

    IF v_otros_admin_activos = 0 THEN
      RAISE EXCEPTION
        'No se puede desactivar ni cambiar de rol al último admin activo del club. Asigná otro admin antes.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_proteger_ultimo_admin_activo() IS
  'Trigger BEFORE UPDATE en `usuarios`. Garantiza que un club nunca
   se queda sin admin activo: si OLD era admin activo y NEW deja de
   serlo (cambio de rol O desactivación), valida que exista otro
   admin activo en el mismo club. Sin él, RAISE con mensaje
   accionable. SECURITY DEFINER + search_path fijo.';

-- DROP + CREATE para idempotencia (mismo patrón que ya usamos en
-- migraciones recientes con DROP POLICY IF EXISTS).
DROP TRIGGER IF EXISTS tr_proteger_ultimo_admin_activo ON usuarios;

CREATE TRIGGER tr_proteger_ultimo_admin_activo
BEFORE UPDATE OF rol, activo ON usuarios
FOR EACH ROW
EXECUTE FUNCTION fn_proteger_ultimo_admin_activo();

COMMENT ON TRIGGER tr_proteger_ultimo_admin_activo ON usuarios IS
  'Bloquea UPDATEs que dejarían al club sin admin activo. Se evalúa
   sólo en UPDATE OF (rol, activo) — los UPDATEs de nombre/email no
   disparan el trigger.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0018_usuarios_modulo.sql
-- ============================================================================
