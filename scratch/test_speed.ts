import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabaseAdmin = createClient(url, serviceKey);

async function checkIndexes() {
  const { data, error } = await supabaseAdmin.rpc('fn_disponibilidad_publica', {
    p_club_slug: 'mi-club',
    p_fecha: '2026-09-16'
  });
  console.log('Test call to fn_disponibilidad_publica took MS... result count:', data?.length);
}

checkIndexes().catch(console.error);
