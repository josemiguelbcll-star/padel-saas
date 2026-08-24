/**
 * Hook React para push notifications (MatchGo / Capacitor).
 *
 * Uso típico — en el componente raíz (App o SessionProvider):
 *
 *   const { token, permiso } = usePushNotifications({
 *     onTap: (action) => {
 *       const data = action.notification.data as PushPayload;
 *       if (data.tipo === 'desafio_recibido') navigate(`/desafios/${data.desafio_id}`);
 *     },
 *   });
 *
 * El hook es NO-OP en browser (Capacitor.isNativePlatform() === false).
 * Llama a `initPush` una sola vez por sesión (idempotente en el servicio).
 * Al desmontar NO llama a unregisterPush (el logout lo hace explícitamente).
 */

import { useEffect, useState } from 'react';
import { initPush, getDeviceToken, type PushHandlers } from '@/lib/pushNotifications';
import { supabase } from '@/lib/supabase';

// ─── Constantes ───────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = 'BPcUEWDTGeJFQ71eF9sLj6YIsGepeXsuRnsV21A_pTms45IxDufteq7fXV2-VFODCAU0_E805X508sHSNlRxtNQ';

// Helper para convertir la clave pública VAPID (base64 URL-safe) a Uint8Array
function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PermisoEstado = 'desconocido' | 'concedido' | 'denegado';

export interface UsePushNotificationsOptions extends PushHandlers {
  /** Si false, no inicializa (útil para diferir hasta que el usuario esté logueado) */
  enabled?: boolean;
}

export interface UsePushNotificationsResult {
  /** Token FCM/APNs del dispositivo, null hasta que se obtiene o si fue denegado */
  token: string | null;
  /** Estado del permiso de notificaciones */
  permiso: PermisoEstado;
  /** true si el dispositivo es nativo (iOS o Android) */
  esNativo: boolean;
  /** true si la suscripción Web Push está activa en este navegador */
  webPushActivo: boolean;
  /** Solicita permiso y genera la suscripción Web Push para guardarla en Supabase */
  solicitarPermisoWebPush: (userId: string) => Promise<boolean>;
  /** Da de baja la suscripción Web Push del navegador y la elimina de Supabase */
  desactivarWebPush: (userId: string) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Inicializa las push notifications y expone el token y estado del permiso.
 *
 * @param options  Handlers de eventos + flag `enabled` (default true)
 */
export function usePushNotifications(
  options: UsePushNotificationsOptions = {},
): UsePushNotificationsResult {
  const { enabled = true, onToken, onError, onForeground, onTap } = options;

  const [token, setToken] = useState<string | null>(getDeviceToken);
  const [permiso, setPermiso] = useState<PermisoEstado>('desconocido');
  const [esNativo, setEsNativo] = useState(false);
  const [webPushActivo, setWebPushActivo] = useState(false);

  useEffect(() => {
    // Detectar plataforma de forma lazy (evita importar Capacitor en SSR/test)
    let native = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Capacitor } = require('@capacitor/core') as typeof import('@capacitor/core');
      native = Capacitor.isNativePlatform();
    } catch {
      native = false;
    }
    setEsNativo(native);

    if (!enabled) return;

    if (native) {
      let cancelled = false;

      initPush({
        onToken: (t) => {
          if (cancelled) return;
          setToken(t);
          setPermiso('concedido');
          onToken?.(t);
        },
        onError: (err) => {
          if (cancelled) return;
          setPermiso('denegado');
          onError?.(err);
        },
        onForeground,
        onTap,
      }).catch((err) => {
        if (!cancelled) {
          console.error('[usePush] initPush rechazó:', err);
          setPermiso('denegado');
        }
      });

      return () => {
        cancelled = true;
      };
    } else {
      // Si estamos en la Web/PWA, verificar si ya hay suscripción activa
      if ('serviceWorker' in navigator && 'Notification' in window) {
        setPermiso(Notification.permission as PermisoEstado);

        navigator.serviceWorker.ready.then((registration) => {
          registration.pushManager.getSubscription().then((subscription) => {
            setWebPushActivo(!!subscription);
          }).catch((err) => {
            console.error('[WebPush] Error al obtener suscripción existente:', err);
          });
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, esNativo]);

  // Solicitar permiso e inscribir suscripción en la base de datos
  const solicitarPermisoWebPush = async (userId: string): Promise<boolean> => {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.warn('[WebPush] Notificaciones no soportadas en este navegador.');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermiso(permission as PermisoEstado);
      if (permission !== 'granted') {
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      
      // Suscribirse al servicio Push del navegador
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) as any
      });

      // Extraer claves criptográficas públicas y de autenticación
      const p256dhRaw = subscription.getKey('p256dh');
      const authRaw = subscription.getKey('auth');

      if (!p256dhRaw || !authRaw) {
        throw new Error('No se pudieron obtener las llaves de suscripción del navegador.');
      }

      // Convertir claves a Base64 estándar para guardarlas como strings
      const keys_p256dh = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(p256dhRaw))));
      const keys_auth = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(authRaw))));

      // Guardar en Supabase (upsert basado en la clave primaria 'endpoint')
      const { error } = await supabase
        .from('user_pwa_subscriptions')
        .upsert({
          endpoint: subscription.endpoint,
          user_id: userId,
          keys_auth,
          keys_p256dh
        });

      if (error) {
        throw error;
      }

      console.info('[WebPush] Suscripción PWA guardada con éxito.');
      setWebPushActivo(true);
      return true;
    } catch (err) {
      console.error('[WebPush] Error al suscribirse a notificaciones Web Push:', err);
      return false;
    }
  };

  // Dar de baja la suscripción
  const desactivarWebPush = async (userId: string): Promise<void> => {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // 1. Borrar de Supabase
        const { error } = await supabase
          .from('user_pwa_subscriptions')
          .delete()
          .match({ endpoint: subscription.endpoint, user_id: userId });

        if (error) {
          console.warn('[WebPush] No se pudo borrar la suscripción de la base de datos:', error.message);
        }

        // 2. Dar de baja en el PushManager del navegador
        const success = await subscription.unsubscribe();
        console.info('[WebPush] Suscripción del navegador cancelada:', success);
      }

      setWebPushActivo(false);
    } catch (err) {
      console.error('[WebPush] Error al desactivar notificaciones Web Push:', err);
    }
  };

  return {
    token,
    permiso,
    esNativo,
    webPushActivo,
    solicitarPermisoWebPush,
    desactivarWebPush
  };
}

