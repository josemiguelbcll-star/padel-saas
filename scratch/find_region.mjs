import pg from 'pg';
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
  'ap-south-1',
];

async function findRegion() {
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
      console.log('SUCCESS! Connected to region:', r, host);
      const res = await client.query(`
        SELECT p.proname, pg_get_functiondef(p.oid) as definition
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'fn_eliminar_pago_reserva';
      `);
      console.log('FUNCTION DEF:');
      console.log(res.rows[0]?.definition || 'NOT FOUND');
      await client.end();
      return;
    } catch (e) {
      if (!e.message.includes('tenant/user') && !e.message.includes('timeout')) {
        console.log(`Region ${r}:`, e.message);
      }
      try { await client.end(); } catch {}
    }
  }
  console.log('All regions failed');
}

findRegion();
