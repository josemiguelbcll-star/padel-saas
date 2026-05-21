-- ============================================================================
-- 0012_reserva_jugadores_tipo.sql
-- Cuenta del turno — Paso 1b: modelar las personas del turno
--
-- Segunda etapa del módulo "cuenta del turno tipo restaurante" (ver
-- "Visión de producto: el turno como cuenta" en CLAUDE.md). Después de
-- enriquecer la ficha de jugadores en 0011, ahora modelamos las
-- PERSONAS de un turno puntual: jugadores (que pesan para la división
-- del alquiler) e invitados (que solo consumen).
--
-- Decisión: tabla única `reserva_jugadores` (la que ya existe) con un
-- flag `tipo` que diferencia 'jugador' de 'invitado'. NO se crea
-- tabla `reserva_invitados` aparte porque:
--   - Conceptualmente son "personas del turno", solo cambia el rol.
--   - El paso 4 (pagos por persona) va a tener una sola FK a
--     reserva_jugadores.id en vez de una FK polimórfica frágil.
--   - "Cuántas personas hubo" se calcula con COUNT(*) simple, no UNION.
--   - RLS, FKs y triggers no se duplican.
--
-- Esta migración hace cuatro cosas:
--
--   1. Agrega columna `tipo` (NOT NULL DEFAULT 'jugador') con CHECK enum.
--      El DEFAULT marca todas las filas pre-existentes como 'jugador'
--      (que es lo correcto: las reservas pre-0012 no tenían invitados).
--
--   2. Dropea el CHECK anónimo viejo (de 0004) que obligaba a tener
--      jugador_id O nombre_libre. Lo reemplaza un CHECK named que
--      coordina tipo con identidad:
--        - jugador: cualquier combinación de identidad permitida
--          (incluido ambos null = anónimo "Jugador N" numerado por la UI).
--        - invitado: estrictamente anónimo y no-titular.
--      El DROP es por nombre exacto (`reserva_jugadores_check`,
--      verificado en pg_constraint sobre la base actual) con
--      IF EXISTS para idempotencia.
--
--   3. Agrega índice compuesto (reserva_id, tipo) para queries futuras
--      "jugadores de esta reserva" (paso 3, división del alquiler) y
--      "invitados de esta reserva" (paso 4, cobro por persona).
--
--   4. Actualiza el COMMENT ON TABLE explicando la nueva semántica y la
--      regla de numeración "Jugador N" / "Invitado N" (derivada
--      client-side del orden de id, no persistida — los IDs son estables
--      para que los futuros pagos atados por id no se rompan al renumerar).
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). NO toca:
--   - RLS de reserva_jugadores (siguen abiertas a authenticated del club
--     desde 0004).
--   - fn_crear_reserva (los inserts existentes no pasan `tipo` y caen al
--     DEFAULT 'jugador'; sigue funcionando sin cambios).
--   - reserva.jugador_id (titular sigue siendo el "dueño" de la reserva).
--   - reserva_pagos (la FK jugador_id → jugadores se va a evolucionar en
--     el paso 4 a un esquema que apunte a reserva_jugadores.id).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Columna `tipo`
--    NOT NULL DEFAULT 'jugador' → backfilea filas existentes.
--    VARCHAR(20) consistente con otros enum-columns del codebase.
-- ============================================================================
ALTER TABLE reserva_jugadores
  ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'jugador'
  CHECK (tipo IN ('jugador', 'invitado'));

COMMENT ON COLUMN reserva_jugadores.tipo IS
  'Rol de la persona en el turno: jugador (juega + pesa para dividir
   el alquiler) o invitado (solo consume buffet, no juega ni paga
   alquiler). Default ''jugador'' (cubre las filas pre-0012).';


-- ============================================================================
-- 2. Reemplazar el CHECK anónimo viejo por uno con nombre que coordina
--    tipo + identidad
--
--    El CHECK viejo (de 0004) era inline anónimo:
--      CHECK (jugador_id IS NOT NULL OR nombre_libre IS NOT NULL)
--    Postgres lo guardó como `reserva_jugadores_check` (verificado en
--    pg_constraint sobre la base actual con definición
--    `CHECK (((jugador_id IS NOT NULL) OR (nombre_libre IS NOT NULL)))`).
--
--    Usamos DROP CONSTRAINT IF EXISTS para idempotencia: si por alguna
--    razón ya no estuviera (re-ejecución de la migración tras un
--    rollback parcial, intervención manual), la operación no rompe.
-- ============================================================================
ALTER TABLE reserva_jugadores
  DROP CONSTRAINT IF EXISTS reserva_jugadores_check;

ALTER TABLE reserva_jugadores
  ADD CONSTRAINT reserva_jugadores_tipo_identidad CHECK (
    tipo = 'jugador'
    OR (tipo = 'invitado'
        AND es_titular = FALSE
        AND jugador_id IS NULL
        AND nombre_libre IS NULL)
  );


-- ============================================================================
-- 3. Índice compuesto (reserva_id, tipo)
--    Acelera queries futuras "jugadores de esta reserva" (paso 3,
--    división del alquiler) y "invitados de esta reserva" (paso 4,
--    pagos por persona). El leading column reserva_id también sirve a
--    queries que filtran solo por reserva, redundante pero barato con
--    el índice idx_reserva_jugadores_reserva existente.
-- ============================================================================
CREATE INDEX idx_reserva_jugadores_reserva_tipo
  ON reserva_jugadores(reserva_id, tipo);


-- ============================================================================
-- 4. COMMENT ON TABLE actualizado
-- ============================================================================
COMMENT ON TABLE reserva_jugadores IS
  'Personas vinculadas a una reserva. Dos tipos (columna `tipo` desde 0012):

   - jugador: pesa para la división del alquiler (paso 3 del módulo
     cuenta del turno). Puede tener jugador_id (vinculado a ficha),
     nombre_libre (escrito sin ficha), o ambos null (anónimo "Jugador N",
     N derivado del orden de id en la UI). El titular es siempre
     tipo=jugador con es_titular=true.

   - invitado: no juega (no pesa para la división); solo consume.
     Estrictamente anónimo: jugador_id NULL, nombre_libre NULL,
     es_titular FALSE. La UI lo numera "Invitado N" por orden de id.

   La numeración "Jugador N" / "Invitado N" es visual (client-side),
   no se persiste. Los IDs en DB son estables — sirven para atar pagos
   por persona en el paso 4 del módulo sin romperse cuando la UI
   renumera al borrar uno del medio.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0012_reserva_jugadores_tipo.sql
-- ============================================================================
