-- ============================================================================
-- 0065_invitado_nombre_libre.sql
-- Relaja el CHECK de identidad de reserva_jugadores: un INVITADO ahora puede
-- tener nombre_libre (opcional).
--
-- =====================================================================
-- POR QUÉ
-- =====================================================================
-- Hasta la 0012 un invitado era ESTRICTAMENTE anónimo: jugador_id NULL,
-- nombre_libre NULL, es_titular FALSE. Para el módulo de reconciliación de
-- transferencias queremos poder capturar el NOMBRE de quien transfirió, aun
-- cuando esa persona sea un invitado (no juega, solo consume). El nombre se
-- guarda en `nombre_libre` (sin obligar a crear una ficha de jugador).
--
-- Cambio: el invitado pasa a permitir nombre_libre OPCIONAL. Sigue sin poder
-- tener jugador_id (no se le crea ficha) ni ser titular (no juega).
--
-- =====================================================================
-- QUÉ CAMBIA EXACTAMENTE
-- =====================================================================
-- CHECK anterior (0012 — reserva_jugadores_tipo_identidad):
--   tipo = 'jugador'
--   OR (tipo = 'invitado' AND es_titular = FALSE
--       AND jugador_id IS NULL AND nombre_libre IS NULL)
--
-- CHECK nuevo (0065 — mismo nombre, recreado):
--   tipo = 'jugador'
--   OR (tipo = 'invitado' AND es_titular = FALSE
--       AND jugador_id IS NULL)
--   → nombre_libre deja de estar forzado a NULL para invitados.
--
-- El brazo de 'jugador' NO cambia (cualquier combinación de identidad sigue
-- permitida, incluido el anónimo "Jugador N").
--
-- =====================================================================
-- QUÉ NO TOCA
-- =====================================================================
-- - La columna nombre_libre (ya existe, VARCHAR(120) nullable, 0004).
-- - RLS / GRANTs de reserva_jugadores (siguen los de 0004).
-- - tipo, es_titular, jugador_id (sin cambios estructurales).
-- - fn_crear_reserva ni ninguna RPC (los invitados se siguen creando sin
--   nombre; el nombre se setea por UPDATE al cobrar, en una parte posterior).
-- - Datos existentes: todos los invitados actuales tienen nombre_libre NULL,
--   que sigue siendo válido bajo el CHECK nuevo (no requiere backfill).
--
-- Idempotencia: DROP CONSTRAINT IF EXISTS por nombre exacto antes de recrear.
-- ============================================================================

BEGIN;

ALTER TABLE reserva_jugadores
  DROP CONSTRAINT IF EXISTS reserva_jugadores_tipo_identidad;

ALTER TABLE reserva_jugadores
  ADD CONSTRAINT reserva_jugadores_tipo_identidad CHECK (
    tipo = 'jugador'
    OR (tipo = 'invitado'
        AND es_titular = FALSE
        AND jugador_id IS NULL)
  );

COMMENT ON CONSTRAINT reserva_jugadores_tipo_identidad ON reserva_jugadores IS
  'Coordina tipo + identidad. jugador: cualquier combinación (incluido anónimo
   "Jugador N"). invitado: no titular y sin ficha (jugador_id NULL); desde la
   0065 PUEDE tener nombre_libre opcional (para capturar quién transfirió en la
   reconciliación de transferencias). Reemplaza la versión 0012 que forzaba
   nombre_libre NULL en invitados.';

COMMIT;

-- ============================================================================
-- Fin de la migración 0065_invitado_nombre_libre.sql
-- ============================================================================

-- ============================================================================
-- VERIFICACIONES POST-MIGRACIÓN — CORRER MANUALMENTE
-- ============================================================================
-- A. Constraint recreado:
--    \d+ reserva_jugadores  → reserva_jugadores_tipo_identidad SIN la cláusula
--    "nombre_libre IS NULL" en el brazo de invitado.
--
-- B. Invitado CON nombre ahora se acepta (antes fallaba):
--    UPDATE reserva_jugadores SET nombre_libre = 'Juan (transf.)'
--    WHERE tipo = 'invitado' AND id = <X>;   → OK.
--
-- C. Invitado con jugador_id sigue RECHAZADO:
--    UPDATE reserva_jugadores SET jugador_id = <Y>
--    WHERE tipo = 'invitado' AND id = <X>;   → ERROR (check violation).
--
-- D. Invitado titular sigue RECHAZADO:
--    UPDATE reserva_jugadores SET es_titular = TRUE
--    WHERE tipo = 'invitado' AND id = <X>;   → ERROR (check violation).
--
-- E. Jugador anónimo (ambos NULL) sigue VÁLIDO (brazo de jugador intacto).
-- ============================================================================
