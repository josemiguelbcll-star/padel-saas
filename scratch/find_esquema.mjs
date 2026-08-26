import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('fn_execute_sql', {
    query: `SELECT proname, prosrc FROM pg_proc WHERE prosrc ILIKE '%esquema%' OR prosrc ILIKE '%obligatorio%'`
  });
  if (error) {
    console.error(error);
  } else {
    console.log(data);
  }
}
run();
