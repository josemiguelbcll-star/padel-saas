-- ============================================================================
-- 0011_jugadores_ficha.sql
-- Cuenta del turno — Paso 1a: enriquecer la ficha de jugadores
--
-- Primera etapa del módulo "cuenta del turno tipo restaurante" (ver
-- "Visión de producto: el turno como cuenta" en CLAUDE.md). Antes de
-- modelar las personas de un turno puntual (paso 1b), aseguramos que
-- la ficha de jugadores tenga los datos que se van a usar para
-- estadísticas, armado de partidos por nivel/género y futura IA.
--
-- Esta migración hace tres cosas:
--
--   1. Agrega 3 columnas nullable a `jugadores`:
--        - genero     ('masculino' | 'femenino' | 'otro')
--        - categoria  ('octava' | 'septima' | ... | 'primera')   8 valores
--        - posicion   ('drive' | 'reves' | 'ambos')
--      Todas con CHECK enum + NULLABLE (NULL = "no cargado", NUNCA un
--      valor inventado por DEFAULT — la sinceridad del dato manda; el
--      vendedor puede crear un jugador sólo con nombre y completar
--      después).
--
--   2. Agrega un trigger BEFORE DELETE que bloquea borrar un jugador
--      cuando tiene referencias en reservas, reserva_jugadores o
--      reserva_pagos, con un mensaje accionable en castellano que
--      sugiere desactivarlo en su lugar. Mismo patrón que en clases
--      (0007) y productos (0009).
--
--   3. Ajusta la RLS de DELETE de jugadores: pasa de "cualquier
--      authenticated del club" (como estaba en 0004) a "club + rol
--      admin". Crear/editar jugadores sigue abierto al vendedor (caso
--      de uso operativo: cargar al cliente nuevo al vuelo en la
--      reserva); BORRAR queda como acción destructiva sólo-admin,
--      consistente con las otras DELETE destructivas del sistema
--      (clase_cobros, productos, ventas, etc.).
--
-- No modifica migraciones previas (regla CLAUDE.md nº 9). La RLS de
-- DELETE se modifica vía DROP POLICY + CREATE POLICY en esta nueva
-- migración. No toca:
--   - Las 3 RLS abiertas (SELECT/INSERT/UPDATE) — siguen como 0004.
--   - El campo `nivel` (texto libre legacy) — se conserva para no
--     perder datos cargados antes del 0011. Los UIs nuevos no lo
--     muestran; `categoria` (enum) lo reemplaza conceptualmente. Si en
--     algún momento se quiere mapear `nivel` → `categoria`, se hace
--     manualmente desde Supabase Studio (no automatizable: los valores
--     viejos pueden ser cualquier cosa, "3ra" / "B" / "principiante"...).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Columnas nuevas en jugadores
--
--    VARCHAR(20) para todas (consistente con el patrón de enum columns
--    del codebase: medio_pago, categoria de productos, fuente de
--    movimientos_stock). El CHECK con NULL pasa automáticamente
--    (FALSE falla, NULL pasa) — no requiere CHECK explícito de IS NULL.
-- ============================================================================
ALTER TABLE jugadores
  ADD COLUMN genero VARCHAR(20)
    CHECK (genero IN ('masculino', 'femenino', 'otro'));

ALTER TABLE jugadores
  ADD COLUMN categoria VARCHAR(20)
    CHECK (categoria IN (
      'octava', 'septima', 'sexta', 'quinta',
      'cuarta', 'tercera', 'segunda', 'primera'
    ));

ALTER TABLE jugadores
  ADD COLUMN posicion VARCHAR(20)
    CHECK (posicion IN ('drive', 'reves', 'ambos'));

COMMENT ON COLUMN jugadores.genero IS
  'Género del jugador. NULL = no cargado. Enum cerrado:
   masculino / femenino / otro. Usado para armado de partidos por
   género (mixto, masculino, femenino) en futuras pantallas.';

COMMENT ON COLUMN jugadores.categoria IS
  'Categoría del jugador en la escala oficial del pádel argentino
   (1ra a 8va). NULL = no cargado. Enum cerrado: octava / septima /
   sexta / quinta / cuarta / tercera / segunda / primera. Usado para
   armado de partidos por nivel.';

COMMENT ON COLUMN jugadores.posicion IS
  'Posición preferida del jugador en la cancha. NULL = no cargado.
   Enum cerrado: drive / reves / ambos. Útil para sugerencias de
   armado (un drive + un revés es la combinación más común).';

-- ============================================================================
-- 2. Deprecar columna `nivel` (texto libre legacy de 0004)
--
--    Se conserva la columna para no perder datos cargados antes del
--    0011. Los UIs nuevos no la muestran ni la escriben. El reemplazo
--    conceptual es `categoria`.
-- ============================================================================
COMMENT ON COLUMN jugadores.nivel IS
  'DEPRECADO desde la migración 0011. Texto libre legacy (ej. "3ra",
   "4ta", "B"). Reemplazado conceptualmente por `categoria` (enum
   cerrado). La columna se conserva para no perder datos pre-0011;
   los UIs nuevos no la leen ni escriben. Si en algún momento se
   quiere consolidar, mapeo manual desde Supabase Studio.';


-- ============================================================================
-- 3. Trigger anti-borrado con mensaje accionable
--
--    Los FKs de reservas, reserva_jugadores y reserva_pagos a jugadores
--    están sin ON DELETE explícito (default NO ACTION ≈ RESTRICT), así
--    que el DELETE de un jugador con referencias ya se bloquearía con
--    SQLSTATE 23503 genérico. Este trigger corre BEFORE DELETE y tira
--    un RAISE EXCEPTION en castellano explicando qué hacer.
--
--    Defense in depth: si por alguna razón el trigger no se disparara,
--    los FKs igual bloquean. Mismo patrón que clases (0007) y
--    productos (0009).
--
--    SECURITY INVOKER + SET search_path = public, igual que los otros
--    triggers de la base.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_check_jugador_sin_referencias()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reservas WHERE jugador_id = OLD.id)
     OR EXISTS (SELECT 1 FROM reserva_jugadores WHERE jugador_id = OLD.id)
     OR EXISTS (SELECT 1 FROM reserva_pagos WHERE jugador_id = OLD.id)
  THEN
    RAISE EXCEPTION
      'No se puede borrar el jugador porque tiene reservas o pagos asociados. Desactivalo en su lugar (campo "Activo" en off).';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION fn_check_jugador_sin_referencias IS
  'Trigger BEFORE DELETE en jugadores. Rechaza el borrado si hay
   reservas, acompañantes o pagos asociados, con mensaje accionable
   que sugiere desactivar el jugador.';

CREATE TRIGGER trg_jugadores_no_borrar_con_referencias
BEFORE DELETE ON jugadores
FOR EACH ROW EXECUTE FUNCTION fn_check_jugador_sin_referencias();


-- ============================================================================
-- 4. Ajustar RLS de DELETE: pasa a admin-only
--
--    Las RLS de SELECT/INSERT/UPDATE creadas en 0004 siguen igual
--    (abiertas a authenticated del club — caso de uso operativo: el
--    vendedor crea un jugador al vuelo en la reserva, edita el teléfono
--    cuando el cliente lo da, etc.).
--
--    DELETE pasa de "club" a "club + rol admin": borrar es una acción
--    destructiva (aunque el trigger anterior la bloquee si hay
--    referencias, un jugador sin reservas SÍ se puede borrar — un
--    vendedor podría hacerlo por error). Igual criterio que el resto
--    de los DELETE destructivos del sistema.
--
--    El gateo del botón "Eliminar" en el frontend va a ser cosmético
--    (useSession comparing rol === 'admin'); la seguridad real es esta
--    policy. Aunque un vendedor lograra disparar el DELETE
--    (consola/scripted), postgres lo rechaza con SQLSTATE 42501.
-- ============================================================================
DROP POLICY "jugadores_delete" ON jugadores;

CREATE POLICY "jugadores_delete"
ON jugadores FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


COMMIT;

-- ============================================================================
-- Fin de la migración 0011_jugadores_ficha.sql
-- ============================================================================
