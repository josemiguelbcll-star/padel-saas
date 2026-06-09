-- 0079 — Reservar cancha desde la app del jugador (seña por transferencia)
--
-- Agrega columnas de pago a clubes + función SECURITY DEFINER que:
--   1. Valida sesión y perfil del jugador
--   2. Verifica disponibilidad del slot
--   3. Encuentra o crea el registro jugadores del club para este jugador
--   4. Crea la reserva en estado 'pendiente'
--   5. Vincula jugadores_app ↔ jugadores via jugador_app_club_link
--   6. Retorna datos de la reserva + instrucciones de pago (CBU/alias)

ALTER TABLE public.clubes
  ADD COLUMN IF NOT EXISTS cbu_alias        TEXT,
  ADD COLUMN IF NOT EXISTS nombre_banco     TEXT,
  ADD COLUMN IF NOT EXISTS sena_porcentaje  INTEGER NOT NULL DEFAULT 50
    CHECK (sena_porcentaje BETWEEN 10 AND 100);

CREATE OR REPLACE FUNCTION public.fn_reservar_desde_app(
  p_cancha_id    BIGINT,
  p_fecha        DATE,
  p_hora_inicio  TIME,
  p_duracion_min INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         UUID;
  v_jugador_app     jugadores_app%ROWTYPE;
  v_club_id         BIGINT;
  v_cancha_nombre   TEXT;
  v_club_nombre     TEXT;
  v_cbu_alias       TEXT;
  v_nombre_banco    TEXT;
  v_sena_porcentaje INTEGER;
  v_club_instagram  TEXT;
  v_tarifa_id       BIGINT;
  v_monto_total     NUMERIC(12,2);
  v_jugador_id      BIGINT;
  v_hora_fin        TIME;
  v_reserva_id      BIGINT;
  v_monto_sena      NUMERIC(12,2);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sin sesión activa'; END IF;

  SELECT * INTO v_jugador_app
  FROM jugadores_app WHERE auth_user_id = v_user_id AND activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Completá tu perfil antes de reservar'; END IF;

  SELECT c.club_id, c.nombre INTO v_club_id, v_cancha_nombre
  FROM canchas c WHERE c.id = p_cancha_id AND c.activa = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cancha no disponible'; END IF;

  SELECT cl.nombre, cl.cbu_alias, cl.nombre_banco, cl.sena_porcentaje, cl.instagram
  INTO v_club_nombre, v_cbu_alias, v_nombre_banco, v_sena_porcentaje, v_club_instagram
  FROM clubes cl WHERE cl.id = v_club_id AND cl.activo = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club no disponible'; END IF;

  v_hora_fin := p_hora_inicio + (p_duracion_min || ' minutes')::interval;

  IF EXISTS (
    SELECT 1 FROM reservas r
    WHERE r.cancha_id = p_cancha_id AND r.fecha = p_fecha
      AND r.estado NOT IN ('cancelada')
      AND r.hora_inicio < v_hora_fin
      AND (r.hora_inicio + (r.duracion_min || ' minutes')::interval) > p_hora_inicio
  ) THEN
    RAISE EXCEPTION 'El turno ya no está disponible. Elegí otro horario.';
  END IF;

  SELECT id, monto INTO v_tarifa_id, v_monto_total
  FROM tarifas
  WHERE cancha_id = p_cancha_id AND activa = TRUE
    AND hora_inicio <= p_hora_inicio AND hora_fin > p_hora_inicio
    AND (vigente_desde IS NULL OR vigente_desde <= p_fecha)
    AND (vigente_hasta IS NULL OR vigente_hasta >= p_fecha)
    AND (duracion_min IS NULL OR duracion_min = p_duracion_min)
  ORDER BY duracion_min NULLS LAST, vigente_desde DESC NULLS LAST
  LIMIT 1;

  IF v_tarifa_id IS NULL THEN
    RAISE EXCEPTION 'No hay precio configurado para ese horario. Contactá al club.';
  END IF;

  SELECT id INTO v_jugador_id
  FROM jugadores
  WHERE club_id = v_club_id AND activo = TRUE
    AND (
      (v_jugador_app.telefono IS NOT NULL
       AND fn_normalizar_telefono(telefono) = fn_normalizar_telefono(v_jugador_app.telefono))
      OR lower(trim(nombre)) = lower(trim(v_jugador_app.nombre_display))
    )
  ORDER BY id ASC LIMIT 1;

  IF v_jugador_id IS NULL THEN
    INSERT INTO jugadores (club_id, nombre, telefono, activo)
    VALUES (v_club_id, v_jugador_app.nombre_display, v_jugador_app.telefono, TRUE)
    RETURNING id INTO v_jugador_id;
  END IF;

  v_monto_sena := round(v_monto_total * v_sena_porcentaje / 100.0, 2);

  INSERT INTO reservas (
    club_id, cancha_id, jugador_id, fecha, hora_inicio, hora_fin, duracion_min,
    tarifa_id, monto_total, monto_sena, monto_pagado, estado, observaciones
  ) VALUES (
    v_club_id, p_cancha_id, v_jugador_id, p_fecha, p_hora_inicio, v_hora_fin, p_duracion_min,
    v_tarifa_id, v_monto_total, v_monto_sena, 0, 'pendiente', 'Reserva vía app MatchGo'
  )
  RETURNING id INTO v_reserva_id;

  INSERT INTO jugador_app_club_link (jugador_app_id, club_id, jugador_club_id)
  VALUES (v_jugador_app.id, v_club_id, v_jugador_id)
  ON CONFLICT (jugador_app_id, club_id) DO UPDATE SET jugador_club_id = EXCLUDED.jugador_club_id;

  RETURN json_build_object(
    'reserva_id', v_reserva_id, 'cancha_nombre', v_cancha_nombre,
    'club_nombre', v_club_nombre, 'fecha', p_fecha,
    'hora_inicio', p_hora_inicio, 'hora_fin', v_hora_fin, 'duracion_min', p_duracion_min,
    'monto_total', v_monto_total, 'monto_sena', v_monto_sena,
    'cbu_alias', v_cbu_alias, 'nombre_banco', v_nombre_banco,
    'instagram', v_club_instagram, 'sena_porcentaje', v_sena_porcentaje
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER) TO authenticated;
