import { verificarYRegistrarPagoMercadoPago } from './_lib/processMercadoPagoPayment.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { reserva_id, payment_id } = req.body ?? {};
  if (!reserva_id || !payment_id) {
    return res.status(400).json({ error: 'Faltan reserva_id o payment_id.' });
  }

  try {
    const result = await verificarYRegistrarPagoMercadoPago(
      Number(reserva_id),
      String(payment_id),
      process.env.APP_URL || 'https://matchogo.vercel.app',
    );
    return res.status(result.success ? 200 : 202).json(result);
  } catch (error) {
    console.error('[confirm-payment] Error al verificar pago:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Error inesperado.' });
  }
}