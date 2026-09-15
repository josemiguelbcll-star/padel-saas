import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const anonKey = 'sb_publishable_L2RpXVbV_ERVazrprliH8w_uvFrMeB_';

const supabaseAdmin = createClient(url, serviceKey);
const supabaseAnon = createClient(url, anonKey);

async function main() {
  console.log('=== CLUBES EN TABLA CLUBES ===');
  const { data: allClubes, error: err1 } = await supabaseAdmin
    .from('clubes')
    .select('id, nombre, slug, ciudad, activo, estado, perfil_publico_activo, hora_apertura, hora_cierre, duracion_turno_min');
  console.log('Total clubes:', allClubes?.length);
  console.log(allClubes);

  console.log('\n=== CLUBES EN VISTA V_CLUBES_PUBLICOS (ANON) ===');
  const { data: publicClubes, error: err2 } = await supabaseAnon
    .from('v_clubes_publicos')
    .select('*');
  console.log('Total publicos:', publicClubes?.length);
  console.log(publicClubes);

  console.log('\n=== CANCHAS POR CLUB ===');
  const { data: canchas } = await supabaseAdmin
    .from('canchas')
    .select('id, club_id, nombre, activa');
  console.log('Total canchas:', canchas?.length);
  console.log(canchas);

  console.log('\n=== DISPONIBILIDAD PUBLICA PARA MAÑANA (2026-09-16) ===');
  for (const c of publicClubes || []) {
    const { data: slots, error: slotErr } = await supabaseAnon.rpc('fn_disponibilidad_publica', {
      p_club_slug: c.slug,
      p_fecha: '2026-09-16',
    });
    console.log(`Club ${c.nombre} (${c.slug}):`, slots?.length ?? 0, 'slots. Error:', slotErr);
    if (slots && slots.length > 0) {
      console.log('Primeros 3 slots:', slots.slice(0, 3));
    }
  }
}

main().catch(console.error);
