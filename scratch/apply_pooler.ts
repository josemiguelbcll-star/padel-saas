import pg from 'pg';
import { readFileSync } from 'fs';
const { Client } = pg;

const regions = [
  'aws-0-sa-east-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-west-1.pooler.supabase.com'
];

async function tryConnect() {
  for (const host of regions) {
    console.log(`Trying ${host}...`);
    const client = new Client({
      host,
      port: 6543,
      database: 'postgres',
      user: 'postgres.bpvpxjwripilymetfujz',
      password: 'ckje6ZnZFGyGSPm3',
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      console.log(`Connected to ${host}!`);
      
      console.log('Applying 0115_optimizar_indices_disponibilidad.sql...');
      const sql0115 = readFileSync('./supabase/migrations/0115_optimizar_indices_disponibilidad.sql', 'utf8');
      await client.query(sql0115);
      console.log('0115 applied successfully!');
      
      await client.end();
      return;
    } catch (e) {
      console.log(`Failed on ${host}:`, e.message);
      try { await client.end(); } catch {}
    }
  }
}

tryConnect().catch(console.error);
