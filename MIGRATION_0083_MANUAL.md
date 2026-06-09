# 🔧 Migración 0083 — Posts Temporales (Instrucciones Manuales)

## Pasos a seguir en Supabase Dashboard

### 1. Agregar columnas a `club_posts`

Ve a: **Supabase Dashboard > SQL Editor > Nueva query**

```sql
-- Agregar columnas de temporalidad
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS expira_en TIMESTAMP WITH TIME ZONE;
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS badge VARCHAR(50);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_texto VARCHAR(100);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_link VARCHAR(500);
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS vistas INT DEFAULT 0;
ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS reacciones INT DEFAULT 0; -- Contador de "me gusta"

-- Crear índice para queries rápidas
CREATE INDEX IF NOT EXISTS idx_club_posts_activos_expira
  ON club_posts(activo, expira_en DESC)
  WHERE activo = TRUE;
```

**Ejecutar ✓**

---

### 2. Crear funciones RPC

En el mismo SQL Editor:

```sql
-- Función para crear post con imagen
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

GRANT EXECUTE ON FUNCTION fn_crear_post_con_imagen TO authenticated;
```

**Ejecutar ✓**

---

### 3. Crear función para "me gusta"

```sql
-- Función para dar "me gusta" a un post
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
```

**Ejecutar ✓**

---

### 4. Crear bucket de Storage

Ve a: **Supabase Dashboard > Storage > Crear nuevo bucket**

- **Nombre**: `club-posts-images`
- **Privacidad**: Public (para que se vean las imágenes)
- **Crear ✓**

---

### 5. Configurar RLS para Storage

En **Policies** del bucket `club-posts-images`:

**Policy 1: Lectura pública**
```sql
SELECT (true);
```
Aplicar a: `(storage.objects.bucket_id = 'club-posts-images')`

**Policy 2: Escritura solo admins**
```sql
SELECT (auth.uid() IS NOT NULL) 
  AND EXISTS(
    SELECT 1 FROM usuarios
    WHERE id = auth.uid()
      AND rol IN ('admin', 'super_admin')
  );
```
Aplicar a: INSERT/UPDATE

---

## ✅ Verificación

Después de completar todos los pasos:

```sql
-- Verificar columnas
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'club_posts' 
ORDER BY ordinal_position;

-- Verificar funciones
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('fn_crear_post_con_imagen', 'fn_dar_me_gusta_post');
```

---

## 📱 Frontend: Listo para usar

Los siguientes componentes/hooks están listos:
- ✅ `AdminPanelV2.tsx` — Upload de imágenes + opciones
- ✅ `FeedCentralV2.tsx` — Display con countdown
- ✅ `useAdminPanelV2.ts` — Lógica de upload + RPC

**No hay que modificar nada más en el código.**

---

## 🚀 Próximos pasos

Una vez aplicada la migración:
1. Subir a Vercel (o ejecutar `npm run build`)
2. Probar: Admin crea post con imagen → debería aparecer en feed con countdown
3. Verificar: Posts expiran automáticamente después de 24/48/72h
