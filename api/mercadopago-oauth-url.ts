import { createClient } from '@supabase/supabase-js';

// Vercel serverless function (Node.js runtime)
export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { club_id, origin } = req.body;

  if (!club_id || !origin) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: club_id, origin' });
  }

  try {
    const clientId = process.env.MP_CLIENT_ID;
    if (!clientId) {
      console.error('[mercadopago-oauth-url] Falta MP_CLIENT_ID');
      return res.status(500).json({ error: 'El servidor no tiene configurada la aplicación de Mercado Pago (MP_CLIENT_ID)' });
    }

    const protocol = req.headers.host.includes('localhost') ? 'http' : 'https';
    const redirectUri = `${protocol}://${req.headers.host}/api/mercadopago-oauth`;

    // Codificamos club_id y origin en base64 para el state
    const state = Buffer.from(JSON.stringify({ club_id, origin })).toString('base64');

    const authUrl = `https://auth.mercadopago.com/authorization?client_id=${clientId}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    return res.status(200).json({ url: authUrl });
  } catch (error: any) {
    console.error('[mercadopago-oauth-url] Error:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado del servidor' });
  }
}
