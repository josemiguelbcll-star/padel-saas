#!/usr/bin/env node
/**
 * Script para crear usuario de prueba en Supabase
 * Uso: node scripts/create-test-user.js
 */

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

async function createTestUser() {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ Faltan variables: VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
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

  console.log(`📝 Creando usuario: ${testEmail}`);

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true, // Confirma el email automáticamente
    });

    if (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }

    console.log('✅ Usuario creado exitosamente');
    console.log(`📧 Email: ${testEmail}`);
    console.log(`🔐 Contraseña: ${testPassword}`);
    console.log(`\n🎯 Usa estas credenciales en: https://matchogo.vercel.app/player`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createTestUser();
