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

const email = 'josemiguelbcll@gmail.com';
const password = 'Admin123!Padel'; // Contraseña temporal

console.log('🔐 Estableciendo contraseña para admin...\n');

try {
  // Obtener el user_id del usuario
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) throw listError;

  const user = users.find(u => u.email === email);
  
  if (!user) {
    console.error(`❌ No se encontró usuario con email: ${email}`);
    process.exit(1);
  }

  // Actualizar contraseña
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    password: password,
  });

  if (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }

  console.log('✅ Contraseña establecida correctamente\n');
  console.log('📧 Email: ' + email);
  console.log('🔑 Contraseña: ' + password);
  console.log('\n💡 Puedes cambiarla en tu perfil después de login\n');
  console.log('🌐 URL: https://matchogo.vercel.app/player');

} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}
