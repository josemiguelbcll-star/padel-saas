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
    // 1. Verificar o pedir permiso de manera segura
    let status = await PushNotifications.checkPermissions().catch(() => null);
    if (!status || status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions().catch(() => null);
    }

    if (!status || status.receive !== 'granted') {
      console.info('[Push] Permiso no concedido o no disponible');
      return;
    }

    // 2. Adjuntar listeners antes de registrar
    await PushNotifications.addListener('registration', (token: Token) => {
      deviceToken = token.value;
      console.info('[Push] Token registrado:', token.value.slice(0, 12) + '…');
      handlers.onToken?.(token.value);
    }).catch((e) => console.warn('[Push] Error al agregar listener registration:', e));

    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[Push] Error de registro (FCM no configurado o sin conexión):', err);
      handlers.onError?.(err);
    }).catch((e) => console.warn('[Push] Error al agregar listener registrationError:', e));

    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.info('[Push] Notificación en primer plano:', notification.title);
      handlers.onForeground?.(notification);
    }).catch((e) => console.warn('[Push] Error al agregar listener pushNotificationReceived:', e));

    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.info('[Push] Notificación tocada:', action.notification.title);
      handlers.onTap?.(action);
    }).catch((e) => console.warn('[Push] Error al agregar listener pushNotificationActionPerformed:', e));

    // 3. Registrar dispositivo (genera token)
    await PushNotifications.register().catch((err) => {
      console.warn('[Push] PushNotifications.register() falló de forma no fatal:', err);
    });

  } catch (err) {
    console.warn('[Push] initPush capturó error no fatal:', err);
    handlers.onError?.(err);
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
