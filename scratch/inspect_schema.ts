import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabase = createClient(url, serviceKey);

async function inspectColumns() {
  const { data: c1 } = await supabase.from('reservas').select('*').limit(1);
  console.log('Columnas de reservas:', c1 ? Object.keys(c1[0] || {}) : 'null');

  const { data: c2 } = await supabase.from('turnos_fijos').select('*').limit(1);
  console.log('Columnas de turnos_fijos:', c2 ? Object.keys(c2[0] || {}) : 'null');

  const { data: c3 } = await supabase.from('clases').select('*').limit(1);
  console.log('Columnas de clases:', c3 ? Object.keys(c3[0] || {}) : 'null');
}

inspectColumns().catch(console.error);
