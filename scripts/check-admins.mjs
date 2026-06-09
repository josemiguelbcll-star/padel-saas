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

console.log('🔍 Verificando usuarios admin...\n');

const { data, error } = await supabase
  .from('usuarios')
  .select('id, email, rol, club_id, clubes(nombre)')
  .in('rol', ['admin', 'super_admin']);

if (error) {
  console.error('Error:', error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log('❌ No hay usuarios admin en la BD\n');
} else {
  console.log(`✅ ${data.length} usuario(s) admin encontrado(s):\n`);
  data.forEach(u => {
    console.log(`  • Email: ${u.email}`);
    console.log(`    Rol: ${u.rol}`);
    console.log(`    Club: ${u.clubes?.nombre || 'Sin club'}`);
    console.log();
  });
}

// Verificar también usuarios jugadores
console.log('---\n📊 Estadísticas de usuarios:\n');

const { data: stats } = await supabase
  .from('usuarios')
  .select('rol')
  .in('rol', ['admin', 'super_admin', 'jugador']);

const conteo = {
  admin: stats?.filter(u => u.rol === 'admin').length || 0,
  super_admin: stats?.filter(u => u.rol === 'super_admin').length || 0,
  jugador: stats?.filter(u => u.rol === 'jugador').length || 0,
};

console.log(`  Admins: ${conteo.admin}`);
console.log(`  Super admins: ${conteo.super_admin}`);
console.log(`  Jugadores: ${conteo.jugador}`);
