/*
 * Bootstrap de la aplicación.
 *
 * Orden de inicialización:
 *   1. Cargar las hojas de @fontsource/inter ANTES de globals.css. Así
 *      cuando globals.css declara `--font-sans: 'Inter', …` la fuente ya
 *      está disponible y no hay flash of unstyled font.
 *   2. Importar globals.css (tokens CSS + reset Tailwind).
 *   3. Llamar a initSentry() antes de renderizar para que cualquier error
 *      durante el bootstrap quede capturado por el ErrorBoundary.
 *   4. Renderizar el árbol de providers (de afuera hacia adentro):
 *
 *        Sentry.ErrorBoundary
 *          QueryClientProvider
 *            SessionProvider
 *              BrowserRouter
 *                App
 *
 *      Razonamiento del orden:
 *      - ErrorBoundary va más afuera para atrapar errores de cualquier
 *        provider, no sólo del App.
 *      - QueryClient envuelve a SessionProvider porque queremos que el
 *        provider de sesión también pueda usar React Query en el futuro
 *        (por ahora hace fetch manual).
 *      - SessionProvider va antes de BrowserRouter porque la sesión es
 *        global a toda la app y no depende del routing.
 *      - BrowserRouter habilita useNavigate/useLocation a partir de App.
 */

import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';

import { App } from './App';
import { queryClient } from './lib/queryClient';
import { initSentry } from './lib/sentry';
import { SessionProvider } from './features/auth';

initSentry();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error(
    '[padel-saas] No se encontró el elemento #root en index.html. Revisá la plantilla.',
  );
}

const globalErrorFallback = (
  <div className="flex min-h-screen items-center justify-center bg-background p-6">
    <div className="w-full max-w-md space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm">
      <h2 className="text-base font-semibold text-destructive">Algo salió mal</h2>
      <p className="text-muted-foreground">
        La aplicación encontró un error inesperado. Refrescá la página para
        volver a intentar. Si el problema persiste, contactá al administrador.
      </p>
    </div>
  </div>
);

createRoot(rootElement).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={globalErrorFallback}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
