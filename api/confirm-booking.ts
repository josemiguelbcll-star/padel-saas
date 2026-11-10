import { createClient } from '@supabase/supabase-js';
import { sendBookingEmail } from './_lib/resend.js';
import { enviarPushReservaJugador } from './_lib/playerReservationNotifications.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const accessToken = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const reservaId = Number(req.body?.reserva_id);
  if (!accessToken || !Number.isSafeInteger(reservaId) || reservaId <= 0) {
    return res.status(400).json({ error: 'Sesión o reserva inválida.' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' });
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await adminClient.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: 'Sesión inválida.' });

    const { data: staff } = await adminClient
      .from('usuarios')
      .select('club_id, rol, activo')
      .eq('id', user.id)
      .maybeSingle();
    if (!staff?.activo || !['admin', 'vendedor'].includes(staff.rol)) {
      return res.status(403).json({ error: 'No tenés permiso para confirmar reservas.' });
    }

    const { data: reservation } = await adminClient
      .from('reservas')
      .select('*')
      .eq('id', reservaId)
      .maybeSingle();
    if (!reservation || Number(reservation.club_id) !== Number(staff.club_id)) {
      return res.status(404).json({ error: 'Reserva no encontrada en tu club.' });
    }
    if (reservation.club_confirmada_en) {
      return res.status(200).json({ success: true, reserva: reservation, idempotente: true });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: confirmed, error: confirmError } = await userClient.rpc('fn_confirmar_reserva_club', {
      p_reserva_id: reservaId,
    });
    if (confirmError) return res.status(409).json({ error: confirmError.message });

    await enviarPushReservaJugador(
      reservaId,
      {
        title: 'Turno confirmado por el club',
        body: 'Tu cancha ya está confirmada. ¡Te esperamos!',
        tipo: 'reserva_confirmada',
      },
      process.env.APP_URL || 'https://matchogo.vercel.app',
    );

    try {
      await sendBookingEmail(reservaId);
    } catch (emailError) {
      console.error('[confirm-booking] No se pudo enviar el correo al jugador:', emailError);
    }

    return res.status(200).json({ success: true, reserva: confirmed });
  } catch (error) {
    console.error('[confirm-booking] Error inesperado:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Error inesperado.' });
  }
}