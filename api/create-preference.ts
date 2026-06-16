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

  const { reserva_id, club_id, origin_url } = req.body;

  if (!reserva_id || !club_id || !origin_url) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: reserva_id, club_id, origin_url' });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[create-preference] Faltan env vars de Supabase');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Obtener detalles de la reserva y cancha
    const { data: reserva, error: reservaError } = await supabase
      .from('reservas')
      .select('id, club_id, monto_sena, estado, canchas(nombre)')
      .eq('id', Number(reserva_id))
      .single();

    if (reservaError || !reserva) {
      console.error('[create-preference] Reserva no encontrada:', reservaError);
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (Number(reserva.club_id) !== Number(club_id)) {
      return res.status(400).json({ error: 'El club de la reserva no coincide con el solicitado' });
    }

    if (reserva.estado !== 'pendiente') {
      return res.status(400).json({ error: `La reserva está en estado '${reserva.estado}' y no se puede señar` });
    }

    // 2. Obtener credenciales de Mercado Pago del club
    const { data: mpConfig, error: mpError } = await supabase
      .from('club_mercadopago_config')
      .select('access_token')
      .eq('club_id', Number(club_id))
      .single();

    if (mpError || !mpConfig?.access_token) {
      console.error('[create-preference] Mercado Pago no configurado para este club:', mpError);
      return res.status(400).json({ error: 'Este club no tiene configurado Mercado Pago para recibir señas' });
    }

    // 3. Obtener nombre del club
    const { data: club } = await supabase
      .from('clubes')
      .select('nombre')
      .eq('id', Number(club_id))
      .single();

    const clubNombre = club?.nombre || 'Club';
    const canchaNombre = (reserva as any).canchas?.nombre || '';
    const itemTitle = `Seña Reserva - ${clubNombre}${canchaNombre ? ` (Cancha: ${canchaNombre})` : ''}`;

    // 4. Crear preferencia en Mercado Pago
    const mpResponse = await fetch('https://api.mercadopago.com/v1/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpConfig.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [
          {
            id: reserva_id.toString(),
            title: itemTitle,
            quantity: 1,
            unit_price: Number(reserva.monto_sena),
            currency_id: 'ARS',
          }
        ],
        external_reference: reserva_id.toString(),
        back_urls: {
          success: `${origin_url}/player/partidos?payment_status=approved&reserva_id=${reserva_id}`,
          failure: `${origin_url}/player/partidos?payment_status=rejected&reserva_id=${reserva_id}`,
          pending: `${origin_url}/player/partidos?payment_status=pending&reserva_id=${reserva_id}`,
        },
        auto_return: 'approved',
      }),
    });

    if (!mpResponse.ok) {
      const errorText = await mpResponse.text();
      console.error('[create-preference] Error creando preferencia en Mercado Pago:', errorText);
      return res.status(500).json({ error: 'Error al comunicarse con Mercado Pago' });
    }

    const mpData = await mpResponse.json();
    return res.status(200).json({
      preference_id: mpData.id,
      init_point: mpData.init_point,
    });
  } catch (error: any) {
    console.error('[create-preference] Error inesperado:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado del servidor' });
  }
}
