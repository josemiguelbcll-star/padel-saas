import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '@/features/auth';
import { useHorariosClub } from '@/features/configuracion/hooks/useHorariosClub';
import { useTarifas } from '@/features/configuracion/hooks/useTarifas';

/**
 * Placeholder del dashboard. Se completa en el próximo sprint, cuando ya
 * existan reservas, caja y alarmas para mostrar KPIs.
 *
 * Incluye un banner para admin que recuerda lo que quedó pendiente del
 * onboarding (horarios y/o tarifas sin configurar). Si todo está en
 * orden, el banner no aparece. Para vendedor no se muestra nunca: no
 * puede modificar configuración.
 */
export function DashboardPage() {
  return (
    <div className="space-y-6">
      <SetupPendientesBanner />

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          El panel principal se va a poblar a medida que entren los módulos del
          SaaS. Por ahora alcanza con tenerlo accesible para validar el shell.
        </p>
      </div>
    </div>
  );
}

interface ItemPendiente {
  label: string;
  to: string;
}

function SetupPendientesBanner() {
  const { user } = useSession();
  const horariosQuery = useHorariosClub();
  const tarifasQuery = useTarifas();

  // Sólo admin ve el banner: el vendedor no puede actuar sobre estas
  // configuraciones, mostrárselo sería ruido.
  if (user?.rol !== 'admin') return null;

  // Mientras alguna query está cargando, no mostramos nada para evitar
  // un flash de "te falta…" que después desaparece.
  if (horariosQuery.isLoading || tarifasQuery.isLoading) return null;

  const horariosFaltantes =
    !horariosQuery.data?.hora_apertura || !horariosQuery.data?.hora_cierre;
  const tarifasFaltantes = (tarifasQuery.data?.length ?? 0) === 0;

  if (!horariosFaltantes && !tarifasFaltantes) return null;

  const pendientes: ItemPendiente[] = [];
  if (horariosFaltantes) {
    pendientes.push({
      label: 'Horarios del club',
      to: '/configuracion/horarios',
    });
  }
  if (tarifasFaltantes) {
    pendientes.push({
      label: 'Al menos una tarifa',
      to: '/configuracion/tarifas',
    });
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-foreground">
            Te falta configurar:
          </p>
          <ul className="space-y-1 text-sm">
            {pendientes.map((p) => (
              <li key={p.to}>
                <Link
                  to={p.to}
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
