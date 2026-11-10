import { createClient } from '@supabase/supabase-js';

export type EventoNotificacionClub = 'pre_reserva' | 'pago_mp_acreditado' | 'pago_mp_tardio';

interface ReservaNotificationData {
  id: number;
  club_id: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  monto_sena: number;
  club: { nombre: string; email: string | null } | null;
  cancha: { nombre: string } | null;
  jugador: { nombre: string } | null;
}

interface ClubNotificationDelivery {
  id: number;
  usuario_id: string;
  push_enviada: boolean;
  email_enviado: boolean;
}

const copyByEvent: Record<EventoNotificacionClub, { subject: string; title: string; message: string }> = {
  pre_reserva: {
    subject: 'Nueva pre-reserva de cancha',
    title: 'Nueva pre-reserva de jugador',
    message: 'Un jugador solicitó una cancha. Revisá el pago y confirmá el turno.',
  },
  pago_mp_acreditado: {
    subject: 'Seña acreditada por Mercado Pago',
    title: 'Seña acreditada por Mercado Pago',
    message: 'La seña se acreditó. Confirmá el turno para avisarle al jugador.',
  },
  pago_mp_tardio: {
    subject: 'Pago de Mercado Pago recibido fuera de término',
    title: 'Pago MP recibido fuera de término',
    message: 'El pago llegó luego del vencimiento. Revisá la reserva antes de resolverla.',
  },
};

function formatFecha(fecha: string): string {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, day ?? 1)).toLocaleDateString('es-AR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  });
}

export async function notificarClubPorReserva(
  reservaId: number,
  evento: EventoNotificacionClub,
  baseUrl: string,
): Promise<void> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Configuración de Supabase incompleta.');

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: reservaData, error: reservaError } = await supabase
    .from('reservas')
    .select(`
      id, club_id, fecha, hora_inicio, hora_fin, monto_sena,
      club:club_id(nombre, email),
      cancha:cancha_id(nombre),
      jugador:jugador_id(nombre)
    `)
    .eq('id', reservaId)
    .single();
  if (reservaError || !reservaData) throw new Error('No se encontró la reserva para notificar.');

  const reserva = reservaData as unknown as ReservaNotificationData;
  const copy = copyByEvent[evento];
  const clubName = reserva.club?.nombre ?? 'Club';
  const body = [
    copy.message,
    `${reserva.jugador?.nombre ?? 'Jugador'} · ${reserva.cancha?.nombre ?? 'Cancha'}`,
    `${formatFecha(reserva.fecha)} · ${reserva.hora_inicio.slice(0, 5)} a ${reserva.hora_fin.slice(0, 5)}`,
    `Seña: $${Number(reserva.monto_sena).toLocaleString('es-AR')}`,
  ].join('\n');

  const { data: recipients, error: recipientsError } = await supabase
    .from('notificaciones_club')
    .select('id, usuario_id, push_enviada, email_enviado')
    .eq('club_id', reserva.club_id)
    .eq('reserva_id', reservaId)
    .eq('tipo', evento);
  if (recipientsError) throw new Error('No se pudieron consultar los destinatarios del club.');

  const deliveries = (recipients ?? []) as ClubNotificationDelivery[];
  await Promise.all(deliveries.filter((delivery) => !delivery.push_enviada).map(async (delivery) => {
    try {
      const { data: claim } = await supabase
        .from('notificaciones_club')
        .update({ push_enviada: true })
        .eq('id', delivery.id)
        .eq('push_enviada', false)
        .select('id')
        .maybeSingle();
      if (!claim) return;

      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/send-pwa-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: delivery.usuario_id,
          title: copy.title,
          body,
          url: '/app/reservas',
          data: { tipo: evento, reserva_id: reservaId },
        }),
      });
      if (!response.ok) {
        await supabase.from('notificaciones_club').update({ push_enviada: false }).eq('id', delivery.id);
        console.warn('[reservaNotifications] Push rechazado:', response.status);
      }
    } catch (error) {
      await supabase.from('notificaciones_club').update({ push_enviada: false }).eq('id', delivery.id);
      console.warn('[reservaNotifications] No se pudo enviar push:', error);
    }
  }));

  if (
    reserva.club?.email &&
    process.env.RESEND_API_KEY &&
    deliveries.some((delivery) => !delivery.email_enviado)
  ) {
    const pendingEmail = deliveries.find((delivery) => !delivery.email_enviado);
    const { data: emailClaim } = pendingEmail
      ? await supabase
          .from('notificaciones_club')
          .update({ email_enviado: true })
          .eq('id', pendingEmail.id)
          .eq('email_enviado', false)
          .select('id')
          .maybeSingle()
      : { data: null };
    if (!emailClaim) return;

    const from = process.env.RESEND_FROM_EMAIL || 'MatchGo <onboarding@resend.dev>';
    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [reserva.club.email],
          subject: `${clubName}: ${copy.subject}`,
          text: `${copy.message}\n\n${body}\n\nAbrí el panel del club para ver la reserva.`,
        }),
      });
      if (emailResponse.ok) return;
      await supabase
        .from('notificaciones_club')
        .update({ email_enviado: false })
        .eq('id', emailClaim.id);
      console.error('[reservaNotifications] Resend rechazó el correo:', await emailResponse.text());
    } catch (error) {
      await supabase
        .from('notificaciones_club')
        .update({ email_enviado: false })
        .eq('id', emailClaim.id);
      console.error('[reservaNotifications] No se pudo enviar el correo:', error);
    }
  }
}