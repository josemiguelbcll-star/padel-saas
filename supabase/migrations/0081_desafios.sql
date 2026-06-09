-- 0081 — Desafios entre amigos (propuesta para jugar juntos)
--
-- Un jugador desafia a otro a jugar en un club/fecha/hora específica.
-- Al aceptar, se crean las reservas para ambos automáticamente.
-- RLS: solo los jugadores involucrados ven el desafio

CREATE TABLE public.desafios (
  id                    BIGSERIAL PRIMARY KEY,
  jugador_app_id_de     UUID   NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  jugador_app_id_para   UUID   NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  club_id               BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  cancha_id             BIGINT NOT NULL REFERENCES public.canchas(id) ON DELETE CASCADE,
  fecha                 DATE   NOT NULL,
  hora_inicio           TIME   NOT NULL,
  duracion_min          INTEGER NOT NULL,
  mensaje               TEXT,
  estado                TEXT   NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aceptado', 'jugado', 'rechazado')),
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
  respondido_en         TIMESTAMPTZ,

  -- Ambas reservas creadas al aceptar
  reserva_id_de         BIGINT REFERENCES public.reservas(id) ON DELETE SET NULL,
  reserva_id_para       BIGINT REFERENCES public.reservas(id) ON DELETE SET NULL
);

CREATE INDEX idx_desafios_de ON public.desafios (jugador_app_id_de);
CREATE INDEX idx_desafios_para ON public.desafios (jugador_app_id_para);
CREATE INDEX idx_desafios_club ON public.desafios (club_id);
CREATE INDEX idx_desafios_estado ON public.desafios (estado);
CREATE INDEX idx_desafios_fecha ON public.desafios (fecha);

ALTER TABLE public.desafios ENABLE ROW LEVEL SECURITY;

-- Solo los jugadores involucrados pueden ver
CREATE POLICY "desafios_select_own"
  ON public.desafios FOR SELECT
  TO authenticated
  USING (
    jugador_app_id_de IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
    OR jugador_app_id_para IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

-- Solo el proponente puede crear
CREATE POLICY "desafios_insert_own"
  ON public.desafios FOR INSERT
  TO authenticated
  WITH CHECK (
    jugador_app_id_de IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

-- Solo el destino puede aceptar/rechazar; solo el proponente puede actualizar mensaje
CREATE POLICY "desafios_update_own"
  ON public.desafios FOR UPDATE
  TO authenticated
  USING (
    jugador_app_id_de IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
    OR jugador_app_id_para IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

COMMENT ON TABLE public.desafios IS
  'Desafio entre amigos para jugar juntos. Al aceptar, crea reservas para ambos en el mismo slot.';

-- ─────────────────────────────────────────────────────────────────────────

-- fn_crear_desafio: propone un desafio a un amigo
CREATE OR REPLACE FUNCTION public.fn_crear_desafio(
  p_jugador_app_id_para UUID,
  p_club_id             BIGINT,
  p_cancha_id           BIGINT,
  p_fecha               DATE,
  p_hora_inicio         TIME,
  p_duracion_min        INTEGER,
  p_mensaje             TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          UUID;
  v_jugador_app_de   jugadores_app%ROWTYPE;
  v_jugador_app_para jugadores_app%ROWTYPE;
  v_son_amigos       BOOLEAN;
  v_club_activo      BOOLEAN;
  v_cancha_activa    BOOLEAN;
  v_desafio_id       BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  -- Validar que el proponente existe
  SELECT * INTO v_jugador_app_de
  FROM jugadores_app WHERE auth_user_id = v_user_id AND activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completá tu perfil antes'; END IF;

  -- Validar que el destino existe y es diferente
  SELECT * INTO v_jugador_app_para
  FROM jugadores_app WHERE id = p_jugador_app_id_para AND activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Jugador destino no existe'; END IF;
  IF v_jugador_app_de.id = v_jugador_app_para.id THEN RAISE EXCEPTION 'No te podes desafiar a vos mismo'; END IF;

  -- Validar amistad (deben ser amigos)
  SELECT EXISTS (
    SELECT 1 FROM jugador_amigos
    WHERE (
      (jugador_app_id_1 = v_jugador_app_de.id AND jugador_app_id_2 = v_jugador_app_para.id)
      OR (jugador_app_id_1 = v_jugador_app_para.id AND jugador_app_id_2 = v_jugador_app_de.id)
    ) AND confirmado = TRUE
  ) INTO v_son_amigos;
  IF NOT v_son_amigos THEN RAISE EXCEPTION 'Deben ser amigos para desafiarse'; END IF;

  -- Validar club y cancha
  SELECT activo INTO v_club_activo FROM clubes WHERE id = p_club_id;
  IF v_club_activo IS NULL OR NOT v_club_activo THEN RAISE EXCEPTION 'Club no disponible'; END IF;

  SELECT activo INTO v_cancha_activa FROM canchas WHERE id = p_cancha_id AND club_id = p_club_id;
  IF v_cancha_activa IS NULL OR NOT v_cancha_activa THEN RAISE EXCEPTION 'Cancha no disponible'; END IF;

  -- Validar que la fecha es futura
  IF p_fecha < CURRENT_DATE THEN RAISE EXCEPTION 'La fecha debe ser futura'; END IF;

  -- Crear desafio
  INSERT INTO desafios (
    jugador_app_id_de, jugador_app_id_para, club_id, cancha_id,
    fecha, hora_inicio, duracion_min, mensaje
  ) VALUES (
    v_jugador_app_de.id, v_jugador_app_para.id, p_club_id, p_cancha_id,
    p_fecha, p_hora_inicio, p_duracion_min, p_mensaje
  )
  RETURNING id INTO v_desafio_id;

  RETURN json_build_object(
    'desafio_id', v_desafio_id,
    'jugador_de_nombre', v_jugador_app_de.nombre_display,
    'jugador_para_nombre', v_jugador_app_para.nombre_display,
    'estado', 'pendiente'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_crear_desafio(UUID, BIGINT, BIGINT, DATE, TIME, INTEGER, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────

-- fn_aceptar_desafio: acepta el desafio y crea reservas para ambos
CREATE OR REPLACE FUNCTION public.fn_aceptar_desafio(p_desafio_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id              UUID;
  v_desafio              desafios%ROWTYPE;
  v_jugador_app_destino  jugadores_app%ROWTYPE;
  v_club_id              BIGINT;
  v_cancha_id            BIGINT;
  v_fecha                DATE;
  v_hora_inicio          TIME;
  v_duracion_min         INTEGER;
  v_hora_fin             TIME;
  v_tarifa_id            BIGINT;
  v_monto_total          NUMERIC(12,2);
  v_jugador_id_de        BIGINT;
  v_jugador_id_para      BIGINT;
  v_reserva_id_de        BIGINT;
  v_reserva_id_para      BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  -- Cargar desafio
  SELECT * INTO v_desafio FROM desafios WHERE id = p_desafio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Desafio no encontrado'; END IF;

  -- Validar que el destino es quien acepta
  SELECT * INTO v_jugador_app_destino
  FROM jugadores_app WHERE id = v_desafio.jugador_app_id_para AND auth_user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solo el destino puede aceptar'; END IF;

  -- Validar que no está ya aceptado/rechazado
  IF v_desafio.estado != 'pendiente' THEN RAISE EXCEPTION 'Desafio ya fue respondido'; END IF;

  v_club_id     := v_desafio.club_id;
  v_cancha_id   := v_desafio.cancha_id;
  v_fecha       := v_desafio.fecha;
  v_hora_inicio := v_desafio.hora_inicio;
  v_duracion_min := v_desafio.duracion_min;
  v_hora_fin    := v_hora_inicio + (v_duracion_min || ' minutes')::interval;

  -- Validar disponibilidad del slot (no debe haber reserva no cancelada)
  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.cancha_id = v_cancha_id AND r.fecha = v_fecha
      AND r.estado NOT IN ('cancelada')
      AND r.hora_inicio < v_hora_fin
      AND (r.hora_inicio + (r.duracion_min || ' minutes')::interval) > v_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible';
  END IF;

  -- Resolver tarifa
  SELECT id, precio INTO v_tarifa_id, v_monto_total
  FROM tarifas
  WHERE cancha_id = v_cancha_id AND activo = TRUE
    AND hora_inicio <= v_hora_inicio AND hora_fin > v_hora_inicio
    AND (vigente_desde IS NULL OR vigente_desde <= v_fecha)
    AND (vigente_hasta IS NULL OR vigente_hasta >= v_fecha)
    AND (duracion_min IS NULL OR duracion_min = v_duracion_min)
  ORDER BY duracion_min NULLS LAST, vigente_desde DESC NULLS LAST
  LIMIT 1;

  IF v_tarifa_id IS NULL THEN
    RAISE EXCEPTION 'No hay precio configurado para ese horario';
  END IF;

  -- Encontrar o crear jugador en club para el proponente
  SELECT id INTO v_jugador_id_de
  FROM jugadores
  WHERE club_id = v_club_id AND activo = TRUE
    AND lower(trim(nombre)) = lower(trim(
      (SELECT nombre_display FROM jugadores_app WHERE id = v_desafio.jugador_app_id_de)
    ))
  LIMIT 1;

  IF v_jugador_id_de IS NULL THEN
    INSERT INTO jugadores (club_id, nombre, telefono, activo)
    SELECT v_club_id, nombre_display,
           (SELECT telefono FROM jugadores_app WHERE id = v_desafio.jugador_app_id_de),
           TRUE
    FROM jugadores_app WHERE id = v_desafio.jugador_app_id_de
    RETURNING id INTO v_jugador_id_de;
  END IF;

  -- Encontrar o crear jugador en club para el destino
  SELECT id INTO v_jugador_id_para
  FROM jugadores
  WHERE club_id = v_club_id AND activo = TRUE
    AND lower(trim(nombre)) = lower(trim(v_jugador_app_destino.nombre_display))
  LIMIT 1;

  IF v_jugador_id_para IS NULL THEN
    INSERT INTO jugadores (club_id, nombre, telefono, activo)
    VALUES (v_club_id, v_jugador_app_destino.nombre_display, v_jugador_app_destino.telefono, TRUE)
    RETURNING id INTO v_jugador_id_para;
  END IF;

  -- Crear reserva para el proponente
  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin, duracion_min,
    tarifa_id, monto_total, estado, observaciones
  ) VALUES (
    v_club_id, v_cancha_id, v_jugador_id_de, v_fecha, v_hora_inicio, v_hora_fin, v_duracion_min,
    v_tarifa_id, v_monto_total, 'pendiente', 'Desafio aceptado - ' || v_jugador_app_destino.nombre_display
  )
  RETURNING id INTO v_reserva_id_de;

  -- Crear reserva para el destino
  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin, duracion_min,
    tarifa_id, monto_total, estado, observaciones
  ) VALUES (
    v_club_id, v_cancha_id, v_jugador_id_para, v_fecha, v_hora_inicio, v_hora_fin, v_duracion_min,
    v_tarifa_id, v_monto_total, 'pendiente', 'Desafio aceptado - ' ||
    (SELECT nombre_display FROM jugadores_app WHERE id = v_desafio.jugador_app_id_de)
  )
  RETURNING id INTO v_reserva_id_para;

  -- Actualizar desafio con estado aceptado y reservas
  UPDATE desafios
  SET estado = 'aceptado', respondido_en = now(),
      reserva_id_de = v_reserva_id_de, reserva_id_para = v_reserva_id_para
  WHERE id = p_desafio_id;

  -- Vincular ambos jugadores app al club
  INSERT INTO jugador_app_club_link (jugador_app_id, club_id, jugador_club_id)
  VALUES (v_desafio.jugador_app_id_de, v_club_id, v_jugador_id_de)
  ON CONFLICT (jugador_app_id, club_id) DO UPDATE SET jugador_club_id = EXCLUDED.jugador_club_id;

  INSERT INTO jugador_app_club_link (jugador_app_id, club_id, jugador_club_id)
  VALUES (v_desafio.jugador_app_id_para, v_club_id, v_jugador_id_para)
  ON CONFLICT (jugador_app_id, club_id) DO UPDATE SET jugador_club_id = EXCLUDED.jugador_club_id;

  RETURN json_build_object(
    'desafio_id', p_desafio_id,
    'estado', 'aceptado',
    'reserva_id_de', v_reserva_id_de,
    'reserva_id_para', v_reserva_id_para,
    'fecha', v_fecha,
    'hora_inicio', v_hora_inicio,
    'duracion_min', v_duracion_min
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_aceptar_desafio(BIGINT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────

-- fn_rechazar_desafio: rechaza el desafio
CREATE OR REPLACE FUNCTION public.fn_rechazar_desafio(p_desafio_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_desafio     desafios%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  SELECT * INTO v_desafio FROM desafios WHERE id = p_desafio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Desafio no encontrado'; END IF;

  -- Solo el destino puede rechazar
  IF NOT EXISTS (
    SELECT 1 FROM jugadores_app
    WHERE id = v_desafio.jugador_app_id_para AND auth_user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Solo el destino puede rechazar';
  END IF;

  IF v_desafio.estado != 'pendiente' THEN RAISE EXCEPTION 'Desafio ya fue respondido'; END IF;

  UPDATE desafios
  SET estado = 'rechazado', respondido_en = now()
  WHERE id = p_desafio_id;

  RETURN json_build_object('desafio_id', p_desafio_id, 'estado', 'rechazado');
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_rechazar_desafio(BIGINT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON public.desafios TO authenticated;
