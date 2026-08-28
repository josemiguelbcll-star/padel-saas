import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config({ path: '.env.local' });

const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/`;

async function run() {
  const res = await fetch(url, {
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const data = await res.json();
  
  import('fs').then(fs => {
    fs.writeFileSync('scratch/openapi.json', JSON.stringify(data, null, 2));
    console.log('Saved OpenAPI spec.');
    
    // Search for tournament functions
    const paths = Object.keys(data.paths || {});
    console.log('Paths containing tournament/bloqueo:');
    for (const p of paths) {
      if (p.toLowerCase().includes('torneo') || p.toLowerCase().includes('bloqueo')) {
        console.log(p);
      }
    }
  });
}
run();
