-- ============================================================================
-- 0004_reservas_jugadores_franjas.sql
-- Sprint 3a — Base de Reservas
--
-- Crea las tablas operativas que sostienen la grilla del día:
--
--   - jugadores              (sección 4.3 del Documento Maestro)
--   - reservas               (sección 4.3 + CHECKs + EXCLUDE no-overlap)
--   - reserva_jugadores      (sección 4.3, con club_id agregado por regla 2)
--   - reserva_pagos          (NUEVO — modelo preparado para "turno como cuenta")
--   - franjas_duracion       (NUEVO — duración por cancha/franja, requisito CLAUDE.md)
--
-- Y una RPC atómica:
--   - fn_crear_reserva(...)  inserta reserva + reserva_jugadores +
--                            reserva_pagos en una sola transacción.
--
-- Extensiones requeridas:
--   - pg_trgm    (búsqueda fuzzy de jugadores con GIN sobre nombre)
--   - btree_gist (EXCLUDE constraint que mezcla = con && — no_overlap)
--
-- Visión "turno como cuenta" (CLAUDE.md):
--   - reservas conserva las columnas escalares (monto_total, monto_sena,
--     monto_pagado, estado) como "vista resumen" rápida que la grilla
--     consulta sin joins.
--   - reserva_pagos almacena el detalle de cada movimiento de cobro
--     (sena, pago, reembolso) con su medio_pago y opcionalmente el
--     jugador que pagó. La RPC mantiene las escalares en sincronía.
--   - Cuando se sume Buffet (sprint posterior), se agrega una tabla
--     `reserva_items` análoga. Cuando se sume división por jugador, se
--     setea `jugador_id` en pagos/items. Ninguno de los dos requiere
--     migrar datos existentes — es aditivo.
--
-- Sólo el archivo, NO se ejecuta automáticamente. Lo revisás y lo corrés
-- vos en el SQL Editor de Supabase. No se modifican migraciones previas
-- (regla CLAUDE.md nº 9).
--
-- Referencias del Documento Técnico Maestro v1.0:
--   - 3.4 Roles dentro del sistema
--   - 4.3 Jugadores y reservas (núcleo del negocio)
--   - 5.1 Patrón general de RLS (4 políticas por tabla, WITH CHECK)
--   - 6.2 Índices críticos del sistema
--   - 8.3 Modificación de reservas (sólo observaciones post-pago)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. EXTENSIONES
-- ============================================================================

-- Búsqueda por similaridad para autocomplete de jugadores. Idempotente.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Necesaria para combinar operadores = y && en el EXCLUDE de no_overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ============================================================================
-- 1. TABLA: jugadores
--    Doc maestro 4.3
--    Sólo `nombre` es obligatorio. El resto se enriquece con el uso.
-- ============================================================================
CREATE TABLE jugadores (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(40),
  email VARCHAR(120),
  nivel VARCHAR(20),
  notas TEXT,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Índices del doc 6.2:
CREATE INDEX idx_jugadores_club ON jugadores(club_id);

-- Búsqueda por teléfono (parcial: muchos jugadores no van a tener).
CREATE INDEX idx_jugadores_telefono ON jugadores(club_id, telefono)
  WHERE telefono IS NOT NULL;

-- Autocomplete por nombre con pg_trgm (también acelera ILIKE '%foo%').
CREATE INDEX idx_jugadores_nombre_trgm ON jugadores
  USING gin (nombre gin_trgm_ops);

COMMENT ON TABLE jugadores IS
  'Jugadores del club. Sólo nombre obligatorio; el resto se completa con el uso.';


-- ============================================================================
-- 2. TABLA: reservas
--    Doc maestro 4.3
--
--    monto_total / monto_sena / monto_pagado / estado son la "vista
--    resumen" que consulta la grilla. El detalle de cada movimiento de
--    cobro vive en reserva_pagos (ver sección 4). La RPC fn_crear_reserva
--    los mantiene coherentes.
-- ============================================================================
CREATE TABLE reservas (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  cancha_id BIGINT NOT NULL REFERENCES canchas(id),
  jugador_id BIGINT REFERENCES jugadores(id),   -- titular (puede ser NULL si todos son "nombre libre")
  fecha DATE NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  duracion_min INTEGER NOT NULL
    CHECK (duracion_min IN (60, 90, 120, 150, 180, 240)),
  tarifa_id BIGINT REFERENCES tarifas(id),
  monto_total DECIMAL(12,2) NOT NULL CHECK (monto_total >= 0),
  monto_sena DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (monto_sena >= 0),
  monto_pagado DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (monto_pagado >= 0),
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','senada','pagada','jugada','cancelada')),
  observaciones TEXT,
  usuario_alta_id UUID REFERENCES usuarios(id),
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraint clave: no se puede pagar más del total
  CHECK (monto_pagado <= monto_total),

  -- Constraint clave: hora_fin > hora_inicio
  CHECK (hora_fin > hora_inicio)
);

-- ÍNDICE MÁS CRÍTICO DEL SISTEMA: la grilla del día filtra por club_id + fecha
-- en cada render. Sin este índice una grilla con 50k reservas tarda 5s en
-- lugar de 50ms (doc 6.2).
CREATE INDEX idx_reservas_club_fecha ON reservas(club_id, fecha);

-- Validación de superposición (la usa el constraint EXCLUDE de abajo).
CREATE INDEX idx_reservas_cancha_fecha ON reservas(cancha_id, fecha);

-- Búsqueda de reservas por jugador (estadísticas, historial).
CREATE INDEX idx_reservas_jugador ON reservas(jugador_id)
  WHERE jugador_id IS NOT NULL;

-- Constraint OBLIGATORIO de no superposición en la misma cancha y día.
-- Postgres rechaza automáticamente cualquier INSERT que cree una reserva
-- superpuesta a otra existente (excepto si está cancelada). Es la
-- defensa última: si el frontend tiene un bug, la base la frena.
ALTER TABLE reservas ADD CONSTRAINT no_overlap_reservas EXCLUDE
  USING gist (
    cancha_id WITH =,
    fecha WITH =,
    tsrange(
      (fecha + hora_inicio)::timestamp,
      (fecha + hora_fin)::timestamp
    ) WITH &&
  )
  WHERE (estado != 'cancelada');

COMMENT ON TABLE reservas IS
  'Reservas de canchas. Las columnas escalares (monto_*, estado) son el
   resumen para la grilla; el detalle de cobros vive en reserva_pagos.';


-- ============================================================================
-- 3. TABLA: reserva_jugadores
--    Doc maestro 4.3, con club_id agregado para cumplir regla 2 del
--    CLAUDE.md ("toda tabla de negocio tiene club_id BIGINT NOT NULL").
--    El club_id se valida coherente con reservas.club_id desde la RPC.
-- ============================================================================
CREATE TABLE reserva_jugadores (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  reserva_id BIGINT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  jugador_id BIGINT REFERENCES jugadores(id),
  nombre_libre VARCHAR(120),  -- si todavía no se registró como jugador
  es_titular BOOLEAN NOT NULL DEFAULT FALSE,

  -- Al menos uno de los dos identificadores tiene que estar lleno.
  CHECK (jugador_id IS NOT NULL OR nombre_libre IS NOT NULL)
);

CREATE INDEX idx_reserva_jugadores_reserva ON reserva_jugadores(reserva_id);
CREATE INDEX idx_reserva_jugadores_jugador ON reserva_jugadores(jugador_id)
  WHERE jugador_id IS NOT NULL;

COMMENT ON TABLE reserva_jugadores IS
  'Captura los hasta 4 jugadores de cada partido (titular + 3 acompañantes).
   Materia prima para futuras estadísticas e IA de armado de partidos.';


-- ============================================================================
-- 4. TABLA: reserva_pagos
--    NUEVO — modelo preparado para "turno como cuenta" (CLAUDE.md).
--
--    Cada cobro/seña/reembolso es UNA fila. Permite:
--      - Múltiples medios de pago para una misma reserva (división)
--      - Asociar un cobro a un jugador específico (jugador_id, opcional)
--      - Trazabilidad (quién cobró, cuándo, con qué medio)
--      - Reembolsos como filas con tipo='reembolso'
--
--    UPDATE y DELETE restringidos a admin: los pagos son evidencia de
--    movimientos de plata, no deben editarse a la ligera. El camino
--    estándar para corregir es agregar un reembolso, no editar.
-- ============================================================================
CREATE TABLE reserva_pagos (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  reserva_id BIGINT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  medio_pago VARCHAR(20) NOT NULL
    CHECK (medio_pago IN ('efectivo','transferencia','mp','tarjeta','otro')),
  tipo VARCHAR(20) NOT NULL DEFAULT 'pago'
    CHECK (tipo IN ('sena','pago','reembolso')),
  jugador_id BIGINT REFERENCES jugadores(id),  -- NULL = pago grupal (default sprint 3a)
  observaciones TEXT,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reserva_pagos_reserva ON reserva_pagos(reserva_id);
CREATE INDEX idx_reserva_pagos_club_fecha ON reserva_pagos(club_id, fecha_hora);

COMMENT ON TABLE reserva_pagos IS
  'Historial de cobros/señas/reembolsos por reserva. Append-friendly: el
   camino estándar para revertir un cobro es agregar un reembolso, no
   editar la fila original.';
COMMENT ON COLUMN reserva_pagos.jugador_id IS
  'Para división de cuenta: jugador que pagó esta porción. NULL = pago grupal.';


-- ============================================================================
-- 5. TABLA: franjas_duracion
--    NUEVO — duración de turno por cancha + franja (requisito CLAUDE.md).
--
--    Estructura espejo de tarifas + cancha_id nullable. Permite:
--      - cancha_id = NULL: aplica a todas las canchas del club
--      - cancha_id != NULL: específica a esa cancha
--      - franja horaria opcional, días opcionales, prioridad para desempate
--
--    Caso de uso: cancha 1 clase 60min + cancha 2 partido 90min mismo
--    horario. Se logra con dos franjas con cancha_id distintos.
--
--    Resolución (en el frontend): franjas con cancha específica ganan
--    sobre las "todas las canchas"; luego prioridad DESC; fallback a
--    clubes.duracion_turno_default.
-- ============================================================================
CREATE TABLE franjas_duracion (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  cancha_id BIGINT REFERENCES canchas(id),
  nombre VARCHAR(80) NOT NULL,
  desde_hora TIME,
  hasta_hora TIME,
  dias_semana INTEGER[],
  duracion_min INTEGER NOT NULL
    CHECK (duracion_min IN (60, 90, 120, 150, 180, 240)),
  prioridad INTEGER NOT NULL DEFAULT 0,
  activa BOOLEAN NOT NULL DEFAULT TRUE
);

-- Coherencia de la franja horaria: ambas null (aplica a toda hora) o
-- ambas seteadas con hasta_hora > desde_hora. Mismo patrón que tarifas.
ALTER TABLE franjas_duracion
  ADD CONSTRAINT franjas_duracion_franja_coherente
    CHECK (
      (desde_hora IS NULL AND hasta_hora IS NULL)
      OR (desde_hora IS NOT NULL AND hasta_hora IS NOT NULL AND hasta_hora > desde_hora)
    );

-- Días: NULL (aplica a todos) o array no vacío con valores 1..7.
ALTER TABLE franjas_duracion
  ADD CONSTRAINT franjas_duracion_dias_semana_validos
    CHECK (
      dias_semana IS NULL
      OR (
        array_length(dias_semana, 1) BETWEEN 1 AND 7
        AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
      )
    );

CREATE INDEX idx_franjas_duracion_club ON franjas_duracion(club_id);
CREATE INDEX idx_franjas_duracion_cancha ON franjas_duracion(cancha_id)
  WHERE cancha_id IS NOT NULL;

COMMENT ON TABLE franjas_duracion IS
  'Reglas de duración de turno configurables por cancha + franja horaria
   + días. Sin franjas configuradas, vale clubes.duracion_turno_default.';
COMMENT ON COLUMN franjas_duracion.cancha_id IS
  'NULL = la franja aplica a todas las canchas del club. Las franjas
   específicas a una cancha ganan sobre las generales en la resolución.';
COMMENT ON COLUMN franjas_duracion.prioridad IS
  'Cuando dos franjas aplican al mismo (cancha, hora, día), gana la de
   mayor prioridad. Misma semántica que tarifas.prioridad.';


-- ============================================================================
-- 6. GRANTs a nivel tabla y secuencia
--    RLS filtra qué filas se pueden tocar y por quién (ver sección 7).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON jugadores TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE jugadores_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON reservas TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE reservas_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON reserva_jugadores TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE reserva_jugadores_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON reserva_pagos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE reserva_pagos_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON franjas_duracion TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE franjas_duracion_id_seq TO authenticated;


-- ============================================================================
-- 7. RLS — políticas por tabla
--
--    Recordatorio: las funciones helper current_club_id() y
--    current_user_rol() vienen de las migraciones 0001/0002. Son
--    SECURITY DEFINER STABLE, por lo que NO recursan dentro de policies.
--
--    Política operativa (jugadores, reservas, reserva_jugadores):
--      SELECT + INSERT + UPDATE + DELETE abiertos a cualquier
--      authenticated del club. Tanto admin como vendedor operan reservas.
--
--    Política de evidencia (reserva_pagos):
--      SELECT + INSERT abiertos (vendedor cobra), UPDATE + DELETE
--      restringidos a admin para preservar trazabilidad.
--
--    Política de configuración (franjas_duracion):
--      SELECT abierto al club, INSERT + UPDATE + DELETE sólo admin
--      (misma lógica que canchas y tarifas: configurar es del admin).
-- ============================================================================

-- ----- jugadores -----
ALTER TABLE jugadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jugadores_select"
ON jugadores FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "jugadores_insert"
ON jugadores FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "jugadores_update"
ON jugadores FOR UPDATE TO authenticated
USING (club_id = current_club_id())
WITH CHECK (club_id = current_club_id());

CREATE POLICY "jugadores_delete"
ON jugadores FOR DELETE TO authenticated
USING (club_id = current_club_id());

-- ----- reservas -----
ALTER TABLE reservas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reservas_select"
ON reservas FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "reservas_insert"
ON reservas FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "reservas_update"
ON reservas FOR UPDATE TO authenticated
USING (club_id = current_club_id())
WITH CHECK (club_id = current_club_id());

CREATE POLICY "reservas_delete"
ON reservas FOR DELETE TO authenticated
USING (club_id = current_club_id());

-- ----- reserva_jugadores -----
ALTER TABLE reserva_jugadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reserva_jugadores_select"
ON reserva_jugadores FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "reserva_jugadores_insert"
ON reserva_jugadores FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "reserva_jugadores_update"
ON reserva_jugadores FOR UPDATE TO authenticated
USING (club_id = current_club_id())
WITH CHECK (club_id = current_club_id());

CREATE POLICY "reserva_jugadores_delete"
ON reserva_jugadores FOR DELETE TO authenticated
USING (club_id = current_club_id());

-- ----- reserva_pagos -----
ALTER TABLE reserva_pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reserva_pagos_select"
ON reserva_pagos FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "reserva_pagos_insert"
ON reserva_pagos FOR INSERT TO authenticated
WITH CHECK (club_id = current_club_id());

CREATE POLICY "reserva_pagos_update_solo_admin"
ON reserva_pagos FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "reserva_pagos_delete_solo_admin"
ON reserva_pagos FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

-- ----- franjas_duracion -----
ALTER TABLE franjas_duracion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "franjas_duracion_select"
ON franjas_duracion FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "franjas_duracion_insert_solo_admin"
ON franjas_duracion FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "franjas_duracion_update_solo_admin"
ON franjas_duracion FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "franjas_duracion_delete_solo_admin"
ON franjas_duracion FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 8. RPC: fn_crear_reserva
--    Crea una reserva + sus jugadores + (opcional) primer pago en una
--    sola transacción atómica. Es la única forma desde el frontend de
--    crear una reserva (regla CLAUDE.md nº 6).
--
--    SECURITY INVOKER: hereda el rol del caller (authenticated). Cada
--    INSERT pasa por las policies RLS, que validan tenant y rol. Esto
--    evita tener que duplicar validaciones manuales adentro de la RPC.
--    auth.uid() y current_club_id() siguen funcionando porque están
--    qualificados de schema y son STABLE/DEFINER respectivamente.
--
--    Errores propagados al frontend:
--    - 'No hay sesión activa.': auth.uid() o current_club_id() null.
--    - 'Si hay un pago...': falta medio_pago cuando monto > 0.
--    - 23P01 / no_overlap_reservas: la cancha ya tiene una reserva
--                                   superpuesta en ese horario.
--    - 23514: CHECK violado (monto_pagado > monto_total, hora_fin <= hora_inicio).
--    - 42501: rol no autorizado o club mismatch (RLS rejection).
--
--    La función NO setea hora_fin desde el caller: la calcula como
--    hora_inicio + duracion_min para garantizar coherencia.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_crear_reserva(
  p_cancha_id BIGINT,
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INTEGER,
  p_jugador_titular_id BIGINT,
  p_jugadores_ids BIGINT[],
  p_nombres_libres VARCHAR[],
  p_tarifa_id BIGINT,
  p_monto_total DECIMAL,
  p_monto_pagado DECIMAL,
  p_medio_pago VARCHAR,
  p_estado VARCHAR,
  p_observaciones TEXT
)
RETURNS reservas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserva reservas;
  v_club_id BIGINT;
  v_usuario_id UUID;
  v_hora_fin TIME;
  v_monto_sena DECIMAL(12,2);
  v_tipo_pago VARCHAR(20);
  v_jid BIGINT;
  v_nombre VARCHAR;
BEGIN
  v_club_id := current_club_id();
  v_usuario_id := auth.uid();

  IF v_club_id IS NULL OR v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No hay sesión activa.';
  END IF;

  v_hora_fin := p_hora_inicio + (p_duracion_min || ' minutes')::interval;

  -- Si el estado es 'senada', el monto pagado es seña. Si es 'pagada' o
  -- 'pendiente' (con pago parcial), va como pago normal.
  v_monto_sena := CASE WHEN p_estado = 'senada' THEN p_monto_pagado ELSE 0 END;
  v_tipo_pago := CASE WHEN p_estado = 'senada' THEN 'sena' ELSE 'pago' END;

  -- 1. Insert reservas (RLS valida tenant; no_overlap valida superposición)
  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
    duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
    estado, observaciones, usuario_alta_id
  ) VALUES (
    v_club_id, p_cancha_id, p_jugador_titular_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_duracion_min, p_tarifa_id, p_monto_total, v_monto_sena, p_monto_pagado,
    p_estado, p_observaciones, v_usuario_id
  ) RETURNING * INTO v_reserva;

  -- 2. Titular (si lo hay): jugador real, marcado es_titular = TRUE
  IF p_jugador_titular_id IS NOT NULL THEN
    INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
    VALUES (v_club_id, v_reserva.id, p_jugador_titular_id, TRUE);
  END IF;

  -- 3. Acompañantes con jugador_id
  IF p_jugadores_ids IS NOT NULL THEN
    FOREACH v_jid IN ARRAY p_jugadores_ids LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
      VALUES (v_club_id, v_reserva.id, v_jid, FALSE);
    END LOOP;
  END IF;

  -- 4. Acompañantes sólo con nombre (no registrados como jugadores aún)
  IF p_nombres_libres IS NOT NULL THEN
    FOREACH v_nombre IN ARRAY p_nombres_libres LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, nombre_libre, es_titular)
      VALUES (v_club_id, v_reserva.id, v_nombre, FALSE);
    END LOOP;
  END IF;

  -- 5. Pago inicial (si hubo)
  IF p_monto_pagado > 0 THEN
    IF p_medio_pago IS NULL THEN
      RAISE EXCEPTION 'Si hay un pago, el medio de pago es obligatorio.';
    END IF;
    INSERT INTO reserva_pagos (
      club_id, reserva_id, monto, medio_pago, tipo, usuario_id
    ) VALUES (
      v_club_id, v_reserva.id, p_monto_pagado, p_medio_pago, v_tipo_pago, v_usuario_id
    );
  END IF;

  RETURN v_reserva;
END;
$$;

COMMENT ON FUNCTION fn_crear_reserva IS
  'Crea reserva + reserva_jugadores + reserva_pagos en una transacción.
   SECURITY INVOKER: RLS valida tenant y rol en cada INSERT.';

GRANT EXECUTE ON FUNCTION fn_crear_reserva(
  BIGINT, DATE, TIME, INTEGER, BIGINT, BIGINT[], VARCHAR[],
  BIGINT, DECIMAL, DECIMAL, VARCHAR, VARCHAR, TEXT
) TO authenticated;


COMMIT;

-- ============================================================================
-- Fin de la migración 0004_reservas_jugadores_franjas.sql
-- ============================================================================
