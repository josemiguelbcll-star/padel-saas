import { createClient } from '@supabase/supabase-js';
import { sendBookingEmail } from './_lib/resend';

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

  const { reserva_id, payment_id } = req.body;

  if (!reserva_id || !payment_id) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: reserva_id, payment_id' });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('[confirm-payment] Faltan env vars de Supabase');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Obtener detalles de la reserva
    const { data: reserva, error: reservaError } = await supabase
      .from('reservas')
      .select('id, club_id, monto_sena, estado, monto_pagado')
      .eq('id', Number(reserva_id))
      .single();

    if (reservaError || !reserva) {
      console.error('[confirm-payment] Reserva no encontrada:', reservaError);
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    // Si la reserva ya fue señada o pagada, retornar éxito directamente (idempotencia)
    if (reserva.estado === 'senada' || reserva.estado === 'pagada') {
      return res.status(200).json({ success: true, message: 'La reserva ya se encuentra confirmada o señada' });
    }

    // 2. Obtener credenciales de Mercado Pago del club
    const { data: mpConfig, error: mpError } = await supabase
      .from('club_mercadopago_config')
      .select('access_token')
      .eq('club_id', Number(reserva.club_id))
      .single();

    if (mpError || !mpConfig?.access_token) {
      console.error('[confirm-payment] Mercado Pago no configurado para este club:', mpError);
      return res.status(400).json({ error: 'Este club no tiene configurado Mercado Pago' });
    }

    // 3. Consultar estado del pago en Mercado Pago
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${mpConfig.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!mpResponse.ok) {
      const errorText = await mpResponse.text();
      console.error('[confirm-payment] Error consultando pago en Mercado Pago:', errorText);
      return res.status(500).json({ 
        error: 'Error al comunicarse con Mercado Pago', 
        details: errorText 
      });
    }

    const paymentData = await mpResponse.json();

    // 4. Validar el pago
    const isApproved = paymentData.status === 'approved';
    const matchesRef = paymentData.external_reference === reserva_id.toString();
    const matchesAmount = Number(paymentData.transaction_amount) >= Number(reserva.monto_sena);

    if (!isApproved) {
      return res.status(400).json({ error: `El pago no está aprobado (estado: ${paymentData.status})` });
    }

    if (!matchesRef) {
      return res.status(400).json({ error: 'La referencia externa del pago no coincide con esta reserva' });
    }

    // 5. Actualizar reserva a estado "senada" y registrar monto pagado
    const { data: updatedReserva, error: updateError } = await supabase
      .from('reservas')
      .update({
        estado: 'senada',
        monto_pagado: Number(reserva.monto_sena),
        observaciones: `Seña pagada automáticamente vía Mercado Pago (Pago ID: ${payment_id})`,
      })
      .eq('id', Number(reserva_id))
      .select()
      .single();

    if (updateError) {
      console.error('[confirm-payment] Error al actualizar la reserva:', updateError);
      return res.status(500).json({ error: 'No se pudo actualizar la reserva en la base de datos' });
    }

    // 6. Enviar confirmación por email (de forma segura, sin bloquear la respuesta si falla)
    try {
      await sendBookingEmail(Number(reserva_id));
    } catch (emailErr) {
      console.error('[confirm-payment] Error al enviar email de confirmación:', emailErr);
    }

    return res.status(200).json({
      success: true,
      reserva: updatedReserva,
    });
  } catch (error: any) {
    console.error('[confirm-payment] Error inesperado:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado del servidor' });
  }
}
