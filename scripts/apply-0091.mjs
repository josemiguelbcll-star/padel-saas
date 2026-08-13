import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;

const sqlPath = './supabase/migrations/0091_resetear_datos_club.sql';
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
  console.log('Conectando a Supabase PostgreSQL...');
  await client.connect();
  console.log('¡Conectado!');

  console.log('Aplicando migración 0091_resetear_datos_club.sql...');
  await client.query(sql);
  console.log('Migración aplicada exitosamente.');

  await client.end();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
