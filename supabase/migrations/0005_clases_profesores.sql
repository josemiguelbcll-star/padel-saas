-- ============================================================================
-- 0005_clases_profesores.sql
-- Sprint 3a — Cambio de modelo en Reservas
--
-- Antes: los turnos tenían duración configurable via franjas_duracion;
--        el vendedor elegía la duración al crear la reserva.
-- Ahora: todos los turnos son partidos de 90 min fijo (precio según
--        tarifas). Las CLASES son la excepción: el admin las define como
--        bloques rígidos asociados a un profesor + cancha + día(s) + hora
--        + duración + precio. Se repiten semanalmente, no son reservables
--        como turno normal, y aparecen pre-marcadas en la grilla.
--
-- Esta migración:
--   1. Marca DEPRECADA la tabla franjas_duracion (no se borra, sólo se
--      documenta; el código nuevo no la lee/escribe).
--   2. Crea las tablas profesores y clases con su RLS.
--   3. Crea un trigger que BLOQUEA crear/editar una clase si choca con
--      reservas futuras existentes (atributo de integridad: nunca dos
--      cosas pisadas en el mismo slot).
--   4. Reemplaza el cuerpo de fn_crear_reserva (signature idéntica) para
--      que también chequee contra clases activas. Defense in depth con
--      el trigger: cada vía de creación valida el otro lado.
--
-- Regla CLAUDE.md nº 9 respetada: NO se modifica ninguna migración
-- previa. La función fn_crear_reserva se reemplaza vía CREATE OR REPLACE
-- en esta migración nueva — la signature queda igual, no hay cambio
-- contractual para el frontend.
--
-- Deuda anotada (no en este sprint):
--   - El trigger reporta sólo el primer conflicto. Una UX mejor sería
--     listar TODAS las reservas afectadas con un botón "cancelar en
--     bloque". Sale más adelante.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Deprecar franjas_duracion
-- ============================================================================
COMMENT ON TABLE franjas_duracion IS
  'DEPRECADA en 0005. Reemplazada por la tabla "clases" (las excepciones
   al patrón "todo turno es de 90 min"). Mantenida por compatibilidad
   histórica; el código nuevo NO lee ni escribe acá.';


-- ============================================================================
-- 1. TABLA: profesores
--    Listado administrable por el admin. Sólo nombre obligatorio, igual
--    que jugadores. NO entran al sistema con usuario propio: son sólo
--    un listado al que las clases hacen referencia.
-- ============================================================================
CREATE TABLE profesores (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(40),
  email VARCHAR(120),
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profesores_club ON profesores(club_id);

COMMENT ON TABLE profesores IS
  'Profesores del club. Listado configurable por el admin; usados como
   referencia desde clases. NO son usuarios del sistema.';


-- ============================================================================
-- 2. TABLA: clases
--    Bloque rígido recurrente semanal: profesor + cancha + día(s) +
--    hora + duración + precio.
--
--    - nombre opcional. Si está, se muestra; si no, la UI muestra
--      "Clase · {Profesor}". Ayuda cuando un profesor tiene varias
--      clases distintas (ej. "Principiantes" vs "Avanzado").
--    - dias_semana NOT NULL (a diferencia de tarifas, donde NULL = todos
--      los días). Una clase sin día no tiene sentido operativo.
--    - hora_inicio restringida a múltiplos de 30 min (la grilla está
--      alineada a 30; admitir 10:15 rompería el render).
--    - duracion_min default 60, con el mismo set válido que reservas.
--    - precio independiente de tarifas (las clases NO usan tarifas).
-- ============================================================================
CREATE TABLE clases (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES clubes(id),
  profesor_id BIGINT NOT NULL REFERENCES profesores(id),
  cancha_id BIGINT NOT NULL REFERENCES canchas(id),
  nombre VARCHAR(80),
  dias_semana INTEGER[] NOT NULL,
  hora_inicio TIME NOT NULL,
  duracion_min INTEGER NOT NULL DEFAULT 60
    CHECK (duracion_min IN (60, 90, 120, 150, 180, 240)),
  precio DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_alta TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE clases
  ADD CONSTRAINT clases_dias_semana_validos
    CHECK (
      array_length(dias_semana, 1) BETWEEN 1 AND 7
      AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[]
    );

-- Alineación a la grilla de 30 min. Defensa en profundidad: el form va
-- a restringir el input, pero esto evita datos rotos por INSERTs
-- directos a la DB.
ALTER TABLE clases
  ADD CONSTRAINT clases_hora_alineada_30min
    CHECK (
      EXTRACT(MINUTE FROM hora_inicio)::INT IN (0, 30)
      AND EXTRACT(SECOND FROM hora_inicio)::INT = 0
    );

CREATE INDEX idx_clases_club ON clases(club_id);
CREATE INDEX idx_clases_cancha ON clases(cancha_id);
CREATE INDEX idx_clases_profesor ON clases(profesor_id);

COMMENT ON TABLE clases IS
  'Bloques rígidos recurrentes semanales (profesor + cancha + día(s) +
   hora + duración + precio). Aparecen pre-marcados en la grilla, no
   son reservables por el vendedor.';

COMMENT ON COLUMN clases.nombre IS
  'Nombre opcional. Si está, se muestra; si no, la UI cae a
   "Clase · {Profesor}".';

COMMENT ON COLUMN clases.dias_semana IS
  'Días donde la clase ocurre. 1=lunes, 7=domingo. NOT NULL: una clase
   sin días no tiene sentido (a diferencia de tarifas).';

COMMENT ON COLUMN clases.precio IS
  'Precio propio de la clase. No se aplica el sistema de tarifas
   (esas son sólo para partidos).';


-- ============================================================================
-- 3. GRANTs a nivel tabla y secuencia. RLS filtra después.
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON profesores TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE profesores_id_seq TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON clases TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE clases_id_seq TO authenticated;


-- ============================================================================
-- 4. RLS — profesores
--    Configuración del club: SELECT abierto a authenticated, mutaciones
--    sólo admin (mismo patrón que canchas/tarifas/franjas_duracion).
-- ============================================================================
ALTER TABLE profesores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profesores_select"
ON profesores FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "profesores_insert_solo_admin"
ON profesores FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "profesores_update_solo_admin"
ON profesores FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "profesores_delete_solo_admin"
ON profesores FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 5. RLS — clases (idéntico patrón a profesores)
-- ============================================================================
ALTER TABLE clases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clases_select"
ON clases FOR SELECT TO authenticated
USING (club_id = current_club_id());

CREATE POLICY "clases_insert_solo_admin"
ON clases FOR INSERT TO authenticated
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "clases_update_solo_admin"
ON clases FOR UPDATE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
)
WITH CHECK (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);

CREATE POLICY "clases_delete_solo_admin"
ON clases FOR DELETE TO authenticated
USING (
  club_id = current_club_id()
  AND current_user_rol() = 'admin'
);


-- ============================================================================
-- 6. Trigger: bloquear creación/edición de clase si choca con reservas
--    futuras existentes (atributo de integridad).
--
--    Scope:
--    - Sólo reservas con fecha >= CURRENT_DATE (las pasadas no importan).
--    - Sólo reservas no canceladas (las canceladas no ocupan slot).
--    - Si la clase entra/queda inactiva, skip: no afecta la grilla.
--
--    Mensaje: incluye fecha + hora del primer conflicto encontrado para
--    que el admin sepa qué reserva ajustar. Si hay múltiples, al
--    cancelar/mover la primera, el siguiente intento expone la próxima.
--    (Deuda: ver header de la migración.)
--
--    SECURITY INVOKER: el trigger corre como el admin que disparó el
--    INSERT/UPDATE. RLS abierto a authenticated del club permite leer
--    reservas y jugadores. SET search_path = public para defensa.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_check_clase_no_overlap_reservas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conflicto RECORD;
  v_dur_interval INTERVAL;
BEGIN
  -- Una clase inactiva no ocupa la grilla, no hace falta validar.
  IF NEW.activa = FALSE THEN
    RETURN NEW;
  END IF;

  v_dur_interval := (NEW.duracion_min || ' minutes')::interval;

  SELECT
    r.fecha,
    r.hora_inicio,
    r.hora_fin,
    j.nombre AS jugador_nombre
    INTO v_conflicto
  FROM reservas r
  LEFT JOIN jugadores j ON j.id = r.jugador_id
  WHERE r.club_id = NEW.club_id
    AND r.cancha_id = NEW.cancha_id
    AND r.fecha >= CURRENT_DATE
    AND r.estado != 'cancelada'
    AND EXTRACT(ISODOW FROM r.fecha)::INT = ANY(NEW.dias_semana)
    AND tsrange(
      (r.fecha + r.hora_inicio)::timestamp,
      (r.fecha + r.hora_fin)::timestamp
    ) && tsrange(
      (r.fecha + NEW.hora_inicio)::timestamp,
      (r.fecha + NEW.hora_inicio + v_dur_interval)::timestamp
    )
  ORDER BY r.fecha, r.hora_inicio
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'No se puede guardar la clase: choca con una reserva del % a las % (titular: %). Cancelá esa reserva o ajustá horario/días de la clase.',
      v_conflicto.fecha,
      to_char(v_conflicto.hora_inicio, 'HH24:MI'),
      COALESCE(v_conflicto.jugador_nombre, 'sin titular');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_check_clase_no_overlap_reservas IS
  'Trigger BEFORE INSERT/UPDATE sobre clases. Rechaza el movimiento si
   la clase se solaparía con una reserva futura no cancelada existente.';

CREATE TRIGGER trg_clases_no_overlap_reservas
BEFORE INSERT OR UPDATE ON clases
FOR EACH ROW EXECUTE FUNCTION fn_check_clase_no_overlap_reservas();


-- ============================================================================
-- 7. CREATE OR REPLACE fn_crear_reserva
--    Reemplaza el cuerpo creado en 0004. La signature queda idéntica
--    → el frontend no se entera del cambio.
--
--    Cambio: se agrega un check ANTES del INSERT que rechaza si la
--    reserva se solaparía con una clase activa configurada (mismo
--    cancha, día de semana en dias_semana de la clase, overlap en
--    horario). El RAISE EXCEPTION usa P0001 que dbErrors pasa directo
--    al usuario.
--
--    Defense in depth con el trigger de clases:
--      - trigger:  bloquea crear clase que choque con reservas futuras
--      - esta RPC: bloquea crear reserva que choque con clases activas
--    Ningún lado puede generar overlap clase↔reserva.
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

  -- NUEVO en 0005: rechazar si la reserva se solapa con una clase
  -- activa configurada en esa cancha + día de semana.
  IF EXISTS (
    SELECT 1
    FROM clases c
    WHERE c.club_id = v_club_id
      AND c.cancha_id = p_cancha_id
      AND c.activa = TRUE
      AND EXTRACT(ISODOW FROM p_fecha)::INT = ANY(c.dias_semana)
      AND tsrange(
        (p_fecha + c.hora_inicio)::timestamp,
        (p_fecha + c.hora_inicio + (c.duracion_min || ' minutes')::interval)::timestamp
      ) && tsrange(
        (p_fecha + p_hora_inicio)::timestamp,
        (p_fecha + v_hora_fin)::timestamp
      )
  ) THEN
    RAISE EXCEPTION 'Ese horario se solapa con una clase configurada en esa cancha.';
  END IF;

  v_monto_sena := CASE WHEN p_estado = 'senada' THEN p_monto_pagado ELSE 0 END;
  v_tipo_pago := CASE WHEN p_estado = 'senada' THEN 'sena' ELSE 'pago' END;

  -- 1. Insert reservas (RLS valida tenant; no_overlap valida superposición
  --    contra otras reservas).
  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin,
    duracion_min, tarifa_id, monto_total, monto_sena, monto_pagado,
    estado, observaciones, usuario_alta_id
  ) VALUES (
    v_club_id, p_cancha_id, p_jugador_titular_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_duracion_min, p_tarifa_id, p_monto_total, v_monto_sena, p_monto_pagado,
    p_estado, p_observaciones, v_usuario_id
  ) RETURNING * INTO v_reserva;

  -- 2. Titular (si lo hay).
  IF p_jugador_titular_id IS NOT NULL THEN
    INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
    VALUES (v_club_id, v_reserva.id, p_jugador_titular_id, TRUE);
  END IF;

  -- 3. Acompañantes con jugador_id.
  IF p_jugadores_ids IS NOT NULL THEN
    FOREACH v_jid IN ARRAY p_jugadores_ids LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, jugador_id, es_titular)
      VALUES (v_club_id, v_reserva.id, v_jid, FALSE);
    END LOOP;
  END IF;

  -- 4. Acompañantes "nombre libre".
  IF p_nombres_libres IS NOT NULL THEN
    FOREACH v_nombre IN ARRAY p_nombres_libres LOOP
      INSERT INTO reserva_jugadores (club_id, reserva_id, nombre_libre, es_titular)
      VALUES (v_club_id, v_reserva.id, v_nombre, FALSE);
    END LOOP;
  END IF;

  -- 5. Pago inicial si hubo.
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
   En 0005 se agregó el chequeo contra clases activas. La signature
   queda idéntica a la de 0004 — el frontend no requiere cambios.';


COMMIT;

-- ============================================================================
-- Fin de la migración 0005_clases_profesores.sql
-- ============================================================================
