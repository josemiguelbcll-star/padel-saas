-- 0077 — Extiende jugadores_app con los campos del perfil editable del jugador.
-- Todos opcionales (nullable) para no romper registros existentes.
-- La categoría la declara el jugador; el rating sigue siendo el valor calculado.

ALTER TABLE public.jugadores_app
  ADD COLUMN IF NOT EXISTS alias       TEXT,
  ADD COLUMN IF NOT EXISTS telefono    TEXT,
  ADD COLUMN IF NOT EXISTS genero      TEXT
    CHECK (genero IN ('masculino','femenino','no_especifica')),
  ADD COLUMN IF NOT EXISTS categoria   TEXT
    CHECK (categoria IN ('1ra','2da','3ra','4ta','5ta','6ta','7ta','8va','libre'));

COMMENT ON COLUMN public.jugadores_app.alias     IS 'Apodo visible en la app (opcional, prioridad sobre nombre_corto en la UI).';
COMMENT ON COLUMN public.jugadores_app.telefono  IS 'Celular para WhatsApp; solo compartido con clubes donde el jugador reserva.';
COMMENT ON COLUMN public.jugadores_app.genero    IS 'Género auto-declarado por el jugador.';
COMMENT ON COLUMN public.jugadores_app.categoria IS 'Categoría auto-declarada (1ra=élite, 8va=principiante). Independiente del rating calculado.';

-- ── Storage bucket para avatares ─────────────────────────────────────────────
-- Los avatares se almacenan en storage.objects bajo ruta {user_id}/avatar.jpg
-- El bucket es público para lectura (URLs sin expiración).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,   -- 5 MB máximo por archivo
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública (URLs de avatar accesibles sin auth)
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- El jugador solo puede subir/actualizar su propia carpeta ({user_id}/*)
CREATE POLICY "avatars_own_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_own_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "avatars_own_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
