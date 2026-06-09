#!/usr/bin/env node
/**
 * Script para aplicar migraciones a Supabase directamente
 * Uso: node scripts/apply-migrations.js
 */

const fs = require('fs');
const path = require('path');

async function applyMigrations() {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    console.error('❌ Faltan variables de entorno: VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const migrations = [
    '0080_feed_central_amigos.sql',
    '0081_desafios.sql',
    '0082_promociones.sql',
  ];

  for (const migrationFile of migrations) {
    const filePath = path.join(__dirname, '..', 'supabase', 'migrations', migrationFile);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  Archivo no encontrado: ${filePath}`);
      continue;
    }

    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`\n▶ Aplicando ${migrationFile}...`);

    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
          'apikey': SUPABASE_SERVICE_ROLE,
        },
        body: JSON.stringify({ sql }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error(`❌ Error en ${migrationFile}:`, error);
        continue;
      }

      console.log(`✓ ${migrationFile} aplicada correctamente`);
    } catch (err) {
      console.error(`❌ Error ejecutando ${migrationFile}:`, err.message);
    }
  }

  console.log('\n✓ Proceso completado');
}

applyMigrations();
