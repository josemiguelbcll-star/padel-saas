#!/usr/bin/env node
/**
 * Script para cargar posts de prueba en el feed
 * Uso: node scripts/seed-feed-data.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Leer .env.local
const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');

const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && !key.startsWith('#')) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

async function seedFeedData() {
  const SUPABASE_URL = envVars.VITE_SUPABASE_URL;
  const SERVICE_ROLE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ Faltan variables en .env.local');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Obtener el ID de un usuario admin (para los posts)
    const { data: usuarios, error: userError } = await supabase
      .from('usuarios')
      .select('id, club_id')
      .eq('rol', 'admin')
      .limit(1)
      .single();

    if (userError || !usuarios) {
      console.error('❌ No hay usuarios admins. Primero crea un admin.');
      process.exit(1);
    }

    const adminId = usuarios.id;
    const clubId = usuarios.club_id;

    console.log(`📝 Insertando posts de prueba para club_id=${clubId}, admin_id=${adminId}`);

    const postsToInsert = [
      {
        club_id: clubId,
        usuario_id: adminId,
        titulo: 'Bienvenido a MatchGo 🎾',
        contenido: 'Te damos la bienvenida a nuestra plataforma de pádel. Explora clubes, reserva canchas y conecta con otros jugadores.',
        tipo: 'noticia',
        imagen_url: null,
      },
      {
        club_id: clubId,
        usuario_id: adminId,
        titulo: '¡Oferta especial! 50% OFF en reservas matutinas 🌅',
        contenido: 'Juega entre las 8 y las 12 hs y obtén 50% de descuento en el alquiler de cancha. Válido de lunes a viernes.',
        tipo: 'promo',
        imagen_url: null,
      },
      {
        club_id: clubId,
        usuario_id: adminId,
        titulo: 'Torneo de Pádel - Inscripciones Abiertas 🏆',
        contenido: 'Ya están abiertas las inscripciones para el torneo mensual. Categorías: 1ra, 2da, 3ra y 4ta. ¡Participá!',
        tipo: 'torneo',
        imagen_url: null,
      },
      {
        club_id: clubId,
        usuario_id: adminId,
        titulo: '2x1 en bebidas - Este fin de semana 🍹',
        contenido: 'Aprovechá el fin de semana: lleva 2 bebidas y pagá 1. Válido en el bar del club.',
        tipo: 'promo',
        imagen_url: null,
      },
    ];

    const { data, error } = await supabase
      .from('club_posts')
      .insert(postsToInsert)
      .select();

    if (error) {
      console.error('❌ Error insertando posts:', error.message);
      process.exit(1);
    }

    console.log(`✅ ${data.length} posts creados exitosamente\n`);
    data.forEach(post => {
      console.log(`   📌 [${post.tipo.toUpperCase()}] ${post.titulo}`);
    });
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

seedFeedData();
