-- 0080 — Feed central + Sistema de amigos global
--
-- club_posts: posts del feed de toda la plataforma (creados por admins)
-- jugador_amigos: red de amigos cross-club (global)
-- RLS: feed es público (cualquier jugador autenticado lo ve)
--       amigos: cada jugador ve solo los suyos

-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.club_posts (
  id              BIGSERIAL PRIMARY KEY,
  club_id         BIGINT NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  usuario_id      UUID   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo          TEXT NOT NULL,
  contenido       TEXT NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('noticia', 'promo', 'torneo', 'otro')),
  imagen_url      TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  vigente_desde   DATE,
  vigente_hasta   DATE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_club_posts_club ON public.club_posts (club_id);
CREATE INDEX idx_club_posts_activo ON public.club_posts (activo) WHERE activo = TRUE;
CREATE INDEX idx_club_posts_tipo ON public.club_posts (tipo);

ALTER TABLE public.club_posts ENABLE ROW LEVEL SECURITY;

-- Cualquier jugador autenticado puede VER posts activos de cualquier club
CREATE POLICY "posts_select_public"
  ON public.club_posts FOR SELECT
  TO authenticated
  USING (activo = TRUE);

-- Solo admin del club puede crear/editar/eliminar posts suyos
CREATE POLICY "posts_insert_admin"
  ON public.club_posts FOR INSERT
  TO authenticated
  WITH CHECK (
    club_id IN (
      SELECT club_id FROM public.usuarios
      WHERE id = auth.uid() AND rol IN ('admin', 'super_admin')
    )
    AND usuario_id = auth.uid()
  );

CREATE POLICY "posts_update_admin"
  ON public.club_posts FOR UPDATE
  TO authenticated
  USING (
    club_id IN (
      SELECT club_id FROM public.usuarios
      WHERE id = auth.uid() AND rol IN ('admin', 'super_admin')
    )
    AND usuario_id = auth.uid()
  );

CREATE POLICY "posts_delete_admin"
  ON public.club_posts FOR DELETE
  TO authenticated
  USING (
    club_id IN (
      SELECT club_id FROM public.usuarios
      WHERE id = auth.uid() AND rol IN ('admin', 'super_admin')
    )
    AND usuario_id = auth.uid()
  );

COMMENT ON TABLE public.club_posts IS
  'Feed central: posts de clubes (noticias, promos, torneos). Visible para todos los jugadores autenticados.';

-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE public.jugador_amigos (
  jugador_app_id_1  UUID        NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  jugador_app_id_2  UUID        NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  confirmado        BOOLEAN     NOT NULL DEFAULT false,
  vinculado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Garantizar que no hay duplicados (A→B es lo mismo que B→A)
  CONSTRAINT amigos_diferente CHECK (jugador_app_id_1 < jugador_app_id_2),
  PRIMARY KEY (jugador_app_id_1, jugador_app_id_2)
);

CREATE INDEX idx_amigos_1 ON public.jugador_amigos (jugador_app_id_1);
CREATE INDEX idx_amigos_2 ON public.jugador_amigos (jugador_app_id_2);

ALTER TABLE public.jugador_amigos ENABLE ROW LEVEL SECURITY;

-- Cada jugador solo ve sus amigos (donde aparece como 1 o 2)
CREATE POLICY "amigos_select_own"
  ON public.jugador_amigos FOR SELECT
  TO authenticated
  USING (
    jugador_app_id_1 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
    OR jugador_app_id_2 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

-- Cada jugador puede crear una amistad (sin confirmación)
CREATE POLICY "amigos_insert_own"
  ON public.jugador_amigos FOR INSERT
  TO authenticated
  WITH CHECK (
    jugador_app_id_1 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
    OR jugador_app_id_2 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

-- Cada jugador puede confirmar su amistad
CREATE POLICY "amigos_update_own"
  ON public.jugador_amigos FOR UPDATE
  TO authenticated
  USING (
    jugador_app_id_1 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
    OR jugador_app_id_2 IN (SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid())
  );

COMMENT ON TABLE public.jugador_amigos IS
  'Red de amigos global (cross-club). Vincula dos jugadores_app. Confirmado=false es pending, confirmado=true es mutual.';

-- ─────────────────────────────────────────────────────────────────────────

-- Trigger para actualizar updated_at en club_posts
CREATE OR REPLACE FUNCTION public.trigger_update_club_posts_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_club_posts_timestamp
BEFORE UPDATE ON public.club_posts
FOR EACH ROW
EXECUTE FUNCTION trigger_update_club_posts_timestamp();

-- ─────────────────────────────────────────────────────────────────────────

-- Permisos
GRANT SELECT ON public.club_posts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.club_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jugador_amigos TO authenticated;
