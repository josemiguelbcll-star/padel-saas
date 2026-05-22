-- ============================================================================
-- 0020_clubes_resumen_plataforma.sql
-- Panel de Plataforma — Etapa 2, bloque 1 (RPC de resumen de clubes)
--
-- =====================================================================
-- ATENCIÓN — MIGRACIÓN DE SEGURIDAD.
-- =====================================================================
-- Esta migración crea una RPC `SECURITY DEFINER` que devuelve un
-- resumen de TODOS los clubes para el panel del superadmin (lista de
-- clubes con nombre, plan, estado, count de usuarios, count de canchas).
--
-- La RPC corre como `postgres` (BYPASSRLS), por lo que puede leer
-- tablas a las que el superadmin NO tiene acceso vía RLS (ej.
-- `canchas`, deliberadamente cerrada en la 0019 para mantener el
-- principio de mínimo privilegio).
--
-- Garantías de diseño:
--
--   1. GATE explícito al inicio del body: si el caller NO es
--      `plataforma_admin` activo, RAISE inmediato con 'No autorizado.'.
--      Si la función se invoca desde un caller no autorizado (admin
--      de club, vendedor, anónimo) — RECHAZA.
--
--   2. SECURITY DEFINER + STABLE + SET search_path = public — mismo
--      hardening que los helpers `current_club_id`,
--      `current_user_rol`, `current_user_is_plataforma_admin`. Sin
--      search_path explícito un caller podría tamperar tablas
--      apuntando a un schema malicioso.
--
--   3. Sin parámetros — cero superficie de inyección.
--
--   4. Devuelve SOLO agregados/snapshots, NO filas individuales de
--      canchas. El superadmin sigue sin poder enumerar canchas de un
--      club; solo ve el count. Coherente con la decisión de la 0019
--      ("el superadmin no accede a data operativa vía RLS").
--
--   5. NO modifica RLS de ninguna tabla. La función es una ruta
--      privilegiada EXTRA del superadmin, no una abertura del modelo
--      existente.
--
-- Si en el futuro se necesitan más métricas (cantidad de reservas,
-- ventas, último cobro, etc.), se amplía esta misma RPC. NO abrir
-- RLS de cada tabla operativa para el superadmin.
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9).
-- ============================================================================

BEGIN;

-- ============================================================================
-- RPC: clubes_resumen_plataforma()
--
--    Devuelve UNA fila por cada club, con:
--      - id, nombre, logo_path: datos de la tabla `clubes`.
--      - estado: enum 'trial'/'activo'/'suspendido'/'baja' (0019).
--      - plan_id, plan_codigo, plan_nombre: del JOIN con `planes`.
--      - fecha_alta: timestamp de creación del club.
--      - cantidad_usuarios: COUNT(usuarios) WHERE club_id = c.id AND
--        activo = TRUE. Sólo usuarios activos (los desactivados no
--        cuentan contra el "límite de usuarios por plan" que vendrá
--        más adelante).
--      - cantidad_canchas: COUNT(canchas) WHERE club_id = c.id. Todas
--        (canchas no tiene flag de activo en el schema actual).
--
--    Orden: alfabético por nombre del club (decisión del panel — para
--    operación del superadmin es más práctico encontrar por nombre que
--    por fecha de alta).
--
--    Llamada desde supabase-js:
--      const { data, error } = await supabase.rpc('clubes_resumen_plataforma');
--      // data: Array<{ id, nombre, logo_path, estado, plan_id,
--      //               plan_codigo, plan_nombre, fecha_alta,
--      //               cantidad_usuarios, cantidad_canchas }>
-- ============================================================================
CREATE OR REPLACE FUNCTION clubes_resumen_plataforma()
RETURNS TABLE (
  id BIGINT,
  nombre VARCHAR,
  logo_path VARCHAR,
  estado VARCHAR,
  plan_id BIGINT,
  plan_codigo VARCHAR,
  plan_nombre VARCHAR,
  fecha_alta TIMESTAMPTZ,
  cantidad_usuarios INT,
  cantidad_canchas INT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- =================================================================
  -- GATE DE SEGURIDAD — la línea más crítica de esta función.
  -- Si current_user_is_plataforma_admin() retorna FALSE (admin de
  -- club, vendedor, anónimo, superadmin desactivado), RECHAZA.
  -- Sin este check, el SECURITY DEFINER expondría TODOS los clubes
  -- a cualquier authenticated. El helper invocado retorna BOOLEAN
  -- puro (EXISTS, sin tri-state) — ver auditoría en 0019.
  -- =================================================================
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.nombre,
    c.logo_path,
    c.estado,
    c.plan_id,
    p.codigo,
    p.nombre,
    c.fecha_alta,
    (SELECT COUNT(*)::INT
       FROM usuarios u
       WHERE u.club_id = c.id
         AND u.activo = TRUE),
    (SELECT COUNT(*)::INT
       FROM canchas k
       WHERE k.club_id = c.id)
  FROM clubes c
  JOIN planes p ON p.id = c.plan_id
  ORDER BY c.nombre ASC;
END;
$$;

COMMENT ON FUNCTION clubes_resumen_plataforma() IS
  'Resumen de TODOS los clubes para el panel del superadmin (etapa 2).
   SECURITY DEFINER con gate `current_user_is_plataforma_admin()` al
   inicio — RAISE si el caller no es superadmin activo. Devuelve
   métricas agregadas (count de usuarios activos, count de canchas)
   sin exponer filas individuales de canchas/usuarios. Mantiene el
   principio de la 0019: el superadmin no accede a data operativa
   vía RLS; las métricas pasan por esta RPC privilegiada.

   Si en el futuro se necesitan más métricas (reservas, ventas,
   etc.), ampliar esta función — NO abrir RLS de cada tabla.';

GRANT EXECUTE ON FUNCTION clubes_resumen_plataforma() TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0020_clubes_resumen_plataforma.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Las queries siguientes están comentadas. Después de aplicar la
-- migración, ejecutalas en Studio para confirmar que la función está
-- instalada Y que el gate de seguridad funciona correctamente.
-- ============================================================================

-- ---------- A. Función existe ----------
-- SELECT proname, prosecdef, provolatile
-- FROM pg_proc
-- WHERE proname = 'clubes_resumen_plataforma';
-- -- prosecdef debería ser 't' (SECURITY DEFINER).
-- -- provolatile debería ser 's' (STABLE).

-- ---------- B. GRANT EXECUTE correcto ----------
-- SELECT grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_name = 'clubes_resumen_plataforma'
--   AND grantee = 'authenticated';
-- -- Debería listar EXECUTE.

-- ---------- C. TEST FUNCIONAL — como SUPERADMIN ----------
-- Logueate como josemiguelbcll@gmail.com (o cualquier plataforma_admin
-- activo) y en la consola del browser de la app, ejecutar:
--   await window.supabase.rpc('clubes_resumen_plataforma');
-- Debería retornar un array de objetos con TODOS los clubes
-- (ordenados alfabéticamente por nombre).
-- En SQL Editor de Studio (que corre como service_role, bypassa el
-- gate de auth.uid), no se puede testear directo — hay que invocarla
-- como un usuario real autenticado, o impersonarse vía supabase-js.

-- ---------- D. TEST DE GATE — como ADMIN DE CLUB ----------
-- Logueate como cache@beatpadel.com.ar (admin del club) y en la
-- consola del browser:
--   await window.supabase.rpc('clubes_resumen_plataforma');
-- Debería retornar { data: null, error: { message: 'No autorizado.' } }.
-- ESTO ES EL TEST CRÍTICO — confirma que el SECURITY DEFINER NO
-- expone clubes a admins de club.

-- ---------- E. TEST anónimo ----------
-- Sin sesión activa (logout), invocar la RPC desde un cliente
-- supabase-js con anon key:
--   await supabase.rpc('clubes_resumen_plataforma');
-- Debería retornar 'No autorizado.' (auth.uid() es NULL →
-- current_user_is_plataforma_admin() retorna FALSE → gate dispara).
-- ============================================================================
