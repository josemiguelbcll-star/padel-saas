import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const anonKey = 'sb_publishable_L2RpXVbV_ERVazrprliH8w_uvFrMeB_';
const supabase = createClient(url, anonKey);

async function testAllDates() {
  const { data: clubs } = await supabase.from('v_clubes_publicos').select('*');
  console.log(`Clubes públicos: ${clubs?.length}`);

  const fechas = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];

  for (const f of fechas) {
    console.log(`\n📅 FECHA ${f}:`);
    for (const c of clubs || []) {
      const { data: slots, error } = await supabase.rpc('fn_disponibilidad_publica', {
        p_club_slug: c.slug,
        p_fecha: f,
      });
      const libres = (slots || []).filter((s: any) => s.disponible);
      const horas = Array.from(new Set(libres.map((s: any) => s.hora_inicio.slice(0, 5)))).slice(0, 8);
      console.log(`  - ${c.nombre.padEnd(20)} (${c.slug}): ${libres.length} slots libres. Horas: ${horas.join(', ')}`);
    }
  }
}

testAllDates().catch(console.error);
