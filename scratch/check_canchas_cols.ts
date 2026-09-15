import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabase = createClient(url, serviceKey);

async function checkCanchasColumns() {
  const { data } = await supabase.from('canchas').select('*').limit(1);
  console.log('Columnas de canchas:', Object.keys(data?.[0] || {}));
  console.log('Sample row:', data?.[0]);
}

checkCanchasColumns().catch(console.error);
