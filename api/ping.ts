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

  // Permitimos GET y POST para flexibilidad del pinger externo
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[ping] Faltan env vars de Supabase');
      return res.status(500).json({ error: 'Configuración del servidor incompleta (faltan env vars de Supabase)' });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const start = performance.now();

    // Consulta ultraliviana para despertar la BD y mantener PostgREST caliente.
    const { data, error } = await supabase
      .from('jugadores_app')
      .select('id')
      .limit(1);

    const duration = Math.round(performance.now() - start);

    if (error) {
      console.error('[ping] Error al consultar Supabase:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
        durationMs: duration
      });
    }

    return res.status(200).json({
      success: true,
      status: 'online',
      message: 'Supabase keep-alive ping exitoso',
      durationMs: duration,
      hasData: (data && data.length > 0)
    });
  } catch (error: any) {
    console.error('[ping] Error inesperado:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error inesperado del servidor'
    });
  }
}
