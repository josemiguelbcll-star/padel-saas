import { createClient } from '@supabase/supabase-js';
import { notificarClubPorReserva } from './reservaNotifications.js';
import { enviarPushReservaJugador } from './playerReservationNotifications.js';

interface PagoMercadoPago {
  id: number;
  status: string;
  external_reference: string | null;
  transaction_amount: number;
  currency_id: string;
}

interface ResultadoPago {
  reserva_id: number;
  estado: string;
  payment_id: string;
  idempotente: boolean;
}

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configuración del servidor incompleta.');
  return createClient(url, key);
}

export async function verificarYRegistrarPagoMercadoPago(
  reservaId: number,
  paymentId: string,
  baseUrl: string,
): Promise<{ success: boolean; message: string; reserva?: ResultadoPago }> {
  const supabase = getServiceClient();
  const { data: reserva, error: reservaError } = await supabase
    .from('reservas')
    .select('id, club_id, monto_sena, estado, mp_estado')
    .eq('id', reservaId)
    .single();
  if (reservaError || !reserva) throw new Error('Reserva no encontrada.');

  const { data: mpConfig, error: configError } = await supabase
    .from('club_mercadopago_config')
    .select('access_token')
    .eq('club_id', Number(reserva.club_id))
    .single();
  if (configError || !mpConfig?.access_token) {
    throw new Error('Mercado Pago no está configurado para este club.');
  }

  const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${mpConfig.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!mpResponse.ok) throw new Error('No pudimos verificar el pago con Mercado Pago.');

  const payment = await mpResponse.json() as PagoMercadoPago;
  if (payment.status !== 'approved') {
    return { success: false, message: `El pago todavía no está aprobado (${payment.status}).` };
  }
  if (payment.external_reference !== String(reservaId)) {
    throw new Error('La referencia del pago no coincide con esta reserva.');
  }
  if (payment.currency_id !== 'ARS') {
    throw new Error('La moneda del pago no coincide con ARS.');
  }
  if (Math.abs(Number(payment.transaction_amount) - Number(reserva.monto_sena)) > 0.01) {
    throw new Error('El importe aprobado no coincide con la seña configurada.');
  }

  const { data, error } = await supabase.rpc('fn_registrar_pago_mp_reserva', {
    p_reserva_id: reservaId,
    p_payment_id: String(payment.id),
    p_monto: Number(payment.transaction_amount),
  });
  if (error) throw new Error(error.message);

  const resultado = data as ResultadoPago;
  if (!resultado.idempotente) {
    await enviarPushReservaJugador(
      reservaId,
      {
        title: resultado.estado === 'pago_tardio' ? 'Pago recibido, pendiente de revisión' : 'Seña acreditada',
        body: resultado.estado === 'pago_tardio'
          ? 'El club revisará cómo resolver tu pago y la reserva.'
          : 'El club debe confirmar el turno. Te avisaremos cuando esté confirmado.',
        tipo: 'reserva_pago_recibido',
      },
      baseUrl,
    );
  }
  try {
    await notificarClubPorReserva(
      reservaId,
      resultado.estado === 'pago_tardio' ? 'pago_mp_tardio' : 'pago_mp_acreditado',
      baseUrl,
    );
  } catch (notificationError) {
    console.error('[MercadoPago] No se pudieron despachar las notificaciones del club:', notificationError);
  }

  return {
    success: true,
    message: resultado.estado === 'pago_tardio'
      ? 'El pago fue registrado y el club debe revisar la reserva.'
      : 'Seña acreditada. El club debe confirmar el turno.',
    reserva: resultado,
  };
}