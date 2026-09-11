import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://bpvpxjwripilymetfujz.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function run() {
  const sql = readFileSync('./supabase/migrations/0111_player_notifications_and_tokens.sql', 'utf8');
  console.log('Aplicando 0111_player_notifications_and_tokens.sql...');
  
  // Try calling exec or postgres direct
  const { data, error } = await supabase.rpc('exec_sql', { query: sql });
  if (error) {
    console.log('rpc exec_sql error (trying direct rest or inspecting):', error);
  } else {
    console.log('Migración ejecutada con éxito:', data);
  }
}

run().catch(console.error);
