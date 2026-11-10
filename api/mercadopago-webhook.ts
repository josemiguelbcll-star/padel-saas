import { createClient } from '@supabase/supabase-js';
import { verificarYRegistrarPagoMercadoPago } from './_lib/processMercadoPagoPayment.js';

const env = (globalThis as typeof globalThis & {
  process: { env: Record<string, string | undefined> };
}).process.env;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const paymentId = String(req.body?.data?.id ?? req.query?.id ?? req.query?.['data.id'] ?? '');
  const clubId = Number(req.query?.club_id ?? req.body?.club_id);
  if (!paymentId || !Number.isSafeInteger(clubId) || clubId <= 0) {
    return res.status(400).json({ error: 'Falta el identificador de pago o club.' });
  }

  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: config, error: configError } = await supabase
      .from('club_mercadopago_config')
      .select('access_token')
      .eq('club_id', clubId)
      .single();
    if (configError || !config?.access_token) {
      return res.status(404).json({ error: 'No se encontró la integración de Mercado Pago del club.' });
    }

    const paymentResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `Bearer ${config.access_token}` } },
    );
    if (!paymentResponse.ok) {
      return res.status(502).json({ error: 'No se pudo consultar el pago en Mercado Pago.' });
    }

    const payment = await paymentResponse.json() as { status: string; external_reference?: string };
    if (payment.status !== 'approved') {
      return res.status(200).json({ received: true, status: payment.status });
    }
    const reservaId = Number(payment.external_reference);
    if (!Number.isSafeInteger(reservaId) || reservaId <= 0) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const { data: reserva } = await supabase
      .from('reservas')
      .select('id')
      .eq('id', reservaId)
      .eq('club_id', clubId)
      .maybeSingle();
    if (!reserva) return res.status(200).json({ received: true, ignored: true });

    const result = await verificarYRegistrarPagoMercadoPago(
      reservaId,
      paymentId,
      env.APP_URL || 'https://matchogo.vercel.app',
    );
    return res.status(200).json({ received: true, ...result });
  } catch (error) {
    console.error('[mercadopago-webhook] Error procesando el pago:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Error inesperado.' });
  }
}