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

console.log('🔍 Testeando la query del FeedCentral...\n');

// Simular la query exacta de useClubPosts
const { data, error } = await supabase
  .from('club_posts')
  .select(`
    id, club_id, usuario_id, titulo, contenido, tipo,
    imagen_url, vigente_desde, vigente_hasta, creado_en,
    clubes(nombre)
  `)
  .eq('activo', true)
  .order('creado_en', { ascending: false })
  .limit(50);

if (error) {
  console.error('❌ Error en query:', error.message);
  process.exit(1);
}

console.log(`✅ Query exitosa - ${data.length} posts encontrados\n`);

if (data.length === 0) {
  console.log('⚠️  ADVERTENCIA: No hay posts en la BD');
  process.exit(1);
}

data.slice(0, 3).forEach((post, i) => {
  console.log(`📌 Post ${i + 1}:`);
  console.log(`   Tipo: ${post.tipo}`);
  console.log(`   Título: ${post.titulo}`);
  console.log(`   Club: ${post.clubes?.nombre || 'SIN CLUB'}`);
  console.log(`   Creado: ${post.creado_en}`);
  console.log();
});

console.log('✅ El FeedCentral debería estar mostrando estos posts correctamente.');
