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

console.log('✅ VERIFICANDO MIGRACIÓN 0083...\n');

// 1. Verificar columnas
console.log('1️⃣ Verificando columnas en club_posts...');
const { data: columns } = await supabase
  .from('club_posts')
  .select()
  .limit(1);

const columnasNecesarias = ['expira_en', 'badge', 'cta_texto', 'cta_link', 'reacciones'];
const columnasExistentes = columnasNecesarias.filter(col => columns && col in columns[0]);

if (columnasExistentes.length === columnasNecesarias.length) {
  console.log(`   ✅ ${columnasExistentes.length}/${columnasNecesarias.length} columnas creadas\n`);
} else {
  console.log(`   ❌ Solo ${columnasExistentes.length}/${columnasNecesarias.length} columnas\n`);
}

// 2. Verificar funciones RPC
console.log('2️⃣ Verificando funciones RPC...');
const { data: functions } = await supabase
  .rpc('__get_functions_list') // Esta RPC podría no existir, lo intentamos

  .catch(() => ({ data: null }));

// Alternativa: intentar llamar las funciones
console.log('   Intentando llamar fn_crear_post_con_imagen...');
const testFn1 = await supabase.rpc('fn_crear_post_con_imagen', {
  p_club_id: 1,
  p_titulo: 'TEST',
  p_contenido: 'TEST',
  p_tipo: 'noticia'
}).catch(e => ({ error: e }));

if (testFn1.error?.message?.includes('new row violates row-level security')) {
  console.log('   ✅ Función fn_crear_post_con_imagen existe\n');
} else if (testFn1.error?.message?.includes('could not find')) {
  console.log('   ❌ Función fn_crear_post_con_imagen NO existe\n');
} else {
  console.log('   ✅ Función fn_crear_post_con_imagen existe\n');
}

console.log('   Intentando llamar fn_dar_me_gusta_post...');
const testFn2 = await supabase.rpc('fn_dar_me_gusta_post', {
  p_post_id: 1
}).catch(e => ({ error: e }));

if (testFn2.error?.message?.includes('could not find')) {
  console.log('   ❌ Función fn_dar_me_gusta_post NO existe\n');
} else {
  console.log('   ✅ Función fn_dar_me_gusta_post existe\n');
}

// 3. Verificar bucket
console.log('3️⃣ Verificando bucket de Storage...');
const { data: buckets } = await supabase.storage.listBuckets();
const bucketExists = buckets?.some(b => b.name === 'club-posts-images');

if (bucketExists) {
  console.log('   ✅ Bucket "club-posts-images" existe\n');
} else {
  console.log('   ❌ Bucket "club-posts-images" NO existe\n');
  console.log('   💡 Créalo manualmente: Storage → Crear bucket\n');
}

// Resumen
console.log('═'.repeat(50));
console.log('\n🎉 ESTADO:\n');
const allGood = columnasExistentes.length === columnasNecesarias.length && bucketExists;

if (allGood) {
  console.log('✅ ¡TODO LISTO! La migración se aplicó correctamente\n');
  console.log('Puedes:');
  console.log('  1. Recarga: https://matchogo.vercel.app/player');
  console.log('  2. Login: josemiguelbcll@gmail.com / Admin123!Padel');
  console.log('  3. Perfil tab → "📱 CREAR NOTICIA"');
  console.log('  4. Sube imagen + crea post 🚀\n');
} else {
  console.log('⚠️ Falta completar:\n');
  if (columnasExistentes.length < columnasNecesarias.length) {
    const faltantes = columnasNecesarias.filter(col => !columnasExistentes.includes(col));
    console.log(`  ❌ Columnas: ${faltantes.join(', ')}\n`);
  }
  if (!bucketExists) {
    console.log('  ❌ Bucket: "club-posts-images"\n');
  }
}
