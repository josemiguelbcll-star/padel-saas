-- ============================================================================
-- MIGRACIÓN 0083: POSTS TEMPORALES + UPLOAD DE IMÁGENES
--
-- INSTRUCCIONES:
-- 1. Abre: https://supabase.com/dashboard
-- 2. Selecciona tu proyecto
-- 3. SQL Editor → Nueva query
-- 4. Copia TODO el contenido de este archivo
-- 5. Pega en el editor
-- 6. Click RUN
-- 7. ¡Listo! ✅
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- PARTE 1: AGREGAR COLUMNAS
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS expira_en TIMESTAMP WITH TIME ZONE;
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS badge VARCHAR(50);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_texto VARCHAR(100);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_link VARCHAR(500);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS vistas INT DEFAULT 0;
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS reacciones INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_club_posts_activos_expira
  ON club_posts(activo, expira_en DESC)
  WHERE activo = TRUE;

-- ───────────────────────────────────────────────────────────────────────────
-- PARTE 2: FUNCIÓN PARA CREAR POSTS CON IMAGEN
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_crear_post_con_imagen(
  p_club_id BIGINT,
  p_titulo VARCHAR,
  p_contenido TEXT,
  p_tipo VARCHAR,
  p_imagen_url VARCHAR DEFAULT NULL,
  p_badge VARCHAR DEFAULT NULL,
  p_cta_texto VARCHAR DEFAULT NULL,
  p_cta_link VARCHAR DEFAULT NULL,
  p_duracion_horas INT DEFAULT 24
)
RETURNS TABLE (
  id BIGINT,
  club_id BIGINT,
  titulo VARCHAR,
  expira_en TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_usuario_id UUID;
  v_es_admin BOOLEAN;
  v_expira_en TIMESTAMP WITH TIME ZONE;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM usuarios
    WHERE id = v_usuario_id
      AND club_id = p_club_id
      AND rol IN ('admin', 'super_admin')
  ) INTO v_es_admin;

  IF NOT v_es_admin THEN
    RAISE EXCEPTION 'No eres admin de este club';
  END IF;

  v_expira_en := NOW() + (p_duracion_horas || ' hours')::INTERVAL;

  INSERT INTO club_posts (
    club_id, usuario_id, titulo, contenido, tipo,
    imagen_url, badge, cta_texto, cta_link,
    activo, creado_en, expira_en
  ) VALUES (
    p_club_id, v_usuario_id, p_titulo, p_contenido, p_tipo,
    p_imagen_url, p_badge, p_cta_texto, p_cta_link,
    TRUE, NOW(), v_expira_en
  )
  RETURNING club_posts.id, club_posts.club_id, club_posts.titulo, club_posts.expira_en;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION fn_crear_post_con_imagen TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- PARTE 3: FUNCIÓN PARA "ME GUSTA"
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_dar_me_gusta_post(
  p_post_id BIGINT
)
RETURNS INT AS $$
DECLARE
  v_nuevas_reacciones INT;
BEGIN
  UPDATE club_posts
  SET reacciones = COALESCE(reacciones, 0) + 1
  WHERE id = p_post_id
  RETURNING reacciones INTO v_nuevas_reacciones;

  RETURN COALESCE(v_nuevas_reacciones, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION fn_dar_me_gusta_post TO authenticated;

-- ============================================================================
-- ✅ ¡MIGRACIÓN COMPLETA!
--
-- Ahora:
-- 1. Ve a Storage → Crea bucket "club-posts-images" (Público)
-- 2. Recarga la app: https://matchogo.vercel.app/player
-- 3. Login + Perfil tab → "CREAR NOTICIA"
-- 4. ¡A crear posts! 🚀
-- ============================================================================
