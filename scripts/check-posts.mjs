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

const { data, error } = await supabase
  .from('club_posts')
  .select('id, titulo, tipo, activo, creado_en')
  .order('creado_en', { ascending: false });

if (error) {
  console.error('Error:', error);
} else {
  console.log('📊 Posts en la BD:\n');
  data.forEach(p => {
    console.log(`  ✓ [${p.activo ? '✓' : '✗'}] ${p.tipo.padEnd(8)} | ${p.titulo.substring(0, 40)}`);
  });
}
