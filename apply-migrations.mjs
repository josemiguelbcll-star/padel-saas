import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;

const sql0069 = readFileSync('./supabase/migrations/0069_fn_disponibilidad_publica_franjas.sql', 'utf8');
const sql0070 = readFileSync('./supabase/migrations/0070_fn_disponibilidad_bulk.sql', 'utf8');

// Try direct DB host (IPv6)
const client = new Client({
  host: 'db.bpvpxjwripilymetfujz.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'ckje6ZnZFGyGSPm3',
  ssl: { rejectUnauthorized: false },
  family: 6,
});

async function run() {
  console.log('Connecting to pooler (port 6543)...');
  await client.connect();
  console.log('Connected!');

  console.log('Applying 0069...');
  await client.query(sql0069);
  console.log('0069 done.');

  console.log('Applying 0070...');
  await client.query(sql0070);
  console.log('0070 done.');

  await client.end();
  console.log('All migrations applied successfully.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
