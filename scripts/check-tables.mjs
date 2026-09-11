import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bpvpxjwripilymetfujz.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function check() {
  const { data: notifRow, error } = await supabase.from('notificaciones').select('*').order('id', { ascending: false }).limit(5);
  console.log('Last notifications:', notifRow, error);
}

check().catch(console.error);
