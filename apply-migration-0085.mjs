import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;

const sqlPath = './supabase/migrations/0085_usuarios_permisos.sql';
const sql = readFileSync(sqlPath, 'utf8');

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
  console.log('Connecting to Supabase...');
  await client.connect();
  console.log('Connected!');

  console.log('Applying 0085 migration...');
  await client.query(sql);
  console.log('Migration applied successfully.');

  await client.end();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
