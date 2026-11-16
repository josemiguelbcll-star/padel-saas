import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const query = `
    SELECT 'function' AS kind, p.proname AS name, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname IN ('fn_crear_reserva', 'trg_fn_reserva_pagos_default_desglose')
    UNION ALL
    SELECT 'constraint', c.conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c WHERE c.conname = 'reserva_pagos_desglose_check'
    UNION ALL
    SELECT 'trigger', t.tgname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t WHERE t.tgrelid = 'public.reserva_pagos'::regclass AND NOT t.tgisinternal
    UNION ALL
    SELECT 'column', column_name, COALESCE(column_default,'<no default>') || ' | nullable=' || is_nullable
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reserva_pagos'
    ORDER BY 1, 2
  `;

  const { data, error } = await supabase.rpc('fn_execute_sql', { query });
  if (error) {
    console.error('Error executing query:', error);
  } else {
    for (const row of data || []) {
      console.log(`=== ${row.kind}: ${row.name} ===`);
      console.log(row.def);
      console.log('\n');
    }
  }
}
run();
