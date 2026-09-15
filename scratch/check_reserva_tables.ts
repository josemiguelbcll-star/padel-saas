import { createClient } from '@supabase/supabase-js';

const url = 'https://bpvpxjwripilymetfujz.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdnB4andyaXBpbHltZXRmdWp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTI1NjgyMiwiZXhwIjoyMDk0ODMyODIyfQ.YmK7AuS5rF2iFx1b6xA1Mutxir8ATeWACV6962IRYGs';
const supabase = createClient(url, serviceKey);

async function checkPostgresTables() {
  const { data: res1, error: err1 } = await supabase.from('reserva_cobros').select('id').limit(1);
  console.log('Select reserva_cobros:', res1, err1);

  const { data: res2, error: err2 } = await supabase.from('reserva_pagos').select('id').limit(1);
  console.log('Select reserva_pagos:', res2, err2);

  const { data: res3, error: err3 } = await supabase.from('reserva_consumos').select('id').limit(1);
  console.log('Select reserva_consumos:', res3, err3);
}

checkPostgresTables().catch(console.error);
