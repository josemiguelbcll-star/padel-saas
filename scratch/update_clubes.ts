import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabaseAdmin = createClient(url, serviceKey);

async function fixClubes() {
  console.log('Actualizando clubes sin ciudad o sin perfil_publico_activo...');
  const { data, error } = await supabaseAdmin
    .from('clubes')
    .update({
      ciudad: 'Salta',
      provincia: 'Salta',
      perfil_publico_activo: true,
      activo: true,
    })
    .is('ciudad', null)
    .select('id, nombre, slug, ciudad, perfil_publico_activo');

  console.log('Clubes actualizados:', data, error);

  // También asegurar que los que tenían perfil_publico_activo = false se activen
  const { data: data2, error: error2 } = await supabaseAdmin
    .from('clubes')
    .update({
      perfil_publico_activo: true,
      ciudad: 'Salta',
      provincia: 'Salta',
    })
    .eq('perfil_publico_activo', false)
    .select('id, nombre, slug, ciudad, perfil_publico_activo');

  console.log('Clubes activados:', data2, error2);
}

fixClubes().catch(console.error);
