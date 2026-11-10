import { createClient } from '@supabase/supabase-js';

export async function enviarPushReservaJugador(
  reservaId: number,
  payload: { title: string; body: string; tipo: 'reserva_pago_recibido' | 'reserva_confirmada' },
  baseUrl: string,
): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Configuración del servidor incompleta.');

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: reserva, error } = await supabase
    .from('reservas')
    .select('jugador_app_id, club_id')
    .eq('id', reservaId)
    .single();
  if (error || !reserva?.jugador_app_id) return;

  const { data: jugador } = await supabase
    .from('jugadores_app')
    .select('auth_user_id')
    .eq('id', reserva.jugador_app_id)
    .maybeSingle();
  if (!jugador?.auth_user_id) return;

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/send-pwa-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: jugador.auth_user_id,
        title: payload.title,
        body: payload.body,
        url: '/player/partidos',
        data: { tipo: payload.tipo, reserva_id: reservaId, club_id: reserva.club_id },
      }),
    });
    if (!response.ok) console.warn('[playerReservationNotifications] Push rechazado:', response.status);
  } catch (pushError) {
    console.warn('[playerReservationNotifications] Error al enviar push:', pushError);
  }
}