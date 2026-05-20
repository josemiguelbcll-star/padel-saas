import * as Sentry from '@sentry/react';
import { env } from './env';

/**
 * Inicializa Sentry sólo si hay DSN configurado.
 *
 * Mientras VITE_SENTRY_DSN esté vacío en .env.local, Sentry queda inerte.
 * Apenas pegues el DSN real, la próxima recarga lo activa sin tener que
 * tocar código.
 */
export function initSentry(): void {
  if (!env.VITE_SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}
