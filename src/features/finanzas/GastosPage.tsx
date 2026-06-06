import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Clock,
  Loader2,
  Plus,
  Repeat,
  TrendingDown,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Gasto } from '@/types/database';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AnularDialog } from './AnularDialog';
import { GastosList } from './GastosList';
import { NuevoGastoDialog } from './NuevoGastoDialog';
import { RecurrentesPanel } from './RecurrentesPanel';
import { useGastos } from './hooks/useGastos';
import { useCuentasPorPagar } from './hooks/useCuentasPorPagar';
import { useAnularGasto } from './hooks/useAnulaciones';

const fechaGastoFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

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
  const cxpQuery = useCuentasPorPagar();
  const anular = useAnularGasto();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('movimientos');
  const [gastoAAnular, setGastoAAnular] = useState<Gasto | null>(null);
  const [anularError, setAnularError] = useState<string | null>(null);

  async function handleAnularConfirm(
    motivoTipo: Parameters<typeof anular.mutateAsync>[0]['motivo_tipo'],
    motivoDetalle: string | null,
  ): Promise<void> {
    if (!gastoAAnular) return;
    setAnularError(null);
    try {
      await anular.mutateAsync({
        gasto_id: gastoAAnular.id,
        motivo_tipo: motivoTipo,
        motivo_detalle: motivoDetalle,
      });
      setGastoAAnular(null);
    } catch (err) {
      setAnularError(
        err instanceof Error ? err.message : 'No pudimos anular el gasto.',
      );
    }
  }

  const ahora = new Date();
  const anioActual = ahora.getFullYear();
  const mesActual = ahora.getMonth();
  const mesLabel = mesActualFmt.format(ahora);

  const { totalMes, cantMes } = useMemo(() => {
    const gastos = gastosQuery.data ?? [];
    let totalMes = 0;
    let cantMes = 0;
    for (const g of gastos) {
      const fecha = new Date(g.fecha_gasto + 'T00:00:00');
      if (fecha.getFullYear() === anioActual && fecha.getMonth() === mesActual) {
        totalMes += Number(g.monto);
        cantMes++;
      }
    }
    return { totalMes, cantMes };
  }, [gastosQuery.data, anioActual, mesActual]);

  // Pendiente de pago = deuda REAL, derivada de las CUOTAS pendientes (misma
  // fuente que el "Total adeudado" de CxP, useCuentasPorPagar) → ambos números
  // coinciden por construcción. NO mirar gastos.fecha_pago: el gasto madre de
  // una compra a plazo nace con fecha_pago NULL aunque su cuota esté pagada.
  const { totalPendiente, cantPendiente } = useMemo(() => {
    const cuotas = cxpQuery.data ?? [];
    let totalPendiente = 0;
    for (const c of cuotas) totalPendiente += c.monto;
    return { totalPendiente, cantPendiente: cuotas.length };
  }, [cxpQuery.data]);

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
              subtitle={`${cantPendiente} cuota${cantPendiente === 1 ? '' : 's'} por pagar`}
              icon={Clock}
              variant="warn"
              to="/cxp"
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

            {gastosQuery.data && (
              <GastosList
                gastos={gastosQuery.data}
                onAnular={(g) => {
                  setAnularError(null);
                  setGastoAAnular(g);
                }}
              />
            )}
          </section>
        </div>
      )}

      {tab === 'recurrentes' && <RecurrentesPanel />}

      <NuevoGastoDialog open={open} onOpenChange={setOpen} />

      <AnularDialog
        open={gastoAAnular !== null}
        onOpenChange={(o) => {
          if (anular.isPending) return;
          if (!o) {
            setGastoAAnular(null);
            setAnularError(null);
          }
        }}
        titulo="Anular gasto"
        descripcion="El gasto deja de contar en el resultado del período. Esta acción queda registrada con su motivo. Si te equivocaste en el monto, anulá y volvé a cargarlo con el valor correcto."
        resumen={
          gastoAAnular && (
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                {gastoAAnular.categoria_nombre}
              </p>
              <p className="text-xs text-muted-foreground">
                {gastoAAnular.unidad_nombre}
                {gastoAAnular.proveedor && ` · ${gastoAAnular.proveedor}`}
              </p>
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-[11px] text-muted-foreground">
                  {fechaGastoFmt.format(
                    new Date(gastoAAnular.fecha_gasto + 'T00:00:00'),
                  )}
                </span>
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {currencyFmt.format(Number(gastoAAnular.monto))}
                </span>
              </div>
            </div>
          )
        }
        confirmLabel="Anular gasto"
        pending={anular.isPending}
        error={anularError}
        onConfirm={handleAnularConfirm}
      />
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
  to,
}: {
  label: string;
  monto: number;
  subtitle: string;
  icon: LucideIcon;
  variant: 'negative' | 'warn' | 'neutral';
  /** Si viene, la card es un link clickeable a esa ruta (cursor + hover). */
  to?: string;
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

  const contenido = (
    <>
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
      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        {subtitle}
        {to && (
          <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-foreground/60 transition-colors group-hover:text-foreground">
            Ver detalle
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </p>
    </>
  );

  const base = 'rounded-lg border border-border bg-card p-4';

  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          base,
          'group block cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/30',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
      >
        {contenido}
      </Link>
    );
  }

  return <div className={base}>{contenido}</div>;
}
