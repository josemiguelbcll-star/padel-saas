import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabaseAdmin = createClient(url, serviceKey);

async function checkAll() {
  const { data: allClubes } = await supabaseAdmin
    .from('clubes')
    .select('id, nombre, slug, ciudad, provincia, activo, estado, perfil_publico_activo');
  console.log('Todos los clubes en la BD:');
  console.table(allClubes);
}

checkAll().catch(console.error);
