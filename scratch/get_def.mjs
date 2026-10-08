import pg from 'pg';
const { Client } = pg;

const hosts = [
  'db.bpvpxjwripilymetfujz.supabase.co',
  'aws-0-us-east-1.pooler.supabase.com',
  'aws-0-us-west-1.pooler.supabase.com',
  'aws-0-sa-east-1.pooler.supabase.com',
];

async function check() {
  for (const host of hosts) {
    console.log('Testing', host);
    const client = new Client({
      host,
      port: host.startsWith('db.') ? 5432 : 6543,
      database: 'postgres',
      user: host.startsWith('db.') ? 'postgres' : 'postgres.bpvpxjwripilymetfujz',
      password: 'ckje6ZnZFGyGSPm3',
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      console.log('Connected to', host);
      const res = await client.query(`
        SELECT p.proname, pg_get_functiondef(p.oid) as definition
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'fn_eliminar_pago_reserva';
      `);
      console.log('FOUND:', res.rows[0] ? res.rows[0].definition : 'NOT FOUND');
      await client.end();
      return;
    } catch (e) {
      console.log('Failed', host, e.message);
      try { await client.end(); } catch {}
    }
  }
}

check();
