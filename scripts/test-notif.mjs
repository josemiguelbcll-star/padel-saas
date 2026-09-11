import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bpvpxjwripilymetfujz.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function test() {
  const { data: jugadores } = await supabase.from('jugadores_app').select('id, nombre_display').limit(2);
  console.log('Jugadores test:', jugadores);

  if (jugadores && jugadores.length > 0) {
    const j = jugadores[0];
    const { data: inserted, error: insError } = await supabase
      .from('notificaciones')
      .insert({
        jugador_app_id: j.id,
        titulo: '🧪 Test de notificación',
        mensaje: 'Probando el sistema de notificaciones',
        tipo: 'test',
        leido: false,
        metadata: { test: true }
      })
      .select()
      .single();

    console.log('Insert test:', { inserted, insError });

    if (inserted) {
      // Clean up test row
      await supabase.from('notificaciones').delete().eq('id', inserted.id);
      console.log('Cleaned up test notification.');
    }
  }
}

test().catch(console.error);
