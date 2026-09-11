-- 0111 — Tokens de dispositivos para push notifications y políticas de notificaciones

-- 1. Tabla para almacenar tokens FCM / WebPush de dispositivos de jugadores
CREATE TABLE IF NOT EXISTS public.jugador_device_tokens (
  id              BIGSERIAL PRIMARY KEY,
  jugador_app_id  UUID NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  auth_user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token           TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_jugador_device_token UNIQUE (jugador_app_id, token)
);

CREATE INDEX IF NOT EXISTS idx_jugador_device_tokens_jugador ON public.jugador_device_tokens (jugador_app_id);
CREATE INDEX IF NOT EXISTS idx_jugador_device_tokens_user ON public.jugador_device_tokens (auth_user_id);

ALTER TABLE public.jugador_device_tokens ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para jugador_device_tokens
DROP POLICY IF EXISTS "tokens_select_own" ON public.jugador_device_tokens;
CREATE POLICY "tokens_select_own"
  ON public.jugador_device_tokens FOR SELECT
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR jugador_app_id IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tokens_insert_own" ON public.jugador_device_tokens;
CREATE POLICY "tokens_insert_own"
  ON public.jugador_device_tokens FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_user_id = auth.uid()
    OR jugador_app_id IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tokens_update_own" ON public.jugador_device_tokens;
CREATE POLICY "tokens_update_own"
  ON public.jugador_device_tokens FOR UPDATE
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR jugador_app_id IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tokens_delete_own" ON public.jugador_device_tokens;
CREATE POLICY "tokens_delete_own"
  ON public.jugador_device_tokens FOR DELETE
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR jugador_app_id IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

-- 2. Asegurar columnas y RLS en notificaciones
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS link TEXT;

ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notificaciones_select_own" ON public.notificaciones;
CREATE POLICY "notificaciones_select_own"
  ON public.notificaciones FOR SELECT
  TO authenticated
  USING (
    jugador_app_id IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
    OR jugador_app_id IS NULL
  );

DROP POLICY IF EXISTS "notificaciones_insert_auth" ON public.notificaciones;
CREATE POLICY "notificaciones_insert_auth"
  ON public.notificaciones FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "notificaciones_update_own" ON public.notificaciones;
CREATE POLICY "notificaciones_update_own"
  ON public.notificaciones FOR UPDATE
  TO authenticated
  USING (
    jugador_app_id IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "notificaciones_delete_own" ON public.notificaciones;
CREATE POLICY "notificaciones_delete_own"
  ON public.notificaciones FOR DELETE
  TO authenticated
  USING (
    jugador_app_id IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

-- 3. Habilitar Realtime para notificaciones
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'notificaciones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugador_device_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificaciones TO authenticated;
