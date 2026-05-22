-- ============================================================================
-- 0021_gestion_club_plataforma.sql
-- Panel de Plataforma — Etapa 2, bloque siguiente (RPCs de gestión)
--
-- =====================================================================
-- ATENCIÓN — MIGRACIÓN DE SEGURIDAD.
-- =====================================================================
-- Esta migración agrega dos RPCs `SECURITY DEFINER` con gate de
-- superadmin para que el panel de plataforma pueda cambiar el plan y
-- el estado de cualquier club:
--
--   - `cambiar_plan_club(p_club_id, p_plan_id)`
--   - `cambiar_estado_club(p_club_id, p_estado)`
--
-- INVARIANTE DE PLATAFORMA — la garantía clave:
-- ─────────────────────────────────────────────────────────────────────
-- La potestad de cambiar el plan y el estado de un club es EXCLUSIVA
-- de la plataforma (superadmin). Un admin de club NO puede:
--   - Autoascenderse de plan (`basico` → `pro`).
--   - Autoactivar su club si fue suspendido o dado de baja.
--   - Modificar el estado de su club desde la app.
--
-- Mecanismo elegido — RPCs SECURITY DEFINER vs policy + GRANT:
-- ─────────────────────────────────────────────────────────────────────
-- El GRANT UPDATE column-level sobre `clubes` (0003/0016/0017) cubre
-- las 6 columnas operativas que el admin de club edita (horarios,
-- nombre, color, logo). `plan_id` y `estado` (agregados en 0019)
-- quedan DELIBERADAMENTE FUERA del GRANT.
--
-- Si abriéramos un GRANT UPDATE (plan_id, estado) a `authenticated`
-- (rol, no usuario), CUALQUIER authenticated podría INTENTAR un
-- UPDATE — la policy sería la única barrera. Eso erosiona la defensa
-- en capas del proyecto.
--
-- Las RPCs SECURITY DEFINER mantienen el modelo intacto: la única vía
-- de cambio es vía función nombrada, con gate explícito al inicio
-- (`IF NOT current_user_is_plataforma_admin() THEN RAISE`). Sin
-- abrir GRANTs sobre clubes, sin policies UPDATE nuevas.
--
-- Garantías de diseño (mismo patrón que `clubes_resumen_plataforma`):
--
--   1. Gate explícito al inicio del body. Primera línea ejecutable.
--   2. SECURITY DEFINER + SET search_path = public — hardening
--      heredado del patrón del codebase.
--   3. VOLATILE (default — hacen UPDATE, no `STABLE`).
--   4. Validación de input antes del UPDATE: plan_id existe y está
--      activo; estado en enum válido.
--   5. RETURNING * — devuelve la fila actualizada al frontend.
--   6. RAISE si NOT FOUND (club inexistente).
--
-- NO modifica:
--   - Policies de `clubes` (siguen como están desde 0019).
--   - GRANTs sobre `clubes` (plan_id/estado siguen sin GRANT para
--     authenticated — solo modificables vía estas RPCs).
--   - Migración previa (regla CLAUDE.md nº 9).
-- ============================================================================

BEGIN;

-- ============================================================================
-- RPC 1: cambiar_plan_club(p_club_id, p_plan_id)
--
--    Asigna un plan distinto al club. En esta etapa el cambio sólo
--    actualiza el dato — el gating de módulos por plan se activa en
--    una etapa posterior (cuando se vendan planes diferenciados; hoy
--    todos los clubes en 'pro' por backfill 0019).
--
--    Validaciones:
--      - Caller es superadmin activo (gate de seguridad).
--      - p_plan_id existe en `planes` Y `activo = TRUE` — no se puede
--        asignar un plan deprecado (un plan con activo=FALSE puede ser
--        históricamente válido para clubes que ya lo tienen, pero no
--        para nuevas asignaciones).
--      - p_club_id existe.
--
--    Mensajes:
--      - 'No autorizado.'
--      - 'Plan inválido o no activo.'
--      - 'Club no encontrado.'
-- ============================================================================
CREATE OR REPLACE FUNCTION cambiar_plan_club(
  p_club_id BIGINT,
  p_plan_id BIGINT
)
RETURNS clubes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club clubes;
BEGIN
  -- Gate de seguridad — la línea crítica.
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  -- Validar que el plan existe y está activo.
  IF NOT EXISTS (
    SELECT 1 FROM planes WHERE id = p_plan_id AND activo = TRUE
  ) THEN
    RAISE EXCEPTION 'Plan inválido o no activo.';
  END IF;

  UPDATE clubes
  SET plan_id = p_plan_id
  WHERE id = p_club_id
  RETURNING * INTO v_club;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Club no encontrado.';
  END IF;

  RETURN v_club;
END;
$$;

COMMENT ON FUNCTION cambiar_plan_club(BIGINT, BIGINT) IS
  'Asigna un plan al club (panel de plataforma, etapa 2). SECURITY
   DEFINER con gate `current_user_is_plataforma_admin()`. Valida que
   el plan exista y esté activo. Devuelve la fila actualizada de
   clubes. Si el caller no es superadmin, RAISE "No autorizado.".';

GRANT EXECUTE ON FUNCTION cambiar_plan_club(BIGINT, BIGINT) TO authenticated;


-- ============================================================================
-- RPC 2: cambiar_estado_club(p_club_id, p_estado)
--
--    Cambia el estado del club entre 'trial', 'activo', 'suspendido',
--    'baja'. Recordatorio del impacto:
--      - 'trial', 'activo': el club opera normal.
--      - 'suspendido', 'baja': el SessionProvider bloquea el acceso al
--        próximo refresh (sumamos los error codes CLUB_SUSPENDIDO /
--        CLUB_BAJA en el bloque 2 del frontend).
--
--    Validaciones:
--      - Caller es superadmin activo.
--      - p_estado en el enum válido (defense in depth — el CHECK de
--        la tabla también lo valida, pero acá damos mensaje claro
--        antes de tocar la fila).
--      - p_club_id existe.
--
--    Mensajes:
--      - 'No autorizado.'
--      - 'Estado inválido.'
--      - 'Club no encontrado.'
-- ============================================================================
CREATE OR REPLACE FUNCTION cambiar_estado_club(
  p_club_id BIGINT,
  p_estado VARCHAR
)
RETURNS clubes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club clubes;
BEGIN
  IF NOT current_user_is_plataforma_admin() THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF p_estado NOT IN ('trial', 'activo', 'suspendido', 'baja') THEN
    RAISE EXCEPTION 'Estado inválido.';
  END IF;

  UPDATE clubes
  SET estado = p_estado
  WHERE id = p_club_id
  RETURNING * INTO v_club;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Club no encontrado.';
  END IF;

  RETURN v_club;
END;
$$;

COMMENT ON FUNCTION cambiar_estado_club(BIGINT, VARCHAR) IS
  'Cambia el estado del club (panel de plataforma, etapa 2). SECURITY
   DEFINER con gate `current_user_is_plataforma_admin()`. Valida que
   el estado sea uno de (trial, activo, suspendido, baja). Devuelve
   la fila actualizada. Si el estado pasa a suspendido o baja, el
   SessionProvider del frontend (bloque 2) bloquea el acceso de los
   usuarios del club en su próximo refresh.';

GRANT EXECUTE ON FUNCTION cambiar_estado_club(BIGINT, VARCHAR) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0021_gestion_club_plataforma.sql
-- ============================================================================


-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- Las queries siguientes están comentadas. Después de aplicar la
-- migración, ejecutalas para confirmar instalación + funcionamiento +
-- (CRÍTICO) que el gate de cada RPC rechaza correctamente a un admin
-- de club.
-- ============================================================================

-- ---------- A. Funciones existen ----------
-- SELECT proname, prosecdef, provolatile, pronargs
-- FROM pg_proc
-- WHERE proname IN ('cambiar_plan_club', 'cambiar_estado_club');
-- -- prosecdef debería ser 't' (SECURITY DEFINER).
-- -- provolatile debería ser 'v' (VOLATILE — hacen UPDATE).
-- -- pronargs debería ser 2 para ambas.

-- ---------- B. GRANT EXECUTE correcto ----------
-- SELECT routine_name, grantee, privilege_type
-- FROM information_schema.routine_privileges
-- WHERE routine_name IN ('cambiar_plan_club', 'cambiar_estado_club')
--   AND grantee = 'authenticated';
-- -- Debería listar EXECUTE para las dos.

-- ---------- C. TEST FUNCIONAL — como SUPERADMIN ----------
-- Logueate como josemiguelbcll@gmail.com y en la consola del browser:
--
--   // Cambiar el plan de un club al plan 'pro' (asumiendo plan_id correcto):
--   const { data: planes } = await window.supabase.from('planes').select('id, codigo');
--   const planPro = planes.find(p => p.codigo === 'pro');
--   const { data: clubes } = await window.supabase.rpc('clubes_resumen_plataforma');
--   const clubX = clubes[0];
--   await window.supabase.rpc('cambiar_plan_club', {
--     p_club_id: clubX.id, p_plan_id: planPro.id
--   });
--   // → { data: { id, nombre, plan_id, estado, ... }, error: null }
--
--   await window.supabase.rpc('cambiar_estado_club', {
--     p_club_id: clubX.id, p_estado: 'trial'
--   });
--   // → { data: { ..., estado: 'trial' }, error: null }

-- ---------- D. TEST CRÍTICO DEL GATE — como ADMIN DE CLUB ----------
-- ESTE ES EL TEST QUE GARANTIZA QUE LA POTESTAD DE PLAN/ESTADO ES
-- EXCLUSIVA DE LA PLATAFORMA. Logueate como cache@beatpadel.com.ar
-- (admin del club, NO superadmin) y en la consola del browser:
--
--   // Intento de autoascender el plan:
--   await window.supabase.rpc('cambiar_plan_club', {
--     p_club_id: <tu-club-id>, p_plan_id: 1
--   });
--   // → { data: null, error: { message: 'No autorizado.', code: 'P0001' } }
--
--   // Intento de autoactivarse (cambiar estado):
--   await window.supabase.rpc('cambiar_estado_club', {
--     p_club_id: <tu-club-id>, p_estado: 'activo'
--   });
--   // → { data: null, error: { message: 'No autorizado.', code: 'P0001' } }
--
--   // Intento sobre OTRO club:
--   await window.supabase.rpc('cambiar_plan_club', {
--     p_club_id: 99999, p_plan_id: 1
--   });
--   // → { data: null, error: { message: 'No autorizado.', code: 'P0001' } }
--   // (Falla en el gate ANTES de chequear si el club existe.)
--
-- Si CUALQUIERA de estas tres pruebas NO falla con 'No autorizado.',
-- PARAR. Significa que el gate no funciona y un club podría
-- autoascenderse / autoactivarse / tocar otros clubes.

-- ---------- E. TEST de validaciones server-side ----------
-- Como superadmin:
--
--   // Plan inexistente:
--   await window.supabase.rpc('cambiar_plan_club', {
--     p_club_id: 1, p_plan_id: 99999
--   });
--   // → 'Plan inválido o no activo.'
--
--   // Estado inválido:
--   await window.supabase.rpc('cambiar_estado_club', {
--     p_club_id: 1, p_estado: 'inventado'
--   });
--   // → 'Estado inválido.'
--
--   // Club inexistente:
--   await window.supabase.rpc('cambiar_estado_club', {
--     p_club_id: 99999, p_estado: 'activo'
--   });
--   // → 'Club no encontrado.'
-- ============================================================================
