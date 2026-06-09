#!/usr/bin/env node
/**
 * Script para crear usuario de prueba en Supabase
 * Requiere: VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local
 * Uso: node scripts/create-test-user.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Leer .env.local manualmente
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && !key.startsWith('#')) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

async function createTestUser() {
  const SUPABASE_URL = envVars.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ Faltan variables en .env.local:');
    console.error('   VITE_SUPABASE_URL:', SUPABASE_URL ? '✓' : '✗');
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', SERVICE_ROLE_KEY ? '✓' : '✗');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const testEmail = 'test@padel.com';
  const testPassword = 'TestPadel123!';

  console.log(`📝 Creando usuario en Supabase...`);

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });

    if (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }

    console.log('✅ Usuario creado exitosamente\n');
    console.log('📧 Email:      ' + testEmail);
    console.log('🔐 Contraseña: ' + testPassword);
    console.log('\n🎯 Usa estas credenciales en:');
    console.log('   https://matchogo.vercel.app/player\n');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createTestUser();
