import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;

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

  console.log('Aplicando 0113_fix_midnight_tsrange_turnos_fijos_y_reservas.sql...');
  const sql0113 = readFileSync('./supabase/migrations/0113_fix_midnight_tsrange_turnos_fijos_y_reservas.sql', 'utf8');
  await client.query(sql0113);
  console.log('0113 aplicada con éxito.');

  console.log('Aplicando 0114_fix_clubes_publicos_ciudad_default.sql...');
  const sql0114 = readFileSync('./supabase/migrations/0114_fix_clubes_publicos_ciudad_default.sql', 'utf8');
  await client.query(sql0114);
  console.log('0114 aplicada con éxito.');

  await client.end();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
