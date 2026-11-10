-- Flujo de pre-reserva con Mercado Pago, confirmación del club e invitaciones.
-- IMPORTANTE: usar BEGIN/COMMIT para que los ALTER TABLE sean visibles cuando
-- Postgres compila las funciones PL/pgSQL que referencian el tipo public.reservas.
BEGIN;

ALTER TABLE public.reservas
  ADD COLUMN IF NOT EXISTS jugador_app_id UUID REFERENCES public.jugadores_app(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metodo_pago_pre_reserva TEXT CHECK (metodo_pago_pre_reserva IN ('transferencia', 'mercadopago')),
  ADD COLUMN IF NOT EXISTS mp_estado TEXT CHECK (mp_estado IN ('pre_reserva', 'pago_acreditado', 'pago_tardio', 'confirmada', 'expirada')),
  ADD COLUMN IF NOT EXISTS mp_expira_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS club_confirmada_en TIMESTAMPTZ;

ALTER TABLE public.reserva_pagos
  ALTER COLUMN usuario_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS mercadopago_payment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS reserva_pagos_mercadopago_payment_id_uidx
  ON public.reserva_pagos(mercadopago_payment_id)
  WHERE mercadopago_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reservas_jugador_app_id_idx
  ON public.reservas(jugador_app_id)
  WHERE jugador_app_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notificaciones_club (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  reserva_id BIGINT REFERENCES public.reservas(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('pre_reserva', 'pago_mp_acreditado', 'pago_mp_tardio', 'turno_confirmado')),
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  link TEXT NOT NULL DEFAULT '/app/reservas',
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  push_enviada BOOLEAN NOT NULL DEFAULT FALSE,
  email_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notificaciones_club_usuario_fecha_idx
  ON public.notificaciones_club(usuario_id, creada_en DESC);

ALTER TABLE public.notificaciones_club ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notificaciones_club' AND policyname = 'notificaciones_club_select_propias'
  ) THEN
    CREATE POLICY notificaciones_club_select_propias
      ON public.notificaciones_club FOR SELECT TO authenticated
      USING (club_id = public.current_club_id() AND usuario_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notificaciones_club' AND policyname = 'notificaciones_club_update_propias'
  ) THEN
    CREATE POLICY notificaciones_club_update_propias
      ON public.notificaciones_club FOR UPDATE TO authenticated
      USING (club_id = public.current_club_id() AND usuario_id = auth.uid())
      WITH CHECK (club_id = public.current_club_id() AND usuario_id = auth.uid());
  END IF;
END $$;

GRANT SELECT ON public.notificaciones_club TO authenticated;
GRANT UPDATE (leida) ON public.notificaciones_club TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notificaciones_club TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.notificaciones_club_id_seq TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notificaciones_club'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones_club;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reserva_jugadores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reserva_jugadores;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.reserva_invitaciones (
  id BIGSERIAL PRIMARY KEY,
  club_id BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  reserva_id BIGINT NOT NULL REFERENCES public.reservas(id) ON DELETE CASCADE,
  invita_jugador_app_id UUID NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  invitado_jugador_app_id UUID NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'rechazada')),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  respondida_en TIMESTAMPTZ,
  CONSTRAINT reserva_invitaciones_distintos CHECK (invita_jugador_app_id <> invitado_jugador_app_id),
  CONSTRAINT reserva_invitaciones_unica UNIQUE (reserva_id, invitado_jugador_app_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reserva_invitaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reserva_invitaciones;
  END IF;
END;
$$;

ALTER TABLE public.reserva_invitaciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reserva_invitaciones' AND policyname = 'reserva_invitaciones_select_participantes'
  ) THEN
    CREATE POLICY reserva_invitaciones_select_participantes
      ON public.reserva_invitaciones FOR SELECT TO authenticated
      USING (
        invita_jugador_app_id IN (
          SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid()
        )
        OR invitado_jugador_app_id IN (
          SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

GRANT SELECT ON public.reserva_invitaciones TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.reserva_invitaciones_id_seq TO authenticated;

-- La interfaz antigua sigue disponible internamente; esta sobrecarga añade el
-- contexto del jugador y la expiración dentro de la misma transacción.
CREATE OR REPLACE FUNCTION public.fn_reservar_desde_app(
  p_cancha_id BIGINT,
  p_fecha DATE,
  p_hora_inicio TIME,
  p_duracion_min INTEGER,
  p_metodo_pago TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
  v_jugador_app_id UUID;
  v_resultado JSON;
  v_reserva_id BIGINT;
BEGIN
  IF p_metodo_pago IS NULL OR p_metodo_pago NOT IN ('transferencia', 'mercadopago') THEN
    RAISE EXCEPTION 'Método de pago no válido.';
  END IF;

  SELECT club_id INTO v_club_id
  FROM public.canchas
  WHERE id = p_cancha_id AND activa = TRUE;

  UPDATE public.reservas
  SET estado = 'cancelada',
      mp_estado = 'expirada',
      observaciones = concat_ws(E'\n', NULLIF(observaciones, ''), 'Pre-reserva MP vencida sin pago.')
  WHERE club_id = v_club_id
    AND estado = 'pendiente'
    AND mp_estado = 'pre_reserva'
    AND mp_expira_en <= NOW();

  SELECT id INTO v_jugador_app_id
  FROM public.jugadores_app
  WHERE auth_user_id = auth.uid() AND activo = TRUE;

  IF v_jugador_app_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el perfil del jugador autenticado.';
  END IF;

  v_resultado := public.fn_reservar_desde_app(
    p_cancha_id, p_fecha, p_hora_inicio, p_duracion_min
  );
  v_reserva_id := (v_resultado->>'reserva_id')::BIGINT;

  UPDATE public.reservas
  SET jugador_app_id = v_jugador_app_id,
      metodo_pago_pre_reserva = p_metodo_pago,
      mp_estado = CASE WHEN p_metodo_pago = 'mercadopago' THEN 'pre_reserva' ELSE NULL END,
      mp_expira_en = CASE
        WHEN p_metodo_pago = 'mercadopago' THEN NOW() + INTERVAL '10 minutes'
        ELSE NULL
      END
  WHERE id = v_reserva_id;

  INSERT INTO public.notificaciones_club (
    club_id, usuario_id, reserva_id, tipo, titulo, mensaje, metadata, email_enviado
  )
  SELECT v_club_id, u.id, v_reserva_id, 'pre_reserva', 'Nueva pre-reserva de jugador',
    'Un jugador solicitó una cancha. Revisá el pago y confirmá el turno.',
    jsonb_build_object('metodo_pago', p_metodo_pago),
    ROW_NUMBER() OVER (ORDER BY u.id) > 1
  FROM public.usuarios u
  WHERE u.club_id = v_club_id AND u.activo = TRUE AND u.rol IN ('admin', 'vendedor');

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER, TEXT)
  TO authenticated;
-- El overload de 4 args (sin metodo_pago) ya no debe ser llamado directamente
-- desde la app. Lo revocamos solo si existe para evitar error en entornos limpios.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_reservar_desde_app'
      AND p.pronargs = 4
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.fn_reservar_desde_app(BIGINT, DATE, TIME, INTEGER) FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Envuelve la disponibilidad existente y reabre slots cuyo único bloqueo es
-- una pre-reserva de Mercado Pago vencida.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_disponibilidad_publica'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_disponibilidad_publica_sin_vencimientos'
  ) THEN
    ALTER FUNCTION public.fn_disponibilidad_publica(TEXT, DATE)
      RENAME TO fn_disponibilidad_publica_sin_vencimientos;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_disponibilidad_publica(
  p_club_slug TEXT,
  p_fecha DATE
)
RETURNS TABLE (
  cancha_id BIGINT,
  cancha_nombre VARCHAR,
  hora_inicio TIME,
  hora_fin TIME,
  disponible BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_id BIGINT;
BEGIN
  SELECT id INTO v_club_id
  FROM public.clubes
  WHERE slug = p_club_slug AND activo = TRUE;

  IF v_club_id IS NULL THEN
    RETURN;
  END IF;

  WITH vencidas AS (
    UPDATE public.reservas
    SET estado = 'cancelada',
        mp_estado = 'expirada',
        observaciones = concat_ws(E'\n', NULLIF(observaciones, ''), 'Pre-reserva MP vencida sin pago.')
    WHERE club_id = v_club_id
      AND fecha = p_fecha
      AND estado = 'pendiente'
      AND mp_estado = 'pre_reserva'
      AND mp_expira_en <= NOW()
    RETURNING id, club_id, jugador_app_id
  )
  INSERT INTO public.notificaciones (
    jugador_app_id, titulo, mensaje, leido, fecha, tipo, metadata, club_id, link
  )
  SELECT v.jugador_app_id, 'Pre-reserva vencida',
    'No se recibió el pago dentro del plazo y el horario fue liberado.',
    FALSE, NOW(), 'reserva_pre_reserva_expirada',
    jsonb_build_object('reserva_id', v.id), v.club_id, '/player/partidos'
  FROM vencidas v
  WHERE v.jugador_app_id IS NOT NULL;

  RETURN QUERY
  SELECT
    s.cancha_id,
    s.cancha_nombre,
    s.hora_inicio,
    s.hora_fin,
    s.disponible OR (
      EXISTS (
        SELECT 1
        FROM public.reservas vencida
        JOIN public.canchas cv ON cv.id = vencida.cancha_id
        JOIN public.clubes clv ON clv.id = vencida.club_id
        WHERE clv.slug = p_club_slug
          AND vencida.fecha = p_fecha
          AND vencida.cancha_id = s.cancha_id
          AND vencida.estado = 'pendiente'
          AND vencida.mp_estado = 'pre_reserva'
          AND vencida.mp_expira_en <= NOW()
          AND s.hora_inicio < vencida.hora_fin
          AND s.hora_fin > vencida.hora_inicio
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reservas r
        JOIN public.canchas cr ON cr.id = r.cancha_id
        JOIN public.clubes clr ON clr.id = r.club_id
        WHERE clr.slug = p_club_slug
          AND r.fecha = p_fecha
          AND r.cancha_id = s.cancha_id
          AND r.estado <> 'cancelada'
          AND NOT (r.mp_estado = 'pre_reserva' AND r.mp_expira_en <= NOW())
          AND s.hora_inicio < r.hora_fin
          AND s.hora_fin > r.hora_inicio
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.turnos_fijos tf
        JOIN public.canchas cf ON cf.id = tf.cancha_id
        JOIN public.clubes clf ON clf.id = tf.club_id
        WHERE clf.slug = p_club_slug
          AND tf.activo = TRUE
          AND tf.dia_semana = EXTRACT(ISODOW FROM p_fecha)::INT
          AND tf.fecha_desde <= p_fecha
          AND (tf.fecha_hasta IS NULL OR tf.fecha_hasta >= p_fecha)
          AND tf.cancha_id = s.cancha_id
          AND s.hora_inicio < public.fn_calcular_hora_fin(tf.hora_inicio, tf.duracion_min)
          AND s.hora_fin > tf.hora_inicio
          AND NOT EXISTS (
            SELECT 1 FROM public.reservas rc
            WHERE rc.turno_fijo_id = tf.id
              AND rc.fecha = p_fecha
              AND rc.estado = 'cancelada'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.clases c
        JOIN public.canchas cc ON cc.id = c.cancha_id
        JOIN public.clubes clc ON clc.id = c.club_id
        WHERE clc.slug = p_club_slug
          AND c.activa = TRUE
          AND c.cancha_id = s.cancha_id
          AND (
            (c.es_recurrente IS NOT FALSE AND EXTRACT(ISODOW FROM p_fecha)::INT = ANY(c.dias_semana))
            OR (c.es_recurrente IS FALSE AND c.fecha_clase = p_fecha)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.clase_ocurrencias co
            WHERE co.clase_id = c.id
              AND co.fecha = p_fecha
              AND co.estado IN ('cancelada', 'liberada')
          )
          AND s.hora_inicio < public.fn_calcular_hora_fin(c.hora_inicio, c.duracion_min)
          AND s.hora_fin > c.hora_inicio
      )
    ) AS disponible
  FROM public.fn_disponibilidad_publica_sin_vencimientos(p_club_slug, p_fecha) s;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_disponibilidad_publica(TEXT, DATE) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_disponibilidad_publica_sin_vencimientos(TEXT, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_registrar_pago_mp_reserva(
  p_reserva_id BIGINT,
  p_payment_id TEXT,
  p_monto DECIMAL(12,2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reserva public.reservas;
  v_pago_id BIGINT;
  v_titular_id BIGINT;
  v_cuenta_id BIGINT;
  v_estado_pago TEXT;
  v_tardio BOOLEAN;
  v_expirada BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Solo el servidor de pagos puede registrar pagos de Mercado Pago.';
  END IF;
  IF p_payment_id IS NULL OR p_payment_id = '' OR p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'Datos de pago inválidos.';
  END IF;

  SELECT * INTO v_reserva
  FROM public.reservas
  WHERE id = p_reserva_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada.'; END IF;
  IF v_reserva.metodo_pago_pre_reserva IS DISTINCT FROM 'mercadopago' THEN
    RAISE EXCEPTION 'Esta reserva no corresponde a un pago de Mercado Pago.';
  END IF;

  SELECT id INTO v_pago_id
  FROM public.reserva_pagos
  WHERE mercadopago_payment_id = p_payment_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'reserva_id', p_reserva_id,
      'estado', v_reserva.mp_estado,
      'payment_id', p_payment_id,
      'idempotente', TRUE
    );
  END IF;

  IF ABS(p_monto - v_reserva.monto_sena) > 0.01 THEN
    RAISE EXCEPTION 'El monto aprobado no coincide con la seña de la reserva.';
  END IF;

  v_tardio := v_reserva.estado = 'cancelada'
    OR v_reserva.mp_estado <> 'pre_reserva'
    OR v_reserva.mp_expira_en IS NULL
    OR v_reserva.mp_expira_en <= NOW();
  v_expirada := v_reserva.estado = 'pendiente'
    AND v_reserva.mp_estado = 'pre_reserva'
    AND (v_reserva.mp_expira_en IS NULL OR v_reserva.mp_expira_en <= NOW());

  SELECT rj.id INTO v_titular_id
  FROM public.reserva_jugadores rj
  WHERE rj.reserva_id = p_reserva_id AND rj.es_titular = TRUE
  LIMIT 1;

  SELECT mcd.cuenta_id INTO v_cuenta_id
  FROM public.medio_cuenta_default mcd
  WHERE mcd.club_id = v_reserva.club_id AND mcd.medio_pago = 'mp';

  INSERT INTO public.reserva_pagos (
    club_id, reserva_id, monto, medio_pago, tipo, jugador_id,
    reserva_jugador_id, monto_alquiler, monto_consumo, usuario_id,
    observaciones, cuenta_id, mercadopago_payment_id
  ) VALUES (
    v_reserva.club_id, p_reserva_id, p_monto, 'mp', 'sena',
    v_reserva.jugador_id, v_titular_id, p_monto, 0, NULL,
    'Seña acreditada por Mercado Pago (' || p_payment_id || ')',
    v_cuenta_id, p_payment_id
  ) RETURNING id INTO v_pago_id;

  v_estado_pago := CASE WHEN v_tardio THEN 'pago_tardio' ELSE 'pago_acreditado' END;

  UPDATE public.reservas
  SET monto_pagado = monto_pagado + p_monto,
      monto_sena = p_monto,
      mp_estado = v_estado_pago,
      estado = CASE
        WHEN v_expirada THEN 'cancelada'
        WHEN v_tardio THEN estado
        ELSE 'senada'
      END,
      mp_expira_en = CASE WHEN v_expirada THEN mp_expira_en ELSE NULL END,
      observaciones = concat_ws(E'\n', NULLIF(observaciones, ''),
        'Pago Mercado Pago #' || p_payment_id || CASE WHEN v_tardio THEN ' pendiente de resolución del club.' ELSE '.' END)
  WHERE id = p_reserva_id;

  INSERT INTO public.notificaciones_club (
    club_id, usuario_id, reserva_id, tipo, titulo, mensaje, metadata, email_enviado
  )
  SELECT v_reserva.club_id, u.id, p_reserva_id,
    CASE WHEN v_tardio THEN 'pago_mp_tardio' ELSE 'pago_mp_acreditado' END,
    CASE WHEN v_tardio THEN 'Pago MP recibido fuera de término' ELSE 'Seña acreditada por Mercado Pago' END,
    CASE WHEN v_tardio
      THEN 'El pago llegó luego del vencimiento. Revisá la reserva antes de resolverla.'
      ELSE 'La seña se acreditó. Confirmá el turno para avisarle al jugador.'
    END,
    jsonb_build_object('payment_id', p_payment_id, 'monto', p_monto, 'pago_tardio', v_tardio),
    ROW_NUMBER() OVER (ORDER BY u.id) > 1
  FROM public.usuarios u
  WHERE u.club_id = v_reserva.club_id AND u.activo = TRUE AND u.rol IN ('admin', 'vendedor');

  IF v_reserva.jugador_app_id IS NOT NULL THEN
    INSERT INTO public.notificaciones (
      jugador_app_id, titulo, mensaje, leido, fecha, tipo, metadata, club_id, link
    ) VALUES (
      v_reserva.jugador_app_id,
      CASE WHEN v_tardio THEN 'Pago recibido, pendiente de revisión' ELSE 'Seña acreditada' END,
      CASE WHEN v_tardio
        THEN 'El pago llegó luego del vencimiento. El club revisará cómo resolver la reserva.'
        ELSE 'La seña se acreditó. El club debe confirmar el turno.'
      END,
      FALSE, NOW(), 'reserva_pago_recibido',
      jsonb_build_object('reserva_id', p_reserva_id, 'payment_id', p_payment_id, 'pago_tardio', v_tardio),
      v_reserva.club_id, '/player/partidos'
    );
  END IF;

  RETURN jsonb_build_object(
    'reserva_id', p_reserva_id,
    'estado', v_estado_pago,
    'payment_id', p_payment_id,
    'pago_id', v_pago_id,
    'idempotente', FALSE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_registrar_pago_mp_reserva(BIGINT, TEXT, DECIMAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_registrar_pago_mp_reserva(BIGINT, TEXT, DECIMAL) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_confirmar_reserva_club(p_reserva_id BIGINT)
RETURNS public.reservas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reserva public.reservas;
  v_monto_transferencia NUMERIC(12,2) := 0;
  v_cuenta_transferencia BIGINT;
  v_titular_id BIGINT;
  v_es_caja_transferencia BOOLEAN := FALSE;
  v_turno_caja_id BIGINT;
BEGIN
  SELECT * INTO v_reserva
  FROM public.reservas
  WHERE id = p_reserva_id AND club_id = public.current_club_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reserva no encontrada en tu club.'; END IF;
  IF NOT has_user_permission('reservas', 'editar')
     AND current_user_rol() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'No tenés permiso para confirmar reservas.';
  END IF;
  IF v_reserva.club_confirmada_en IS NOT NULL THEN
    RETURN v_reserva;
  END IF;
  IF v_reserva.metodo_pago_pre_reserva = 'mercadopago'
     AND (v_reserva.mp_estado <> 'pago_acreditado' OR v_reserva.estado <> 'senada') THEN
    RAISE EXCEPTION 'Solo se puede confirmar una reserva MP con la seña acreditada.';
  END IF;
  IF v_reserva.metodo_pago_pre_reserva = 'transferencia'
     AND v_reserva.estado NOT IN ('pendiente', 'senada') THEN
    RAISE EXCEPTION 'Esta reserva ya no está pendiente de confirmación.';
  END IF;
  IF v_reserva.metodo_pago_pre_reserva IS NULL THEN
    RAISE EXCEPTION 'Esta reserva no se creó desde el flujo de jugador.';
  END IF;

  IF v_reserva.metodo_pago_pre_reserva = 'transferencia' THEN
    v_monto_transferencia := GREATEST(0, v_reserva.monto_sena - v_reserva.monto_pagado);
    IF v_monto_transferencia > v_reserva.monto_total - v_reserva.monto_pagado THEN
      RAISE EXCEPTION 'La seña supera el saldo pendiente de la reserva.';
    END IF;

    IF v_monto_transferencia > 0 THEN
      SELECT id INTO v_titular_id
      FROM public.reserva_jugadores
      WHERE reserva_id = p_reserva_id AND es_titular = TRUE AND tipo = 'jugador'
      LIMIT 1;

      SELECT mcd.cuenta_id, c.es_caja_fisica
      INTO v_cuenta_transferencia, v_es_caja_transferencia
      FROM public.medio_cuenta_default mcd
      JOIN public.cuentas c ON c.id = mcd.cuenta_id AND c.club_id = mcd.club_id
      WHERE mcd.club_id = v_reserva.club_id AND mcd.medio_pago = 'transferencia';

      IF COALESCE(v_es_caja_transferencia, FALSE) THEN
        v_turno_caja_id := public.current_club_caja_abierta();
        IF v_turno_caja_id IS NULL THEN
          RAISE EXCEPTION 'No hay caja abierta para registrar el cobro en esta cuenta física.';
        END IF;
      END IF;

      INSERT INTO public.reserva_pagos (
        club_id, reserva_id, monto, medio_pago, tipo, jugador_id,
        reserva_jugador_id, monto_alquiler, monto_consumo, usuario_id,
        observaciones, cuenta_id, turno_caja_id
      ) VALUES (
        v_reserva.club_id, p_reserva_id, v_monto_transferencia, 'transferencia',
        CASE WHEN v_reserva.monto_pagado + v_monto_transferencia >= v_reserva.monto_total
          THEN 'pago' ELSE 'sena' END,
        v_reserva.jugador_id, v_titular_id, v_monto_transferencia, 0, auth.uid(),
        'Seña por transferencia verificada por el club.', v_cuenta_transferencia, v_turno_caja_id
      );
    END IF;
  END IF;

  UPDATE public.reservas
  SET mp_estado = CASE WHEN mp_estado = 'pago_acreditado' THEN 'confirmada' ELSE mp_estado END,
      monto_pagado = monto_pagado + v_monto_transferencia,
      monto_sena = CASE
        WHEN metodo_pago_pre_reserva = 'transferencia' AND v_monto_transferencia > 0
          THEN monto_pagado + v_monto_transferencia
        ELSE monto_sena
      END,
      estado = CASE
        WHEN metodo_pago_pre_reserva = 'transferencia'
          AND monto_pagado + v_monto_transferencia >= monto_total THEN 'pagada'
        WHEN metodo_pago_pre_reserva = 'transferencia' THEN 'senada'
        ELSE estado
      END,
      club_confirmada_en = NOW()
  WHERE id = p_reserva_id
  RETURNING * INTO v_reserva;

  INSERT INTO public.notificaciones_club (
    club_id, usuario_id, reserva_id, tipo, titulo, mensaje, metadata, email_enviado
  )
  SELECT v_reserva.club_id, u.id, p_reserva_id, 'turno_confirmado',
    'Turno confirmado', 'El club confirmó el turno.',
    jsonb_build_object('confirmado_por', auth.uid()),
    ROW_NUMBER() OVER (ORDER BY u.id) > 1
  FROM public.usuarios u
  WHERE u.club_id = v_reserva.club_id AND u.activo = TRUE AND u.rol IN ('admin', 'vendedor');

  IF v_reserva.jugador_app_id IS NOT NULL THEN
    INSERT INTO public.notificaciones (
      jugador_app_id, titulo, mensaje, leido, fecha, tipo, metadata, club_id, link
    ) VALUES (
      v_reserva.jugador_app_id, 'Turno confirmado por el club',
      'Tu cancha ya está confirmada. ¡Te esperamos!', FALSE, NOW(), 'reserva_confirmada',
      jsonb_build_object('reserva_id', p_reserva_id), v_reserva.club_id, '/player/partidos'
    );
  END IF;

  RETURN v_reserva;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_confirmar_reserva_club(BIGINT) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_confirmar_reserva_club(BIGINT) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.fn_invitar_amigo_a_reserva(
  p_reserva_id BIGINT,
  p_amigo_jugador_app_id UUID
)
RETURNS public.reserva_invitaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jugador_app_id UUID;
  v_reserva public.reservas;
  v_id1 UUID;
  v_id2 UUID;
  v_invitacion public.reserva_invitaciones;
BEGIN
  SELECT id INTO v_jugador_app_id
  FROM public.jugadores_app
  WHERE auth_user_id = auth.uid() AND activo = TRUE;
  IF v_jugador_app_id IS NULL THEN RAISE EXCEPTION 'Perfil de jugador no encontrado.'; END IF;

  SELECT * INTO v_reserva
  FROM public.reservas
  WHERE id = p_reserva_id AND jugador_app_id = v_jugador_app_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La reserva no pertenece a tu cuenta.'; END IF;
  IF v_reserva.mp_estado <> 'confirmada' AND v_reserva.club_confirmada_en IS NULL THEN
    RAISE EXCEPTION 'El club debe confirmar el turno antes de invitar amigos.';
  END IF;
  IF p_amigo_jugador_app_id = v_jugador_app_id THEN
    RAISE EXCEPTION 'No podés invitarte a vos mismo.';
  END IF;

  v_id1 := LEAST(v_jugador_app_id, p_amigo_jugador_app_id);
  v_id2 := GREATEST(v_jugador_app_id, p_amigo_jugador_app_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.jugador_amigos
    WHERE jugador_app_id_1 = v_id1 AND jugador_app_id_2 = v_id2 AND confirmado = TRUE
  ) THEN
    RAISE EXCEPTION 'Solo podés invitar amigos confirmados.';
  END IF;

  INSERT INTO public.reserva_invitaciones (
    club_id, reserva_id, invita_jugador_app_id, invitado_jugador_app_id
  ) VALUES (
    v_reserva.club_id, p_reserva_id, v_jugador_app_id, p_amigo_jugador_app_id
  )
  ON CONFLICT (reserva_id, invitado_jugador_app_id) DO NOTHING
  RETURNING * INTO v_invitacion;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este amigo ya fue invitado a la reserva.';
  END IF;

  RETURN v_invitacion;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_invitar_amigo_a_reserva(BIGINT, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_invitar_amigo_a_reserva(BIGINT, UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.fn_responder_invitacion_reserva(
  p_invitacion_id BIGINT,
  p_aceptar BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jugador_app_id UUID;
  v_nombre TEXT;
  v_email TEXT;
  v_telefono TEXT;
  v_invitacion public.reserva_invitaciones;
  v_reserva public.reservas;
  v_jugador_id BIGINT;
  v_participante_id BIGINT;
BEGIN
  SELECT id, nombre_display, telefono
  INTO v_jugador_app_id, v_nombre, v_telefono
  FROM public.jugadores_app
  WHERE auth_user_id = auth.uid() AND activo = TRUE;
  IF v_jugador_app_id IS NULL THEN RAISE EXCEPTION 'Perfil de jugador no encontrado.'; END IF;

  SELECT * INTO v_invitacion
  FROM public.reserva_invitaciones
  WHERE id = p_invitacion_id
    AND invitado_jugador_app_id = v_jugador_app_id
    AND estado = 'pendiente'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La invitación no existe o ya fue respondida.'; END IF;

  SELECT * INTO v_reserva FROM public.reservas WHERE id = v_invitacion.reserva_id;
  IF v_reserva.club_confirmada_en IS NULL THEN
    RAISE EXCEPTION 'El club todavía no confirmó este turno.';
  END IF;
  IF v_reserva.estado = 'cancelada' OR v_reserva.fecha < CURRENT_DATE THEN
    RAISE EXCEPTION 'La reserva ya no está disponible para invitaciones.';
  END IF;
  IF NOT p_aceptar THEN
    UPDATE public.reserva_invitaciones
    SET estado = 'rechazada', respondida_en = NOW()
    WHERE id = p_invitacion_id;
    RETURN jsonb_build_object(
      'estado', 'rechazada',
      'reserva_id', v_invitacion.reserva_id,
      'invita_jugador_app_id', v_invitacion.invita_jugador_app_id
    );
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT id INTO v_jugador_id
  FROM public.jugadores
  WHERE club_id = v_reserva.club_id
    AND activo = TRUE
    AND ((v_email IS NOT NULL AND lower(email) = lower(v_email))
      OR (v_telefono IS NOT NULL AND telefono = v_telefono))
  ORDER BY id
  LIMIT 1;

  IF v_jugador_id IS NULL THEN
    INSERT INTO public.jugadores (club_id, nombre, email, telefono, activo)
    VALUES (v_reserva.club_id, COALESCE(v_nombre, 'Jugador App'), v_email, v_telefono, TRUE)
    RETURNING id INTO v_jugador_id;
  END IF;

  SELECT id INTO v_participante_id
  FROM public.reserva_jugadores
  WHERE reserva_id = v_reserva.id AND jugador_id = v_jugador_id
  LIMIT 1;

  IF v_participante_id IS NULL THEN
    INSERT INTO public.reserva_jugadores (
      club_id, reserva_id, jugador_id, es_titular, tipo
    ) VALUES (
      v_reserva.club_id, v_reserva.id, v_jugador_id, FALSE, 'jugador'
    )
    RETURNING id INTO v_participante_id;
  END IF;

  UPDATE public.reserva_invitaciones
  SET estado = 'aceptada', respondida_en = NOW()
  WHERE id = p_invitacion_id;

  RETURN jsonb_build_object(
    'estado', 'aceptada',
    'reserva_id', v_reserva.id,
    'club_id', v_reserva.club_id,
    'club_nombre', (SELECT nombre FROM public.clubes WHERE id = v_reserva.club_id),
    'cancha_nombre', (SELECT nombre FROM public.canchas WHERE id = v_reserva.cancha_id),
    'fecha', v_reserva.fecha,
    'hora_inicio', v_reserva.hora_inicio,
    'invita_jugador_app_id', v_invitacion.invita_jugador_app_id,
    'participante_id', v_participante_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_responder_invitacion_reserva(BIGINT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_responder_invitacion_reserva(BIGINT, BOOLEAN) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.fn_mis_reservas_app_v2()
RETURNS TABLE (
  id BIGINT,
  club_id BIGINT,
  club_nombre TEXT,
  cancha_nombre TEXT,
  fecha DATE,
  hora_inicio TIME,
  hora_fin TIME,
  duracion_min INTEGER,
  estado TEXT,
  monto_total NUMERIC(12,2),
  monto_pagado NUMERIC(12,2),
  es_futura BOOLEAN,
  mp_estado TEXT,
  club_confirmada_en TIMESTAMPTZ,
  mp_expira_en TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jugador_app_id UUID;
  v_telefono TEXT;
  v_jugador_ids BIGINT[];
BEGIN
  SELECT ja.id, fn_normalizar_telefono(ja.telefono)
  INTO v_jugador_app_id, v_telefono
  FROM public.jugadores_app ja
  WHERE ja.auth_user_id = auth.uid() AND ja.activo = TRUE;
  IF v_jugador_app_id IS NULL THEN RETURN; END IF;

  SELECT array_agg(j.id) INTO v_jugador_ids
  FROM public.jugadores j
  WHERE v_telefono IS NOT NULL
    AND fn_normalizar_telefono(j.telefono) = v_telefono;

  RETURN QUERY
  WITH coincidencias AS (
    SELECT DISTINCT r.*
    FROM public.reservas r
    WHERE r.jugador_app_id = v_jugador_app_id
      OR (v_jugador_ids IS NOT NULL AND r.jugador_id = ANY(v_jugador_ids))
  ), proximas AS (
    SELECT r.id, r.club_id, cl.nombre::TEXT AS club_nombre, ca.nombre::TEXT AS cancha_nombre,
      r.fecha, r.hora_inicio, r.hora_fin, r.duracion_min, r.estado::TEXT,
      r.monto_total, r.monto_pagado, TRUE AS es_futura,
      CASE WHEN r.mp_estado = 'pre_reserva' AND r.mp_expira_en <= NOW()
        THEN 'expirada' ELSE r.mp_estado END AS mp_estado,
      r.club_confirmada_en, r.mp_expira_en
    FROM coincidencias r
    JOIN public.canchas ca ON ca.id = r.cancha_id
    JOIN public.clubes cl ON cl.id = r.club_id
    WHERE r.fecha >= CURRENT_DATE AND r.estado <> 'cancelada'
  ), historial AS (
    SELECT r.id, r.club_id, cl.nombre::TEXT AS club_nombre, ca.nombre::TEXT AS cancha_nombre,
      r.fecha, r.hora_inicio, r.hora_fin, r.duracion_min, r.estado::TEXT,
      r.monto_total, r.monto_pagado, FALSE AS es_futura,
      CASE WHEN r.mp_estado = 'pre_reserva' AND r.mp_expira_en <= NOW()
        THEN 'expirada' ELSE r.mp_estado END AS mp_estado,
      r.club_confirmada_en, r.mp_expira_en
    FROM coincidencias r
    JOIN public.canchas ca ON ca.id = r.cancha_id
    JOIN public.clubes cl ON cl.id = r.club_id
    WHERE r.fecha < CURRENT_DATE OR r.estado = 'cancelada'
    ORDER BY r.fecha DESC, r.hora_inicio DESC
    LIMIT 10
  )
  SELECT * FROM proximas
  UNION ALL
  SELECT * FROM historial
  ORDER BY es_futura DESC, fecha ASC, hora_inicio ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_mis_reservas_app_v2() TO authenticated;
REVOKE ALL ON FUNCTION public.fn_mis_reservas_app_v2() FROM PUBLIC, anon;

COMMIT;