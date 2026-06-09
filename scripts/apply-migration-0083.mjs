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

const migrationPath = './supabase/migrations/0083_club_posts_ephemeral.sql';
const sql = fs.readFileSync(migrationPath, 'utf-8');

console.log('📝 Aplicando migración 0083...\n');

try {
  const { data, error } = await supabase.rpc('execute_sql', { sql_string: sql });
  
  if (error) {
    console.error('❌ Error en migración:', error.message);
    // Intentar aplicar cada statement por separado
    console.log('\n⚠️  Intentando aplicar statements individuales...\n');
    const statements = sql.split(';').filter(s => s.trim() && !s.trim().startsWith('--'));
    
    for (const statement of statements) {
      if (!statement.trim()) continue;
      try {
        console.log(`Ejecutando: ${statement.slice(0, 60)}...`);
        const { error: stmtError } = await supabase.rpc('execute_sql', { sql_string: statement + ';' });
        if (stmtError) {
          console.warn(`  ⚠️  ${stmtError.message}`);
        } else {
          console.log(`  ✓ OK`);
        }
      } catch (e) {
        console.warn(`  ⚠️  Error: ${e.message}`);
      }
    }
  } else {
    console.log('✅ Migración 0083 aplicada correctamente');
  }
} catch (err) {
  console.error('❌ Error:', err.message);
}
