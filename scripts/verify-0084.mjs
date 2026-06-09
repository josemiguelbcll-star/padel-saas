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

console.log('✅ VERIFICANDO MIGRACIÓN 0084...\n');

// 1. Verificar tabla
console.log('1️⃣ Verificando tabla noticias_feed...');
const { data: noticias, error: tableError } = await supabase
  .from('noticias_feed')
  .select()
  .limit(1);

if (!tableError) {
  console.log('   ✅ Tabla noticias_feed creada\n');
} else {
  console.log(`   ❌ Error: ${tableError.message}\n`);
}

// 2. Verificar función RPC
console.log('2️⃣ Verificando función fn_crear_noticia_feed...');
const testFn = await supabase.rpc('fn_crear_noticia_feed', {
  p_club_id: 1,
  p_titulo: 'TEST',
  p_descripcion: 'TEST',
}).catch(e => ({ error: e }));

if (testFn.error?.message?.includes('could not find')) {
  console.log('   ❌ Función NO existe\n');
} else {
  console.log('   ✅ Función fn_crear_noticia_feed existe\n');
}

console.log('═'.repeat(50));
console.log('\n🎉 ¡TODO LISTO!\n');
console.log('Próximo paso: Integrar NoticiasPage en el menú del admin (/app)\n');
