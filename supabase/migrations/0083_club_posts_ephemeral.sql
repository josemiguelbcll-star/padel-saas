-- 0083: Posts temporales (ephemeral) con auto-delete
-- Agregar campos para posts con expiración automática
-- Trigger para limpiar posts expirados

-- 1. Alterar tabla club_posts con nuevos campos
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS expira_en TIMESTAMP WITH TIME ZONE;
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS badge VARCHAR(50); -- "URGENTE 🔥", "LIMITED 24h"
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_texto VARCHAR(100);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_link VARCHAR(500);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS vistas INT DEFAULT 0;
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS reacciones INT DEFAULT 0; -- Solo contador de "me gusta"

-- 2. Índice para queries de posts activos ordenados por expiración
CREATE INDEX IF NOT EXISTS idx_club_posts_activos_expira
  ON club_posts(activo, expira_en DESC)
  WHERE activo = TRUE;

-- 3. Función para limpiar posts expirados
CREATE OR REPLACE FUNCTION fn_limpiar_posts_expirados()
RETURNS VOID AS $$
BEGIN
  -- Marcar como inactivos los posts que ya expiraron
  UPDATE club_posts
  SET activo = FALSE
  WHERE activo = TRUE
    AND expira_en IS NOT NULL
    AND expira_en < NOW();
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger: ejecutar cada vez que se inserta/actualiza un post
CREATE OR REPLACE TRIGGER trigger_limpiar_posts_expirados
  BEFORE INSERT OR UPDATE ON club_posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_limpiar_posts_expirados();

-- 5. Bucket de Storage para imágenes de posts (si no existe)
-- Nota: Los buckets se crean via Supabase Dashboard, pero documentamos aquí
-- Para crear vía SQL (requiere extensión pgsql_http o hacerlo desde app):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('club-posts-images', 'club-posts-images', true);

-- 6. RLS para Storage: club-posts-images
-- Los admins del club pueden subir, todos pueden leer
-- Nota: Configurar en Supabase Dashboard o via SDK

-- 7. Función RPC para crear post con imagen
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
  -- Obtener usuario actual
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Verificar que sea admin del club
  SELECT EXISTS(
    SELECT 1 FROM usuarios
    WHERE id = v_usuario_id
      AND club_id = p_club_id
      AND rol IN ('admin', 'super_admin')
  ) INTO v_es_admin;

  IF NOT v_es_admin THEN
    RAISE EXCEPTION 'No eres admin de este club';
  END IF;

  -- Calcular expiración
  v_expira_en := NOW() + (p_duracion_horas || ' hours')::INTERVAL;

  -- Insertar post
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

-- Permisos
GRANT EXECUTE ON FUNCTION fn_crear_post_con_imagen TO authenticated;

-- 8. Función para dar "me gusta" a un post
CREATE OR REPLACE FUNCTION fn_dar_me_gusta_post(
  p_post_id BIGINT
)
RETURNS INT AS $$
DECLARE
  v_nuevas_reacciones INT;
BEGIN
  -- Incrementar contador de me gusta
  UPDATE club_posts
  SET reacciones = COALESCE(reacciones, 0) + 1
  WHERE id = p_post_id
  RETURNING reacciones INTO v_nuevas_reacciones;

  RETURN COALESCE(v_nuevas_reacciones, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION fn_dar_me_gusta_post TO authenticated;

-- 9. Job de limpieza diaria (opcional, si usas pg_cron)
-- SELECT cron.schedule('limpiar-posts-expirados', '0 0 * * *', 'SELECT fn_limpiar_posts_expirados()');

COMMIT;
