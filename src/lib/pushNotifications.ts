/**
 * Servicio de Push Notifications para MatchGo (Capacitor).
 *
 * FLUJO:
 * 1. Al abrir la app, llamar a `initPush()` para registrar el dispositivo.
 * 2. `initPush()` pide permiso, obtiene el token FCM/APNs y lo guarda.
 * 3. El token se envía al backend (Supabase Edge Function) para asociarlo
 *    al jugador autenticado.
 * 4. Cuando otro jugador hace un desafío, el backend envía la push
 *    a través de FCM (Android) o APNs (iOS).
 *
 * SEGURIDAD:
 * - El token de dispositivo es anónimo hasta asociarlo al jugador.
 * - NUNCA enviar el token a un endpoint no confiable.
 * - Al desloguearse, llamar a `unregisterPush()` para desvincular.
 *
 * EN WEB (sin Capacitor):
 * - `Capacitor.isNativePlatform()` devuelve false.
 * - El servicio hace no-op silencioso — sin errores en navegador.
 * - Las notificaciones en web usarán Supabase Realtime (polling) como fallback.
 */

import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  type Token,
  type ActionPerformed,
  type PushNotificationSchema,
} from '@capacitor/push-notifications';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface PushHandlers {
  /** Se ejecuta cuando llega una notificación con la app en primer plano */
  onForeground?: (notification: PushNotificationSchema) => void;
  /** Se ejecuta cuando el usuario toca una notificación */
  onTap?: (action: ActionPerformed) => void;
  /** Se ejecuta cuando se obtiene el token del dispositivo */
  onToken?: (token: string) => void;
  /** Se ejecuta si hay un error */
  onError?: (err: unknown) => void;
}

// ─── Estado interno ───────────────────────────────────────────────────────────

let initialized = false;
let deviceToken: string | null = null;

export function getDeviceToken(): string | null {
  return deviceToken;
}

// ─── Inicialización ───────────────────────────────────────────────────────────

/**
 * Inicializar push notifications.
 * Pide permiso, registra el dispositivo y adjunta los handlers.
 * Idempotente: si ya fue inicializado, retorna inmediatamente.
 */
export async function initPush(handlers: PushHandlers = {}): Promise<void> {
  // No-op en browser o si ya está inicializado
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;
  initialized = true;

  try {
    // 1. Pedir permiso
    const { receive } = await PushNotifications.requestPermissions();
    if (receive !== 'granted') {
      console.info('[Push] Permiso denegado por el usuario');
      return;
    }

    // 2. Registrar dispositivo (genera el token FCM/APNs)
    await PushNotifications.register();

    // 3. Listeners
    await PushNotifications.addListener('registration', (token: Token) => {
      deviceToken = token.value;
      console.info('[Push] Token registrado:', token.value.slice(0, 12) + '…');
      handlers.onToken?.(token.value);
      // TODO: enviar token a Supabase Edge Function para asociarlo al jugador
      // await supabase.functions.invoke('push-register', { body: { token: token.value } });
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] Error de registro:', err);
      handlers.onError?.(err);
    });

    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      // Notificación recibida con la app ABIERTA
      console.info('[Push] Notificación en primer plano:', notification.title);
      handlers.onForeground?.(notification);
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      // El usuario tocó la notificación (app en segundo plano o cerrada)
      console.info('[Push] Notificación tocada:', action.notification.title);
      handlers.onTap?.(action);
      // Ejemplo de deep link:
      // const data = action.notification.data;
      // if (data?.tipo === 'desafio') router.push(`/desafios/${data.id}`);
    });

  } catch (err) {
    console.error('[Push] Error inesperado en initPush:', err);
    handlers.onError?.(err);
    initialized = false; // permitir reintento
  }
}

/**
 * Desregistrar push (al hacer logout).
 * Elimina los listeners y limpia el token.
 */
export async function unregisterPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await PushNotifications.removeAllListeners();
    deviceToken = null;
    initialized = false;
    // TODO: avisar al backend para desvincular el token del jugador
    // await supabase.functions.invoke('push-unregister', { body: { token: oldToken } });
  } catch (err) {
    console.error('[Push] Error al desregistrar:', err);
  }
}

// ─── Tipos de notificaciones MatchGo ─────────────────────────────────────────
// Estos son los payloads que el backend (Edge Function) debe enviar.
// El campo `data` es key-value de strings (restricción de FCM/APNs).

export type PushPayload =
  | {
      tipo: 'desafio_recibido';
      desafio_id: string;
      rival_nombre: string;  // "Diego R. + Nico F."
      circulo_nombre: string;
    }
  | {
      tipo: 'desafio_aceptado';
      desafio_id: string;
      club: string;
      fecha: string;
      hora: string;
    }
  | {
      tipo: 'resultado_a_confirmar';
      desafio_id: string;
      rival_nombre: string;
      score: string;  // "2-1"
    }
  | {
      tipo: 'solicitud_pareja';
      jugador_id: string;
      jugador_nombre: string;
    };

/**
 * Parsear el payload de una notificación recibida.
 * El backend envía `data` como strings; esta función los tipifica.
 */
export function parsePushPayload(data: Record<string, string>): PushPayload | null {
  try {
    return data as unknown as PushPayload;
  } catch {
    return null;
  }
}
