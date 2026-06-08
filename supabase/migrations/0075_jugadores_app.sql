-- 0075 — jugadores_app: perfil cross-club del jugador B2C
-- Sin club_id — la cuenta del jugador es independiente de cualquier club.
-- Un jugador puede jugar en múltiples clubes y tiene un único perfil.

CREATE TABLE public.jugadores_app (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      UUID        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre_display    TEXT        NOT NULL,
  nombre_corto      TEXT        NOT NULL,
  foto_url          TEXT,
  zona              TEXT,
  rating            INTEGER     NOT NULL DEFAULT 1400 CHECK (rating >= 1200),
  partidos_jugados  INTEGER     NOT NULL DEFAULT 0,
  partidos_ganados  INTEGER     NOT NULL DEFAULT 0,
  activo            BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Categoría derivada del rating (no almacenada, calculada en query o app)
-- 4ta ≥ 2000 | 5ta ≥ 1800 | 6ta ≥ 1600 | 7ta ≥ 1400 | 8ta < 1400

CREATE INDEX idx_jugadores_app_auth ON public.jugadores_app (auth_user_id);
CREATE INDEX idx_jugadores_app_rating ON public.jugadores_app (rating DESC);

ALTER TABLE public.jugadores_app ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier jugador autenticado puede ver perfiles (para el ranking)
CREATE POLICY "jugadores_app_select_authenticated"
  ON public.jugadores_app FOR SELECT
  TO authenticated
  USING (true);

-- Insert: solo el propio usuario puede crear su perfil
CREATE POLICY "jugadores_app_insert_own"
  ON public.jugadores_app FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

-- Update: solo el propio usuario puede editar su perfil
CREATE POLICY "jugadores_app_update_own"
  ON public.jugadores_app FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER jugadores_app_updated_at
  BEFORE UPDATE ON public.jugadores_app
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.jugadores_app IS
  'Perfil cross-club del jugador B2C. Sin club_id — un jugador puede jugar en N clubes.';
