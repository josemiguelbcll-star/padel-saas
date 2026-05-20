-- ============================================================================
-- 0003_canchas_y_tarifas.sql
-- Sprint 2 — Configuración del club: canchas, tarifas y horarios de operación
--
-- Esta migración hace tres cosas:
--
--   1. Agrega a la tabla `clubes` los campos de horario de operación que
--      el módulo Reservas del Sprint 3 va a consumir desde la grilla:
--        - hora_apertura TIME
--        - hora_cierre   TIME
--        - duracion_turno_default INTEGER DEFAULT 90
--      Habilita además un UPDATE acotado por columnas para que el admin
--      del club pueda configurarlos desde la pantalla de Horarios.
--
--   2. Crea las tablas `canchas` y `tarifas` (sección 4.2 del Documento
--      Técnico Maestro v1.0), con su RLS y los índices del modelo.
--
--   3. Define para cada tabla nueva 4 políticas RLS:
--        - SELECT  abierto a cualquier `authenticated` del club
--                  (el vendedor necesita leerlas para operar).
--        - INSERT/UPDATE/DELETE restringidos a rol 'admin' del club.
--      Este modelo refleja la sección 3.4 del doc: el vendedor opera
--      pero NO modifica configuración. Las políticas usan los helpers
--      current_club_id() y current_user_rol() creados en 0002 (rompen
--      la recursión RLS y centralizan la lógica de tenant + rol).
--
-- No se modifican las migraciones anteriores. Si en el futuro hace falta
-- corregir esta, va en 0004_… (regla CLAUDE.md nº 9).
--
-- Referencias del Documento Técnico Maestro v1.0:
--   - 3.4 Roles dentro del sistema (admin vs vendedor)
--   - 4.2 Configuración operativa del club (canchas, tarifas)
--   - 5.1 Patrón general de RLS (4 políticas por tabla, WITH CHECK)
--   - 5.3 Función helper current_club_id()
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ALTER clubes: agregar horarios de operación
--
--    Razonamiento de columnas (vs. JSONB en `config`):
--    - Tipos nativos del dominio (TIME, INTEGER) y CHECK constraints
--      directos.
--    - Hot path: la grilla del Sprint 3 consulta estos valores en cada
--      render, sin tener que extraer de JSON.
--    - Tipado limpio en el frontend (string para TIME, number para int).
--
--    Ambos campos hora_* arrancan en NULL. El club los va a setear en el
--    onboarding o desde Configuración → Horarios. Mientras estén en NULL
--    el frontend no permite reservar (la grilla del Sprint 3 va a pedir
--    apertura/cierre antes de renderizar).
--
--    El CHECK acepta ambos NULL o ambos seteados; si están seteados, el
--    cierre tiene que ser estrictamente posterior a la apertura.
-- ============================================================================
ALTER TABLE clubes
  ADD COLUMN hora_apertura TIME,
  ADD COLUMN hora_cierre TIME,
  ADD COLUMN duracion_turno_default INTEGER NOT NULL DEFAULT 90;

ALTER TABLE clubes
  ADD CONSTRAINT clubes_duracion_turno_default_valida
    CHECK (duracion_turno_default IN (60, 90, 120, 150, 180, 240));

ALTER TABLE clubes
  ADD CONSTRAINT clubes_horario_coherente
    CHECK (
      hora_cierre IS NULL
      OR hora_apertura IS NULL
      OR hora_cierre > hora_apertura
    );

COMMENT ON COLUMN clubes.hora_apertura IS
  'Hora desde la que se pueden reservar canchas (NULL = club sin configurar).';
COMMENT ON COLUMN clubes.hora_cierre IS
  'Hora hasta la que se pueden reservar canchas (estrictamente > hora_apertura).';
COMMENT ON COLUMN clubes.duracion_turno_default IS
  'Duración por defecto de cada turno en minutos. Limita los valores
   permitidos a los mismos de reservas.duracion_min (doc 4.3).';

-- Permiso a nivel COLUMNA: authenticated puede UPDATE únicamente estos
-- 3 campos en la tabla clubes. Ningún otro campo (plan, slug, nombre, …)
-- se puede tocar desde el frontend; eso sigue reservado a Edge Functions
-- con service_role, como establece el doc 5.2.
GRANT UPDATE (hora_apertura, hora_cierre, duracion_turno_default)
  ON clubes TO authenticated;

-- Política RLS que ata el UPDATE de clubes a:
--   - mismo club que el usuario logueado
--   - rol = 'admin'
-- El privilegio a nivel columna de arriba define QUÉ columnas pueden
-- moverse; esta policy define EN QUÉ FILA y POR QUIÉN. Defense in depth.
CREATE POLICY "clubes_update_solo_admin_horarios"
ON clubes FOR UPDATE TO authenticated
USING (
  id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  id = current_club_id()
  AND current_user_rol() = 'admin'
);

-- ============================================================================
-- 2. TABLA: canchas
--    Doc maestro 4.2
-- ============================================================================
CREATE TABLE canchas (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(60) NOT NULL,
  tipo VARCHAR(40),
  cubierta BOOLEAN NOT NULL DEFAULT FALSE,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_canchas_club ON canchas(club_id);

COMMENT ON TABLE canchas IS
  'Canchas del club. Configurables por el admin (ABM); el vendedor sólo
   las lee. La columna `orden` define el orden de aparición en la grilla.';

-- Permisos a nivel tabla y secuencia. RLS filtra después qué filas se
-- pueden tocar y por quién.
GRANT SELECT, INSERT, UPDATE, DELETE ON canchas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE canchas_id_seq TO authenticated;

ALTER TABLE canchas ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario del club (admin o vendedor) puede leer.
CREATE POLICY "canchas_select"
ON canchas FOR SELECT TO authenticated
USING (club_id = current_club_id());

-- INSERT: sólo admin del propio club. WITH CHECK obligatorio
-- (regla CLAUDE.md nº 3).
CREATE POLICY "canchas_insert_solo_admin"
ON canchas FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

-- UPDATE: sólo admin del propio club. USING para qué filas puede tocar,
-- WITH CHECK para que no pueda moverlas a otro club.
CREATE POLICY "canchas_update_solo_admin"
ON canchas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

-- DELETE: sólo admin del propio club.
CREATE POLICY "canchas_delete_solo_admin"
ON canchas FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

-- ============================================================================
-- 3. TABLA: tarifas
--    Doc maestro 4.2
--
--    Modelo flexible: el club puede tener UNA tarifa con desde_hora,
--    hasta_hora y dias_semana en NULL (aplica a todo), o muchas tarifas
--    superpuestas con `prioridad` para desempatar. La lógica de selección
--    de tarifa vive en el frontend del Sprint 3 (al crear reserva).
-- ============================================================================
CREATE TABLE tarifas (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(80) NOT NULL,
  monto DECIMAL(12,2) NOT NULL CHECK (monto >= 0),
  desde_hora TIME,
  hasta_hora TIME,
  dias_semana INTEGER[],  -- 1=lunes, 7=domingo
  prioridad INTEGER NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_tarifas_club ON tarifas(club_id);

COMMENT ON TABLE tarifas IS
  'Tarifas configurables por el admin. Pueden ser únicas (todo NULL) o
   por franja + día con prioridad para resolver superposiciones.';

COMMENT ON COLUMN tarifas.prioridad IS
  'Cuando dos tarifas aplican al mismo horario, la de mayor prioridad gana.';

COMMENT ON COLUMN tarifas.dias_semana IS
  'Array de días donde aplica la tarifa. 1=lunes, 7=domingo. NULL =
   aplica a todos los días.';

-- CHECK adicional de coherencia: si desde_hora o hasta_hora están
-- presentes, ambos tienen que estarlo y hasta_hora > desde_hora.
-- (Permitimos que ambos sean NULL para el caso "tarifa única para todo".)
ALTER TABLE tarifas
  ADD CONSTRAINT tarifas_franja_coherente
    CHECK (
      (desde_hora IS NULL AND hasta_hora IS NULL)
      OR (desde_hora IS NOT NULL AND hasta_hora IS NOT NULL AND hasta_hora > desde_hora)
    );

-- CHECK sobre el rango de días: cada elemento del array debe estar entre
-- 1 y 7. Sólo si el array no es NULL.
ALTER TABLE tarifas
  ADD CONSTRAINT tarifas_dias_semana_validos
    CHECK (
      dias_semana IS NULL
      OR (
        array_length(dias_semana, 1) BETWEEN 1 AND 7
        AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
      )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON tarifas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE tarifas_id_seq TO authenticated;

ALTER TABLE tarifas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tarifas_select"
ON tarifas FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "tarifas_insert_solo_admin"
ON tarifas FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "tarifas_update_solo_admin"
ON tarifas FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "tarifas_delete_solo_admin"
ON tarifas FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

COMMIT;

-- ============================================================================
-- Fin de la migración 0003_canchas_y_tarifas.sql
-- ============================================================================
