import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Loader2,
  Plus,
  Repeat,
  TrendingDown,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GastosList } from './GastosList';
import { NuevoGastoDialog } from './NuevoGastoDialog';
import { RecurrentesPanel } from './RecurrentesPanel';
import { useGastos } from './hooks/useGastos';

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

type Tab = 'movimientos' | 'recurrentes';

/**
 * Pantalla de Gastos — dos vistas internas (tabs locales, sin nueva
 * ruta ni nuevo item de sidebar):
 *
 *   - Movimientos: lo histórico (KPIs + lista de gastos).
 *   - Recurrentes: panel de plantillas del mes (alquiler/luz/sueldos),
 *     con qué ya se cargó y qué falta.
 *
 * El resumen agregado (totales, comparativas) vive en /finanzas; acá
 * el foco es el detalle operativo: ver, registrar, y atajos de
 * recurrentes.
 */
export function GastosPage() {
  const gastosQuery = useGastos();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('movimientos');

  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth();
  const mesLabel = mesActualFmt.format(ahora);

  const { totalMes, totalPendiente, cantMes } = useMemo(() => {
    const gastos = gastosQuery.data ?? [];
    let totalMes = 0;
    let totalPendiente = 0;
    let cantMes = 0;
    for (const g of gastos) {
      const fecha = new Date(g.fecha_gasto + 'T00:00:00');
      if (fecha.getFullYear() === anioActual && fecha.getMonth() === mesActual) {
        totalMes += Number(g.monto);
        cantMes++;
      }
      if (g.fecha_pago === null) {
        totalPendiente += Number(g.monto);
      }
    }
    return { totalMes, totalPendiente, cantMes };
  }, [gastosQuery.data, anioActual, mesActual]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6 md:py-8">
      {/* Header con breadcrumb */}
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
              Egresos · gastos
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
              Gastos
            </h1>
            <p className="text-sm text-muted-foreground">
              Cargá cada salida del club y atribuila a la unidad
              correspondiente. Si pagás en efectivo, entra a la caja del día.
            </p>
          </div>
          {tab === 'movimientos' && (
            <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
              <Plus className="h-4 w-4" />
              Registrar gasto
            </Button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav
        role="tablist"
        aria-label="Vistas de gastos"
        className="flex gap-1 border-b border-border"
      >
        <TabButton
          active={tab === 'movimientos'}
          onClick={() => setTab('movimientos')}
          icon={TrendingDown}
        >
          Movimientos
        </TabButton>
        <TabButton
          active={tab === 'recurrentes'}
          onClick={() => setTab('recurrentes')}
          icon={Repeat}
        >
          Recurrentes
        </TabButton>
      </nav>

      {/* Contenido del tab */}
      {tab === 'movimientos' && (
        <div className="space-y-6">
          {/* KPI Cards */}
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <KpiCard
              label={`Total ${mesLabel}`}
              monto={totalMes}
              subtitle={`${cantMes} ${cantMes === 1 ? 'registro' : 'registros'} con fecha en el mes`}
              icon={TrendingDown}
              variant="negative"
            />
            <KpiCard
              label="Pendientes de pago"
              monto={totalPendiente}
              subtitle="De todos los períodos · aún sin fecha de pago"
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

          {/* Lista */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Historial reciente
              </h2>
              {gastosQuery.data && (
                <p className="text-xs text-muted-foreground">
                  {gastosQuery.data.length} {gastosQuery.data.length === 1 ? 'registro' : 'registros'} en total
                </p>
              )}
            </div>

            {gastosQuery.isLoading && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Cargando gastos…
              </div>
            )}

            {gastosQuery.error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {gastosQuery.error.message}
              </div>
            )}

            {gastosQuery.data && <GastosList gastos={gastosQuery.data} />}
          </section>
        </div>
      )}

      {tab === 'recurrentes' && <RecurrentesPanel />}

      <NuevoGastoDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
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
  variant: 'negative' | 'warn' | 'neutral';
}) {
  const color =
    variant === 'negative'
      ? 'hsl(var(--destructive))'
      : variant === 'warn'
        ? 'hsl(var(--estado-senada))'
        : 'hsl(var(--muted-foreground))';
  const bg =
    variant === 'negative'
      ? 'hsl(var(--destructive) / 0.10)'
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
