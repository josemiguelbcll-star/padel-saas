import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const query = `
    SELECT 
      p.proname, 
      pg_get_functiondef(p.oid) as definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname IN ('fn_aplicar_modo_torneo', 'fn_eliminar_bloqueo_torneo')
  `;
  
  const { data, error } = await supabase.rpc('fn_execute_sql', { query });
  if (error) {
    console.error('Error executing query:', error);
  } else {
    for (const row of data || []) {
      console.log(`=== FUNCTION: ${row.proname} ===`);
      console.log(row.definition);
      console.log('\n');
    }
  }
}
run();
