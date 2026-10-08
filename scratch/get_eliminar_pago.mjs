import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const query = `
    SELECT p.proname, pg_get_functiondef(p.oid) as definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'fn_eliminar_pago_reserva'
  `;
  const { data, error } = await supabase.rpc('fn_execute_sql', { query });
  if (error) console.error('Error:', error);
  else console.log('DATA:', JSON.stringify(data, null, 2));
}
run();
