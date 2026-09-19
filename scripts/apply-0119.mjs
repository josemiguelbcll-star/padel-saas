import pg from 'pg';
import { readFileSync } from 'fs';

const { Client } = pg;

const regions = [
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'ca-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1'
];

async function main() {
  for (const r of regions) {
    const host = `aws-0-${r}.pooler.supabase.com`;
    const client = new Client({
      host,
      port: 6543,
      database: 'postgres',
      user: 'postgres.bpvpxjwripilymetfujz',
      password: 'ckje6ZnZFGyGSPm3',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      console.log(`¡CONECTADO en región: ${r}!`);
      const sql = readFileSync('./supabase/migrations/0119_plataforma_metricas_reservas_e_impersonacion.sql', 'utf8');
      await client.query(sql);
      console.log('¡Migración 0119 aplicada exitosamente!');
      await client.end();
      return;
    } catch (e) {
      if (!e.message.includes('not found') && !e.message.includes('timeout')) {
        console.log(`${r}: ${e.message}`);
      }
      try { await client.end(); } catch (_) {}
    }
  }
  console.log('No se encontró la región.');
}

main();
