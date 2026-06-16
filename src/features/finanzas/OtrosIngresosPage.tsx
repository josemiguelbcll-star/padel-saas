import { useMemo, useState } from 'react';
import { ArrowLeft, Calendar, Clock, Loader2, Plus, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { Button } from '@/components/ui/button';
import { NuevoOtroIngresoDialog } from './NuevoOtroIngresoDialog';
import { OtrosIngresosList } from './OtrosIngresosList';
import { useOtrosIngresos } from './hooks/useOtrosIngresos';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const mesActualFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
});

/**
 * Pantalla de Otros Ingresos — auspicios, membresías y cualquier
 * ingreso que NO pase por reservas, mostrador o clases.
 *
 * Los ingresos operativos no se duplican acá: viven en sus tablas
 * originales (reservas, ventas, clase_cobros) y se agregan al EERR
 * desde el resumen financiero.
 */
export function OtrosIngresosPage() {
  const { user } = useSession();
  const canEdit = getPermiso(user, 'finanzas', 'editar');

  const query = useOtrosIngresos();
  const [open, setOpen] = useState(false);

  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth();
  const mesLabel = mesActualFmt.format(ahora);

  const { totalMes, totalPendiente, cantMes } = useMemo(() => {
    const items = query.data ?? [];
    let totalMes = 0;
    let totalPendiente = 0;
    let cantMes = 0;
    for (const i of items) {
      const fecha = new Date(i.fecha + 'T00:00:00');
      if (fecha.getFullYear() === anioActual && fecha.getMonth() === mesActual) {
        totalMes += Number(i.monto);
        cantMes++;
      }
      if (i.fecha_cobro === null) {
        totalPendiente += Number(i.monto);
      }
    }
    return { totalMes, totalPendiente, cantMes };
  }, [query.data, anioActual, mesActual]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6 md:py-8">
      <header className="space-y-3">
        <Link
          to="/finanzas"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Volver al resumen financiero
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ingresos · no operativos
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
              Otros ingresos
            </h1>
            <p className="text-sm text-muted-foreground">
              Auspicios, membresías y cualquier ingreso que no pase por
              reservas, mostrador o clases. Si lo cobrás en efectivo,
              entra a la caja del día.
            </p>
          </div>
          {canEdit && (
            <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
              <Plus className="h-4 w-4" />
              Registrar ingreso
            </Button>
          )}
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          label={`Total ${mesLabel}`}
          monto={totalMes}
          subtitle={`${cantMes} ${cantMes === 1 ? 'registro' : 'registros'} con fecha en el mes`}
          icon={TrendingUp}
          variant="positive"
        />
        <KpiCard
          label="Pendientes de cobro"
          monto={totalPendiente}
          subtitle="De todos los períodos · aún sin fecha de cobro"
          icon={Clock}
          variant="warn"
        />
        <KpiCard
          label="Promedio diario del mes"
          monto={totalMes / Math.max(ahora.getDate(), 1)}
          subtitle={`Sobre los ${ahora.getDate()} días transcurridos`}
          icon={Calendar}
          variant="neutral"
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            Historial reciente
          </h2>
          {query.data && (
            <p className="text-xs text-muted-foreground">
              {query.data.length} {query.data.length === 1 ? 'registro' : 'registros'} en total
            </p>
          )}
        </div>

        {query.isLoading && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Cargando ingresos…
          </div>
        )}

        {query.error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {query.error.message}
          </div>
        )}

        {query.data && <OtrosIngresosList ingresos={query.data} />}
      </section>

      <NuevoOtroIngresoDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function KpiCard({
  label,
  monto,
  subtitle,
  icon: Icon,
  variant,
}: {
  label: string;
  monto: number;
  subtitle: string;
  icon: LucideIcon;
  variant: 'positive' | 'warn' | 'neutral';
}) {
  const color =
    variant === 'positive'
      ? 'hsl(var(--estado-pagada))'
      : variant === 'warn'
        ? 'hsl(var(--estado-senada))'
        : 'hsl(var(--muted-foreground))';
  const bg =
    variant === 'positive'
      ? 'hsl(var(--estado-pagada) / 0.10)'
      : variant === 'warn'
        ? 'hsl(var(--estado-senada) / 0.10)'
        : 'hsl(var(--muted) / 0.5)';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-md"
          style={{ backgroundColor: bg, color }}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
        {currencyFmt.format(monto)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}
