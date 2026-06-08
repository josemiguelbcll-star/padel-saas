-- ============================================================================
-- 0078 — fn_mis_reservas_app: cruce de reservas del club con perfil del jugador
-- REQUIERE: migraciones 0077 (jugadores_app.telefono) aplicada previamente.
--
-- Estrategia de matching: teléfono normalizado a +54XXXXXXXXXX (E.164-like AR).
--   Buenos Aires: 011-XXXX-XXXX → +5411XXXXXXXX (área 11, 2 dígitos)
--   Interior:     0387-XXX-XXXX → +54387XXXXXXX (área 387, 3 dígitos)
--   Zonas chicas: 02901-XX-XXXX → +542901XXXXXX (área 2901, 4 dígitos)
--
-- Seguridad:
--   fn_normalizar_telefono: IMMUTABLE (usable en índices de expresión).
--   fn_mis_reservas_app:    SECURITY DEFINER (bypassa RLS para leer reservas
--     de todos los clubes, filtrando SOLO las del jugador autenticado).
-- ============================================================================

-- ── 1. fn_normalizar_telefono ─────────────────────────────────────────────────
-- Normaliza teléfonos argentinos a '+54XXXXXXXXXX' (13 caracteres).
-- Devuelve NULL si el formato no es reconocible como número AR de 10 dígitos.
--
-- Formatos de entrada aceptados (ejemplos):
--   +54 9 387 421-1234  → +54387XXXXXXX  (internacional móvil)
--   +54 387 421-1234    → +54387XXXXXXX  (internacional fijo)
--   0387-421-1234       → +54387XXXXXXX  (local con prefijo 0)
--   3874211234          → +54387XXXXXXX  (10 dígitos directos)
--   011-4123-4567       → +5411XXXXXXXX  (Buenos Aires local)
--   1141234567          → +5411XXXXXXXX  (BA, 10 dígitos)

CREATE OR REPLACE FUNCTION public.fn_normalizar_telefono(p_tel TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  -- Solo dígitos
  v_digits := regexp_replace(p_tel, '\D', '', 'g');

  -- Caso A: empieza con 54 → formato internacional (con o sin +)
  IF v_digits LIKE '54%' THEN
    v_digits := substring(v_digits FROM 3);
    -- Prefijo móvil 9: +54 9 XXXXXXXXXX → quitar el 9 (deja 10 dígitos)
    IF length(v_digits) = 11 AND left(v_digits, 1) = '9' THEN
      v_digits := substring(v_digits FROM 2);
    END IF;
    IF length(v_digits) = 10 THEN
      RETURN '+54' || v_digits;
    END IF;
    RETURN NULL;
  END IF;

  -- Caso B: empieza con 0 → formato local con prefijo de código de área
  -- Ej: 0387XXXXXXX (11 dígitos) → strip 0 → 387XXXXXXX (10)
  IF v_digits LIKE '0%' THEN
    v_digits := substring(v_digits FROM 2);
    IF length(v_digits) = 10 THEN
      RETURN '+54' || v_digits;
    END IF;
    RETURN NULL;
  END IF;

  -- Caso C: exactamente 10 dígitos → código de área (sin 0) + número abonado
  IF length(v_digits) = 10 THEN
    RETURN '+54' || v_digits;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.fn_normalizar_telefono IS
  'Normaliza teléfonos argentinos a +54XXXXXXXXXX (E.164-like).
   10 dígitos significativos = código de área sin 0 + número abonado.
   BA (área 11, 2 dígitos): 011-XXXX-XXXX → +5411XXXXXXXX.
   Interior (área 3 dígitos): 0387-XXX-XXXX → +54387XXXXXXX.
   Devuelve NULL si el formato no es reconocible. IMMUTABLE para índices.';


-- ── 2. Índices de expresión ───────────────────────────────────────────────────
-- Hacen eficiente el JOIN en fn_mis_reservas_app.

-- Sobre jugadores (per-club): creado aquí, columna telefono existe desde 0004.
CREATE INDEX IF NOT EXISTS idx_jugadores_tel_norm
  ON public.jugadores (fn_normalizar_telefono(telefono))
  WHERE telefono IS NOT NULL;

-- Sobre jugadores_app (cross-club): columna telefono agregada por 0077.
CREATE INDEX IF NOT EXISTS idx_jugadores_app_tel_norm
  ON public.jugadores_app (fn_normalizar_telefono(telefono))
  WHERE telefono IS NOT NULL;


-- ── 3. fn_mis_reservas_app ───────────────────────────────────────────────────
-- Devuelve las reservas del jugador autenticado cruzadas por teléfono.
--
-- Matching: fn_normalizar_telefono(jugadores.telefono) =
--           fn_normalizar_telefono(jugadores_app.telefono)
--
-- Resultado:
--   · Próximas: fecha >= hoy, estado != 'cancelada'  → es_futura = TRUE
--   · Historial: fecha < hoy o cancelada, últimas 10 → es_futura = FALSE
--
-- SECURITY DEFINER: bypassa RLS para leer reservas/jugadores/canchas/clubes
-- de todos los tenants. La condición de matching garantiza que solo se
-- devuelven las reservas del auth.uid() actual.

CREATE OR REPLACE FUNCTION public.fn_mis_reservas_app()
RETURNS TABLE(
  id            BIGINT,
  club_id       BIGINT,
  club_nombre   TEXT,
  cancha_nombre TEXT,
  fecha         DATE,
  hora_inicio   TIME,
  hora_fin      TIME,
  duracion_min  INTEGER,
  estado        TEXT,
  monto_total   NUMERIC(12,2),
  monto_pagado  NUMERIC(12,2),
  es_futura     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID;
  v_tel_norm TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sin sesión activa';
  END IF;

  -- Obtener teléfono normalizado del jugador autenticado
  SELECT fn_normalizar_telefono(ja.telefono)
  INTO   v_tel_norm
  FROM   jugadores_app ja
  WHERE  ja.auth_user_id = v_user_id
    AND  ja.activo = TRUE;

  -- Sin teléfono registrado → no hay matching posible
  IF v_tel_norm IS NULL THEN
    RETURN;
  END IF;

  -- Próximas + últimas 10 históricas
  RETURN QUERY
  WITH proximas AS (
    SELECT
      r.id,
      r.club_id,
      cl.nombre::TEXT   AS club_nombre,
      ca.nombre::TEXT   AS cancha_nombre,
      r.fecha,
      r.hora_inicio,
      r.hora_fin,
      r.duracion_min,
      r.estado::TEXT,
      r.monto_total,
      r.monto_pagado,
      TRUE              AS es_futura
    FROM   reservas  r
    JOIN   canchas   ca ON ca.id = r.cancha_id
    JOIN   clubes    cl ON cl.id = r.club_id
    JOIN   jugadores j  ON j.id  = r.jugador_id
    WHERE  r.fecha >= CURRENT_DATE
      AND  r.estado != 'cancelada'
      AND  fn_normalizar_telefono(j.telefono) = v_tel_norm
  ),
  historial AS (
    SELECT
      r.id,
      r.club_id,
      cl.nombre::TEXT   AS club_nombre,
      ca.nombre::TEXT   AS cancha_nombre,
      r.fecha,
      r.hora_inicio,
      r.hora_fin,
      r.duracion_min,
      r.estado::TEXT,
      r.monto_total,
      r.monto_pagado,
      FALSE             AS es_futura
    FROM   reservas  r
    JOIN   canchas   ca ON ca.id = r.cancha_id
    JOIN   clubes    cl ON cl.id = r.club_id
    JOIN   jugadores j  ON j.id  = r.jugador_id
    WHERE  (r.fecha < CURRENT_DATE OR r.estado = 'cancelada')
      AND  fn_normalizar_telefono(j.telefono) = v_tel_norm
    ORDER BY r.fecha DESC, r.hora_inicio DESC
    LIMIT 10
  )
  SELECT * FROM proximas
  UNION ALL
  SELECT * FROM historial
  ORDER BY es_futura DESC, fecha ASC, hora_inicio ASC;
END;
$$;

COMMENT ON FUNCTION public.fn_mis_reservas_app IS
  'Devuelve las reservas del jugador autenticado cruzadas por teléfono normalizado.
   Próximas (fecha >= hoy, no canceladas) + historial (últimas 10, por fecha DESC).
   SECURITY DEFINER: lee reservas de todos los clubes para el matching cross-club.
   Si el jugador no tiene teléfono registrado, devuelve conjunto vacío.';

GRANT EXECUTE ON FUNCTION public.fn_mis_reservas_app() TO authenticated;
