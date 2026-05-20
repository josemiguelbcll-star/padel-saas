import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/features/auth';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';

interface OnboardingGateProps {
  children: ReactNode;
}

/**
 * Decide qué renderizar en `/` (índice del shell) según el estado de
 * onboarding del club.
 *
 * Heurística: el club está "onboardeado" si tiene al menos una cancha.
 * Es la única condición HARD: sin canchas no hay grilla, sin grilla no
 * hay producto. Horarios y tarifas se anuncian como pendientes desde el
 * banner del Dashboard, pero no bloquean el acceso.
 *
 * - canchas pendiente + admin    → redirige al wizard.
 * - canchas pendiente + vendedor → mensaje "esperá al admin".
 * - canchas OK                    → renderiza children (Dashboard normal).
 *
 * Sólo se monta en el index route. Las demás rutas del shell
 * (/configuracion, /onboarding) son accesibles sin pasar por acá, lo
 * que permite al admin armar la config a mano sin caer en un bucle.
 */
export function OnboardingGate({ children }: OnboardingGateProps) {
  const { user } = useSession();
  const canchasQuery = useCanchas();

  if (canchasQuery.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (canchasQuery.error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {canchasQuery.error.message}
      </div>
    );
  }

  const tieneCanchas = (canchasQuery.data ?? []).length > 0;

  if (!tieneCanchas) {
    if (user?.rol === 'admin') {
      return <Navigate to="/onboarding" replace />;
    }
    return <ClubEnConfiguracionMessage />;
  }

  return <>{children}</>;
}

/**
 * Pantalla que ve un vendedor cuando entra al sistema antes de que el
 * admin haya configurado el club. Sobria, sin llamada a acción — el
 * vendedor no puede hacer nada hasta que aparezcan canchas.
 */
function ClubEnConfiguracionMessage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          El club todavía está en configuración
        </h2>
        <p className="text-sm text-muted-foreground">
          El administrador todavía no terminó de configurar el club. Cuando
          esté listo, vas a poder operar normalmente.
        </p>
      </div>
    </div>
  );
}
