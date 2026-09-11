/**
 * Servicio Integral de Notificaciones de MatchGo.
 * 
 * Funcionalidades:
 * 1. Inicializa y configura canales de notificación en Android/iOS (Capacitor Local Notifications + Push).
 * 2. Solicita permisos de notificación al usuario de forma proactiva.
 * 3. Escucha en tiempo real (Supabase Realtime) las notificaciones dirigidas al jugador.
 * 4. Al recibir una notificación en tiempo real, dispara una alerta nativa en la barra de Android (LocalNotification) con sonido y vibración.
 * 5. Provee helpers unificados para enviar notificaciones de partidos, solicitudes, amigos y desafíos.
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type ActionPerformed as LocalActionPerformed } from '@capacitor/local-notifications';
import { PushNotifications, type Token } from '@capacitor/push-notifications';
import { supabase } from '@/lib/supabase';

// ─── Tipos de Notificaciones ──────────────────────────────────────────────────

export type TipoNotificacionJugador =
  | 'invitacion_partido'
  | 'invitacion_aceptada'
  | 'invitacion_rechazada'
  | 'solicitud_unirse'
  | 'solicitud_aceptada'
  | 'solicitud_rechazada'
  | 'solicitud_amigo'
  | 'amistad_aceptada'
  | 'desafio_recibido'
  | 'desafio_aceptado'
  | 'desafio_rechazado'
  | 'reserva_confirmada'
  | 'recordatorio_turno'
  | 'noticia_club'
  | 'test'
  | 'general';

export interface EnviarNotificacionParams {
  jugadorAppId: string;
  authUserId?: string | null;
  titulo: string;
  mensaje: string;
  tipo: TipoNotificacionJugador;
  metadata?: Record<string, any>;
  link?: string;
}

// ─── Estado interno ───────────────────────────────────────────────────────────

let realtimeChannelSub: any = null;
let currentJugadorAppId: string | null = null;
let isInitialized = false;

// ─── Inicialización y Permisos ────────────────────────────────────────────────

/**
 * Configura canales y permisos para notificaciones locales y push en Android/iOS.
 */
export async function initNotificationsService(authUserId?: string, jugadorAppId?: string): Promise<boolean> {
  if (jugadorAppId) {
    currentJugadorAppId = jugadorAppId;
  }

  // 1. Configurar canales y permisos nativos en móvil
  if (Capacitor.isNativePlatform()) {
    try {
      // Crear canal de notificación de alta importancia en Android
      await LocalNotifications.createChannel({
        id: 'matchgo-alerts',
        name: 'Alertas MatchGo',
        description: 'Notificaciones de partidos, invitaciones, amigos y desafíos',
        importance: 5, // MAX importance (heads-up banner)
        visibility: 1, // PUBLIC on lock screen
        vibration: true,
        sound: undefined, // default sound
      }).catch(e => console.warn('[Notifications] createChannel warning:', e));

      // Solicitar permisos de notificación local
      const localPerm = await LocalNotifications.checkPermissions();
      if (localPerm.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }

      // Solicitar permisos de push
      const pushPerm = await PushNotifications.checkPermissions().catch(() => null);
      if (!pushPerm || pushPerm.receive !== 'granted') {
        await PushNotifications.requestPermissions().catch(() => null);
      }

      // Registrar dispositivo para FCM push
      await PushNotifications.register().catch(e => console.warn('[Push] register fallback:', e));

      // Listener para click en notificación local
      await LocalNotifications.addListener('localNotificationActionPerformed', (action: LocalActionPerformed) => {
        console.info('[LocalNotification] Acción tocada:', action.notification.title);
        // Si hay una URL o ruta en extra, podemos redirigir
        const extra = action.notification.extra;
        if (extra?.link) {
          window.location.href = extra.link;
        }
      }).catch(() => {});

      // Listener para token FCM
      await PushNotifications.addListener('registration', async (token: Token) => {
        console.info('[Push] Token FCM recibido:', token.value.slice(0, 15) + '…');
        if (authUserId && jugadorAppId) {
          await sincronizarTokenDispositivo(jugadorAppId, authUserId, token.value, 'android');
        }
      }).catch(() => {});

    } catch (err) {
      console.warn('[Notifications] Error configurando notificaciones nativas:', err);
    }
  }

  // 2. Conectar listener de Realtime si tenemos el ID del jugador
  if (jugadorAppId && (!isInitialized || currentJugadorAppId !== jugadorAppId)) {
    conectarRealtimeNotificaciones(jugadorAppId);
  }

  isInitialized = true;
  return true;
}

/**
 * Sincroniza el token FCM con la base de datos o almacenamiento.
 */
async function sincronizarTokenDispositivo(
  jugadorAppId: string,
  authUserId: string,
  token: string,
  platform: 'android' | 'ios' | 'web'
) {
  try {
    // Guardar token localmente
    localStorage.setItem('matchgo_device_token', token);

    // Si existe la tabla de tokens, upsert
    await supabase.from('jugador_device_tokens').upsert({
      jugador_app_id: jugadorAppId,
      auth_user_id: authUserId,
      token,
      platform,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'jugador_app_id,token' });
  } catch (err) {
    console.warn('[Notifications] No se pudo sincronizar token:', err);
  }
}

/**
 * Escucha notificaciones en tiempo real vía Supabase Realtime y genera
 * la notificación nativa en Android/iOS de inmediato.
 */
export function conectarRealtimeNotificaciones(jugadorAppId: string) {
  if (realtimeChannelSub) {
    void supabase.removeChannel(realtimeChannelSub);
    realtimeChannelSub = null;
  }

  currentJugadorAppId = jugadorAppId;

  const channelName = `notif-realtime-${jugadorAppId.slice(0, 8)}-${Math.random().toString(36).substring(2, 7)}`;
  realtimeChannelSub = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: `jugador_app_id=eq.${jugadorAppId}`,
      },
      async (payload) => {
        const notif = payload.new as any;
        if (!notif) return;

        console.info('[Realtime Notification] Nueva notificación recibida:', notif.titulo);

        // Disparar notificación nativa en el celular
        if (Capacitor.isNativePlatform()) {
          try {
            await LocalNotifications.schedule({
              notifications: [
                {
                  id: typeof notif.id === 'number' ? notif.id : Math.floor(Math.random() * 100000),
                  title: notif.titulo || 'MatchGo',
                  body: notif.mensaje || 'Nueva notificación',
                  schedule: { at: new Date(Date.now() + 50) },
                  channelId: 'matchgo-alerts',
                  smallIcon: 'ic_stat_matchgo',
                  iconColor: '#0B1F4D',
                  largeIcon: 'ic_launcher',
                  extra: {
                    id: notif.id,
                    tipo: notif.tipo,
                    metadata: notif.metadata,
                    link: notif.link || '/player',
                  },
                },
              ],
            });
          } catch (err) {
            console.warn('[LocalNotification] Error al disparar notificación nativa:', err);
          }
        }
      }
    )
    .subscribe();
}

// ─── Helpers de Disparo de Notificaciones ────────────────────────────────────

/**
 * Crea una notificación en la base de datos y despacha web push / native push.
 */
export async function notificarJugador(params: EnviarNotificacionParams): Promise<boolean> {
  try {
    // 1. Guardar en base de datos (tabla notificaciones)
    const { data: notifRow, error: dbError } = await supabase
      .from('notificaciones')
      .insert({
        jugador_app_id: params.jugadorAppId,
        titulo: params.titulo,
        mensaje: params.mensaje,
        tipo: params.tipo,
        metadata: params.metadata || {},
        link: params.link || '/player',
        leido: false,
      })
      .select()
      .single();

    if (dbError) {
      console.warn('[Notifications] Error al insertar en tabla notificaciones:', dbError);
    }

    // 2. Intentar WebPush si tenemos authUserId
    let targetUserId = params.authUserId;
    if (!targetUserId && params.jugadorAppId) {
      // Buscar auth_user_id del jugador
      const { data: targetPlayer } = await supabase
        .from('jugadores_app')
        .select('auth_user_id')
        .eq('id', params.jugadorAppId)
        .maybeSingle();
      if (targetPlayer?.auth_user_id) {
        targetUserId = targetPlayer.auth_user_id;
      }
    }

    if (targetUserId) {
      // Llamar a send-pwa-push
      void fetch('/api/send-pwa-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: targetUserId,
          title: params.titulo,
          body: params.mensaje,
          url: params.link || '/player',
          data: {
            tipo: params.tipo,
            metadata: params.metadata,
            notifId: notifRow?.id,
          },
        }),
      }).catch(() => {});
    }

    return true;
  } catch (err) {
    console.error('[Notifications] Error general en notificarJugador:', err);
    return false;
  }
}

// ─── Helpers Específicos por Evento de Jugador ─────────────────────────────────

/**
 * 1. Invitación a Partido (Tengo cancha / Buscar jugadores)
 */
export async function notificarInvitacionPartido(params: {
  amigoJugadorId: string;
  organizadorNombre: string;
  clubNombre?: string;
  canchaNombre?: string;
  fecha?: string;
  hora?: string;
  partidoId: number;
  participanteId?: number;
}) {
  const detalleLugar = [params.clubNombre, params.canchaNombre].filter(Boolean).join(' - ');
  const detalleFecha = [params.fecha, params.hora].filter(Boolean).join(' ');
  const complemento = [detalleLugar, detalleFecha].filter(Boolean).join(' · ');

  return notificarJugador({
    jugadorAppId: params.amigoJugadorId,
    titulo: '🎾 Invitación a partido',
    mensaje: `${params.organizadorNombre} te invitó a jugar un partido${complemento ? ` (${complemento})` : ''}.`,
    tipo: 'invitacion_partido',
    metadata: {
      partido_id: params.partidoId,
      participante_id: params.participanteId,
      organizador_nombre: params.organizadorNombre,
      club_nombre: params.clubNombre,
      fecha: params.fecha,
      hora: params.hora,
    },
    link: '/player?tab=jugar',
  });
}

/**
 * 2. Solicitud de un Jugador para unirse a un Partido Abierto
 */
export async function notificarSolicitudUnirse(params: {
  organizadorJugadorId: string;
  solicitanteNombre: string;
  clubNombre?: string;
  fecha?: string;
  hora?: string;
  partidoId: number;
  participanteId?: number;
}) {
  return notificarJugador({
    jugadorAppId: params.organizadorJugadorId,
    titulo: '🙋 Solicitud para tu partido',
    mensaje: `${params.solicitanteNombre} quiere sumarse a tu partido${params.clubNombre ? ` en ${params.clubNombre}` : ''}.`,
    tipo: 'solicitud_unirse',
    metadata: {
      partido_id: params.partidoId,
      participante_id: params.participanteId,
      solicitante_nombre: params.solicitanteNombre,
      fecha: params.fecha,
      hora: params.hora,
    },
    link: '/player?tab=jugar',
  });
}

/**
 * 3. Respuesta a Solicitud de Unión o Invitación
 */
export async function notificarRespuestaPartido(params: {
  jugadorDestinoId: string;
  emisorNombre: string;
  clubNombre?: string;
  fecha?: string;
  hora?: string;
  aceptado: boolean;
  esSolicitudUnirse?: boolean;
}) {
  const titulo = params.aceptado
    ? params.esSolicitudUnirse
      ? '✅ ¡Te aceptaron en el partido!'
      : '🎾 ¡Invitación aceptada!'
    : 'ℹ️ Partido no confirmado';

  const mensaje = params.aceptado
    ? params.esSolicitudUnirse
      ? `${params.emisorNombre} aceptó tu solicitud para jugar${params.clubNombre ? ` en ${params.clubNombre}` : ''}. ¡A jugar!`
      : `${params.emisorNombre} aceptó tu invitación y se sumó al partido.`
    : `${params.emisorNombre} no pudo unirse al partido en este momento.`;

  return notificarJugador({
    jugadorAppId: params.jugadorDestinoId,
    titulo,
    mensaje,
    tipo: params.aceptado ? 'solicitud_aceptada' : 'solicitud_rechazada',
    metadata: {
      emisor_nombre: params.emisorNombre,
      club_nombre: params.clubNombre,
      fecha: params.fecha,
      hora: params.hora,
      aceptado: params.aceptado,
    },
    link: '/player?tab=jugar',
  });
}

/**
 * 4. Solicitud de Amistad
 */
export async function notificarSolicitudAmigo(params: {
  amigoDestinoId: string;
  remitenteNombre: string;
  remitenteAlias?: string | null;
}) {
  const nombre = params.remitenteAlias ? `@${params.remitenteAlias}` : params.remitenteNombre;
  return notificarJugador({
    jugadorAppId: params.amigoDestinoId,
    titulo: '🤝 ¡Nueva solicitud de amistad!',
    mensaje: `${nombre} quiere agregarte como amigo en MatchGo.`,
    tipo: 'solicitud_amigo',
    metadata: {
      remitente_nombre: params.remitenteNombre,
      remitente_alias: params.remitenteAlias,
    },
    link: '/player?tab=perfil',
  });
}

/**
 * 5. Solicitud de Amistad Aceptada
 */
export async function notificarAmistadAceptada(params: {
  amigoDestinoId: string;
  amigoNombre: string;
}) {
  return notificarJugador({
    jugadorAppId: params.amigoDestinoId,
    titulo: '🎉 ¡Amistad aceptada!',
    mensaje: `${params.amigoNombre} aceptó tu solicitud de amistad. ¡Ya pueden desafiarse y jugar juntos!`,
    tipo: 'amistad_aceptada',
    metadata: {
      amigo_nombre: params.amigoNombre,
    },
    link: '/player?tab=perfil',
  });
}

/**
 * 6. Desafío Recibido
 */
export async function notificarDesafioRecibido(params: {
  rivalJugadorId: string;
  retadorNombre: string;
  clubNombre: string;
  fecha: string;
  hora: string;
  desafioId: number;
}) {
  return notificarJugador({
    jugadorAppId: params.rivalJugadorId,
    titulo: '⚔️ ¡Nuevo Desafío!',
    mensaje: `${params.retadorNombre} te desafió a un partido en ${params.clubNombre} el ${params.fecha} a las ${params.hora}.`,
    tipo: 'desafio_recibido',
    metadata: {
      desafio_id: params.desafioId,
      retador_nombre: params.retadorNombre,
      club_nombre: params.clubNombre,
      fecha: params.fecha,
      hora: params.hora,
    },
    link: '/player?tab=perfil',
  });
}

/**
 * 7. Desafío Aceptado / Rechazado
 */
export async function notificarRespuestaDesafio(params: {
  retadorJugadorId: string;
  rivalNombre: string;
  clubNombre: string;
  fecha: string;
  hora: string;
  aceptado: boolean;
  desafioId: number;
}) {
  const titulo = params.aceptado ? '🔥 ¡Desafío aceptado!' : 'ℹ️ Desafío rechazado';
  const mensaje = params.aceptado
    ? `${params.rivalNombre} aceptó tu desafío en ${params.clubNombre} para el ${params.fecha} ${params.hora}. ¡Prepárense para el partido!`
    : `${params.rivalNombre} no pudo aceptar el desafío en este momento.`;

  return notificarJugador({
    jugadorAppId: params.retadorJugadorId,
    titulo,
    mensaje,
    tipo: params.aceptado ? 'desafio_aceptado' : 'desafio_rechazado',
    metadata: {
      desafio_id: params.desafioId,
      rival_nombre: params.rivalNombre,
      club_nombre: params.clubNombre,
      fecha: params.fecha,
      hora: params.hora,
      aceptado: params.aceptado,
    },
    link: '/player?tab=perfil',
  });
}

/**
 * 8. Notificación de Prueba para verificar el funcionamiento en el celular
 */
export async function dispararNotificacionPrueba(jugadorAppId: string, nombreJugador: string): Promise<boolean> {
  // Disparo nativo inmediato si estamos en celular
  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 100000),
            title: '🔔 Notificación de Prueba MatchGo',
            body: `¡Hola ${nombreJugador}! Las notificaciones en tu celular están funcionando correctamente.`,
            schedule: { at: new Date(Date.now() + 100) },
            channelId: 'matchgo-alerts',
            smallIcon: 'ic_stat_matchgo',
            iconColor: '#0B1F4D',
            largeIcon: 'ic_launcher',
            extra: { tipo: 'test' },
          },
        ],
      });
    } catch (e) {
      console.warn('[Test Notification] Error disparando localmente:', e);
    }
  }

  // Guardar además en la base de datos para que aparezca en la bandeja
  return notificarJugador({
    jugadorAppId,
    titulo: '🔔 Notificación de Prueba',
    mensaje: `¡Hola ${nombreJugador}! Tu sistema de notificaciones está 100% activo y configurado.`,
    tipo: 'test',
    metadata: { timestamp: new Date().toISOString() },
    link: '/player',
  });
}

/**
 * 9. Notificar Noticias y Promociones del Club a todos los jugadores
 */
export async function notificarNoticiaClub(params: {
  clubId: number;
  clubNombre: string;
  titulo: string;
  descripcion?: string;
  tipo?: 'promo' | 'noticia' | 'torneo';
  noticiaId?: number;
  imagenUrl?: string;
}): Promise<boolean> {
  try {
    const esPromo =
      params.tipo === 'promo' ||
      params.titulo.toLowerCase().includes('promo') ||
      params.titulo.toLowerCase().includes('descuento') ||
      params.titulo.toLowerCase().includes('2x1') ||
      params.titulo.toLowerCase().includes('oferta');

    const icono = esPromo ? '🔥' : '📢';
    const tagTipo = esPromo ? '¡Nueva Promo!' : 'Novedad';
    const tituloFinal = `${icono} ${params.clubNombre} · ${tagTipo}: ${params.titulo}`;
    const mensajeFinal =
      params.descripcion?.trim() ||
      (esPromo
        ? `Aprovechá esta promoción exclusiva en ${params.clubNombre}.`
        : `Enterate de las últimas novedades en ${params.clubNombre}.`);

    // 1. Obtener los jugadores registrados
    const { data: jugadores, error: jError } = await supabase
      .from('jugadores_app')
      .select('id, auth_user_id')
      .limit(500);

    if (jError || !jugadores || jugadores.length === 0) {
      console.warn('[Notifications] No se encontraron jugadores para notificar noticia:', jError);
      return false;
    }

    // 2. Insertar notificación para cada jugador
    const notificacionesRows = jugadores.map((j) => ({
      jugador_app_id: j.id,
      titulo: tituloFinal,
      mensaje: mensajeFinal,
      tipo: 'noticia_club',
      metadata: {
        club_id: params.clubId,
        club_nombre: params.clubNombre,
        noticia_id: params.noticiaId,
        tipo_contenido: params.tipo || (esPromo ? 'promo' : 'noticia'),
        imagen_url: params.imagenUrl,
      },
      link: '/player',
      leido: false,
    }));

    const { error: insertError } = await supabase
      .from('notificaciones')
      .insert(notificacionesRows);

    if (insertError) {
      console.warn('[Notifications] Error al insertar notificaciones de noticia:', insertError);
    }

    return true;
  } catch (err) {
    console.error('[Notifications] Error en notificarNoticiaClub:', err);
    return false;
  }
}
