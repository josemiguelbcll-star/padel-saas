-- 0076 — jugador_app_club_link: vincula el perfil del jugador a sus fichas de clubes
-- Un jugador puede estar en N clubes; cada club tiene su propia ficha (tabla jugadores).
-- Esta tabla es el puente entre el perfil cross-club y las fichas por club.

CREATE TABLE public.jugador_app_club_link (
  jugador_app_id  UUID        NOT NULL REFERENCES public.jugadores_app(id) ON DELETE CASCADE,
  club_id         BIGINT      NOT NULL REFERENCES public.clubes(id) ON DELETE CASCADE,
  jugador_club_id BIGINT      REFERENCES public.jugadores(id) ON DELETE SET NULL,
  vinculado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmado_club BOOLEAN     NOT NULL DEFAULT false,
  PRIMARY KEY (jugador_app_id, club_id)
);

CREATE INDEX idx_app_club_link_club ON public.jugador_app_club_link (club_id);

ALTER TABLE public.jugador_app_club_link ENABLE ROW LEVEL SECURITY;

-- El jugador puede ver sus propias vinculaciones
CREATE POLICY "link_select_own"
  ON public.jugador_app_club_link FOR SELECT
  TO authenticated
  USING (
    jugador_app_id IN (
      SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid()
    )
  );

-- El jugador puede crear vinculaciones para su propio perfil
CREATE POLICY "link_insert_own"
  ON public.jugador_app_club_link FOR INSERT
  TO authenticated
  WITH CHECK (
    jugador_app_id IN (
      SELECT id FROM public.jugadores_app WHERE auth_user_id = auth.uid()
    )
  );

-- Admin del club puede confirmar la vinculación (para verificación)
-- (usa current_user_rol() que ya existe en el schema)
CREATE POLICY "link_update_admin"
  ON public.jugador_app_club_link FOR UPDATE
  TO authenticated
  USING (
    club_id IN (
      SELECT club_id FROM public.usuarios
      WHERE id = auth.uid() AND rol = 'admin'
    )
  );

COMMENT ON TABLE public.jugador_app_club_link IS
  'Vincula el perfil cross-club (jugadores_app) con las fichas por club (jugadores).';
