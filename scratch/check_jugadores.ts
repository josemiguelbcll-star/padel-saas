import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabase = createClient(url, serviceKey);

async function checkJugadoresTable() {
  const { data: j1, error: e1 } = await supabase.from('jugadores').select('id').limit(1);
  console.log('Tabla jugadores:', j1, e1);

  const { data: j2, error: e2 } = await supabase.from('jugadores_app').select('id').limit(1);
  console.log('Tabla jugadores_app:', j2, e2);
}

checkJugadoresTable().catch(console.error);
