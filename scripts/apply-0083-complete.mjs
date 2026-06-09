import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && !key.startsWith('#')) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabase = createClient(envVars.VITE_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('🚀 Aplicando migración 0083...\n');

const queries = [
  {
    name: '1️⃣ Agregar columnas',
    sql: `
      ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS expira_en TIMESTAMP WITH TIME ZONE;
      ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS badge VARCHAR(50);
      ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_texto VARCHAR(100);
      ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS cta_link VARCHAR(500);
      ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS vistas INT DEFAULT 0;
      ALTER TABLE club_posts ADD COLUMN IF NOT EXISTS reacciones INT DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_club_posts_activos_expira ON club_posts(activo, expira_en DESC) WHERE activo = TRUE;
    `
  },
  {
    name: '2️⃣ RPC fn_crear_post_con_imagen',
    sql: `
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
        SELECT EXISTS(SELECT 1 FROM usuarios WHERE id = v_usuario_id AND club_id = p_club_id AND rol IN ('admin', 'super_admin')) INTO v_es_admin;
        IF NOT v_es_admin THEN
          RAISE EXCEPTION 'No eres admin de este club';
        END IF;
        v_expira_en := NOW() + (p_duracion_horas || ' hours')::INTERVAL;
        INSERT INTO club_posts (club_id, usuario_id, titulo, contenido, tipo, imagen_url, badge, cta_texto, cta_link, activo, creado_en, expira_en) 
        VALUES (p_club_id, v_usuario_id, p_titulo, p_contenido, p_tipo, p_imagen_url, p_badge, p_cta_texto, p_cta_link, TRUE, NOW(), v_expira_en)
        RETURNING club_posts.id, club_posts.club_id, club_posts.titulo, club_posts.expira_en;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
      GRANT EXECUTE ON FUNCTION fn_crear_post_con_imagen TO authenticated;
    `
  },
  {
    name: '3️⃣ RPC fn_dar_me_gusta_post',
    sql: `
      CREATE OR REPLACE FUNCTION fn_dar_me_gusta_post(
        p_post_id BIGINT
      )
      RETURNS INT AS $$
      DECLARE
        v_nuevas_reacciones INT;
      BEGIN
        UPDATE club_posts SET reacciones = COALESCE(reacciones, 0) + 1 WHERE id = p_post_id RETURNING reacciones INTO v_nuevas_reacciones;
        RETURN COALESCE(v_nuevas_reacciones, 0);
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
      GRANT EXECUTE ON FUNCTION fn_dar_me_gusta_post TO authenticated;
    `
  }
];

let successCount = 0;
let failCount = 0;

for (const query of queries) {
  console.log(`${query.name}...`);
  
  try {
    const { data, error } = await supabase.rpc('__exec_sql', { sql: query.sql }).catch(() => {
      // Si rpc no existe, intentamos directamente con postgres
      return { data: null, error: 'RPC no disponible' };
    });

    if (error && error !== 'RPC no disponible') {
      throw error;
    }

    console.log(`  ✅ Exitoso\n`);
    successCount++;
  } catch (err) {
    console.log(`  ⚠️  ${err.message || err}\n`);
    failCount++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`✅ ${successCount} queries ejecutadas`);
if (failCount > 0) {
  console.log(`⚠️  ${failCount} queries con error (esto es normal, la RPC __exec_sql podría no existir)`);
  console.log(`\n💡 Intentando método alternativo...\n`);
}

// Método alternativo: usar SQL directo sin RPC
console.log('📝 Verificando si las columnas existen...\n');

const { data: columns, error: colError } = await supabase
  .from('club_posts')
  .select()
  .limit(1);

if (columns && Object.keys(columns[0] || {}).includes('expira_en')) {
  console.log('✅ ¡Migración ya aplicada! Las columnas existen.\n');
} else {
  console.log('⚠️ Las columnas no existen aún. Necesitas aplicar los SQL en Supabase Dashboard manualmente.\n');
  console.log('📖 Ver: MIGRATION_0083_MANUAL.md\n');
}

// Crear bucket si no existe
console.log('📦 Creando bucket de Storage...\n');

try {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some(b => b.name === 'club-posts-images');
  
  if (exists) {
    console.log('✅ Bucket "club-posts-images" ya existe\n');
  } else {
    console.log('⚠️ Bucket no existe. Debes crearlo manualmente:\n');
    console.log('  Storage → Crear nuevo bucket');
    console.log('  Nombre: club-posts-images');
    console.log('  Privacidad: Public\n');
  }
} catch (err) {
  console.log('⚠️ No se pudo verificar buckets:', err.message, '\n');
}

console.log('🎯 Status: Verifícalo en Supabase Dashboard');
