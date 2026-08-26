import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data, error } = await supabase.rpc('fn_execute_sql', {
    query: `SELECT proname, prosrc FROM pg_proc WHERE prosrc ILIKE '%nuevo esquema%' OR prosrc ILIKE '%cobro libre%'`
  });
  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }
}
run();
