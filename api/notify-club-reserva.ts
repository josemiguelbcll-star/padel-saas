import { createClient } from '@supabase/supabase-js';
import { notificarClubPorReserva, type EventoNotificacionClub } from './_lib/reservaNotifications.js';

const EVENTOS: EventoNotificacionClub[] = ['pre_reserva', 'pago_mp_acreditado', 'pago_mp_tardio', 'turno_confirmado'];

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const accessToken = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const reservaId = Number(req.body?.reserva_id);
  const evento = req.body?.evento as EventoNotificacionClub;
  if (!accessToken || !Number.isSafeInteger(reservaId) || reservaId <= 0 || !EVENTOS.includes(evento)) {
    return res.status(400).json({ error: 'Sesión, reserva o evento inválido.' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Configuración del servidor incompleta.' });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return res.status(401).json({ error: 'Sesión inválida.' });

    const { data: reserva } = await supabase
      .from('reservas')
      .select('id, club_id, jugador_app_id')
      .eq('id', reservaId)
      .maybeSingle();
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada.' });

    const [{ data: jugadorApp }, { data: staff }] = await Promise.all([
      supabase.from('jugadores_app').select('id').eq('auth_user_id', user.id).maybeSingle(),
      supabase.from('usuarios').select('club_id, activo').eq('id', user.id).maybeSingle(),
    ]);

    const esJugador = Boolean(jugadorApp && jugadorApp.id === reserva.jugador_app_id);
    const esStaff = Boolean(staff?.activo && Number(staff.club_id) === Number(reserva.club_id));
    if (!esJugador && !esStaff) {
      return res.status(403).json({ error: 'No tenés permiso para notificar esta reserva.' });
    }

    await notificarClubPorReserva(
      reservaId,
      evento,
      process.env.APP_URL || 'https://matchogo.vercel.app',
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[notify-club-reserva] Error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Error inesperado.' });
  }
}
