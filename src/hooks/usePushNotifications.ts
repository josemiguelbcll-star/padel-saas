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

    if (!enabled || !native) return;

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
      // NO llamamos unregisterPush aquí — solo el logout debe hacerlo.
    };
    // Solo re-inicializar si cambia `enabled` (handlers se capturan por closure).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { token, permiso, esNativo };
}
