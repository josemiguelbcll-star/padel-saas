import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PieChart,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NuevoGastoDialog } from './NuevoGastoDialog';
import { NuevoOtroIngresoDialog } from './NuevoOtroIngresoDialog';
import {
  useResumenFinanciero,
  type MovimientoReciente,
  type ResumenFinanciero,
} from './hooks/useResumenFinanciero';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const mesFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
});

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
});

function fmtFechaCorta(iso: string): string {
  return fechaCortaFmt.format(new Date(iso.length > 10 ? iso : iso + 'T00:00:00'));
}

/**
 * Hub financiero del club. Estructura mental EERR:
 *   Ingresos − Costos directos − Gastos = Resultado
 *
 * No es el EERR formal (eso vendrá con cierre de período, ajustes,
 * etc.) — es el "tablero del CFO": ver de un vistazo cómo viene el mes.
 *
 * Acceso: admin Y vendedor (mismo gate que el resto del módulo).
 * Los reportes formales con tendencias/comparativas son admin-only y
 * vienen en una iteración futura.
 */
export function FinanzasPage() {
  const ahora = new Date();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [gastoOpen, setGastoOpen] = useState(false);
  const [ingresoOpen, setIngresoOpen] = useState(false);

  const query = useResumenFinanciero(anio, mes);

  function navMes(delta: number): void {
    let nuevoMes = mes + delta;
    let nuevoAnio = anio;
    if (nuevoMes < 1) {
      nuevoMes = 12;
      nuevoAnio--;
    } else if (nuevoMes > 12) {
      nuevoMes = 1;
      nuevoAnio++;
    }
    setMes(nuevoMes);
    setAnio(nuevoAnio);
  }

  const mesLabel = useMemo(() => {
    const d = new Date(anio, mes - 1, 1);
    const s = mesFmt.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [anio, mes]);

  const esMesActual = anio === ahora.getFullYear() && mes === ahora.getMonth() + 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6 md:py-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Resumen financiero
            </p>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
              {mesLabel}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-border bg-card">
              <button
                type="button"
                onClick={() => navMes(-1)}
                className="px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => navMes(1)}
                disabled={esMesActual}
                className="border-l border-border px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setIngresoOpen(true)}>
              <TrendingUp className="h-3.5 w-3.5" />
              Ingreso
            </Button>
            <Button type="button" size="sm" onClick={() => setGastoOpen(true)}>
              <TrendingDown className="h-3.5 w-3.5" />
              Gasto
            </Button>
          </div>
        </div>
      </header>

      {query.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Calculando resumen…
        </div>
      )}

      {query.error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {query.error.message}
        </div>
      )}

      {query.data && <Cuerpo resumen={query.data} />}

      <NuevoGastoDialog open={gastoOpen} onOpenChange={setGastoOpen} />
      <NuevoOtroIngresoDialog open={ingresoOpen} onOpenChange={setIngresoOpen} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cuerpo del resumen (cuando los datos están listos)
// ─────────────────────────────────────────────────────────────────────

function Cuerpo({ resumen }: { resumen: ResumenFinanciero }) {
  const positivo = resumen.resultado_neto >= 0;
  const colorResultado = positivo
    ? 'hsl(var(--estado-pagada))'
    : 'hsl(var(--destructive))';
  const margenStr = Number.isNaN(resumen.margen_porcentaje)
    ? '—'
    : `${resumen.margen_porcentaje >= 0 ? '+' : ''}${resumen.margen_porcentaje.toFixed(1)}%`;

  const sinDatos =
    resumen.ingresos_total === 0 && resumen.gastos_total === 0 && resumen.costos_directos === 0;

  if (sinDatos) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <PieChart className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-4 text-base font-semibold text-foreground">
          Aún no hay actividad financiera en este período
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cuando registres ingresos o gastos, vas a ver el desglose acá.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── HERO: Resultado del período ──────────────────────────── */}
      <section
        className="overflow-hidden rounded-xl border bg-card"
        style={{ borderColor: positivo ? 'hsl(var(--estado-pagada) / 0.35)' : 'hsl(var(--destructive) / 0.35)' }}
      >
        <div className="grid gap-0 md:grid-cols-2">
          {/* Resultado */}
          <div
            className="space-y-2 p-6"
            style={{ backgroundColor: positivo ? 'hsl(var(--estado-pagada) / 0.06)' : 'hsl(var(--destructive) / 0.06)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: colorResultado }}>
              Resultado del período
            </p>
            <p className="text-4xl font-bold tabular-nums" style={{ color: colorResultado }}>
              {positivo ? '+' : ''}{currencyFmt.format(resumen.resultado_neto)}
            </p>
            <p className="text-xs text-muted-foreground">
              {positivo ? 'Ganancia' : 'Pérdida'} preliminar después de costos y gastos. Margen sobre ingresos: <span className="font-medium text-foreground">{margenStr}</span>.
            </p>
          </div>

          {/* Mini-EERR */}
          <div className="space-y-2 p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cómo se calcula
            </p>
            <dl className="space-y-1 text-sm">
              <LineaCalc label="Ingresos" monto={resumen.ingresos_total} signo="+" />
              <LineaCalc label="Costos directos" monto={resumen.costos_directos} signo="−" />
              <LineaCalc label="Gastos operativos" monto={resumen.gastos_operativos} signo="−" />
              <LineaCalc label="Gastos de estructura" monto={resumen.gastos_estructura} signo="−" />
              {resumen.gastos_otros > 0 && (
                <LineaCalc label="Otros gastos" monto={resumen.gastos_otros} signo="−" />
              )}
              <div className="border-t border-border pt-1.5">
                <LineaCalc label="Resultado" monto={resumen.resultado_neto} signo="=" destacado />
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Ingresos"
          monto={resumen.ingresos_total}
          icon={TrendingUp}
          variant="positive"
        />
        <KpiCard
          label="Costos directos"
          monto={resumen.costos_directos}
          icon={Receipt}
          variant="neutral"
          subtitle="Mercadería vendida"
        />
        <KpiCard
          label="Gastos operativos"
          monto={resumen.gastos_operativos}
          icon={Wallet}
          variant="negative"
          subtitle="Canchas, clases, buffet, shop"
        />
        <KpiCard
          label="Gastos estructura"
          monto={resumen.gastos_estructura}
          icon={TrendingDown}
          variant="negative"
          subtitle="Alquiler, sueldos, servicios"
        />
      </section>

      {/* ── 2 columnas: ingresos por unidad / top gastos ─────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Ingresos por unidad */}
        <article className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Ingresos por unidad de negocio
            </h2>
            <p className="text-xs text-muted-foreground">
              Distribución de los ingresos del mes por origen.
            </p>
          </header>
          <div className="p-4">
            {resumen.ingresos_por_unidad.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ingresos en el período.</p>
            ) : (
              <ul className="space-y-3">
                {resumen.ingresos_por_unidad.map((u) => (
                  <BarraUnidad
                    key={u.unidad}
                    label={u.unidad}
                    monto={u.monto}
                    total={resumen.ingresos_total}
                    color="hsl(var(--estado-pagada))"
                  />
                ))}
              </ul>
            )}
          </div>
        </article>

        {/* Top gastos por categoría */}
        <article className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Principales gastos del mes
            </h2>
            <p className="text-xs text-muted-foreground">
              Top categorías por monto. Las salidas más relevantes.
            </p>
          </header>
          <div className="p-4">
            {resumen.top_gastos_categoria.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin gastos en el período.</p>
            ) : (
              <ul className="space-y-3">
                {resumen.top_gastos_categoria.map((g, idx) => (
                  <BarraUnidad
                    key={`${g.unidad_nombre}-${g.categoria_nombre}-${idx}`}
                    label={g.categoria_nombre}
                    sublabel={g.unidad_nombre}
                    monto={g.monto}
                    total={resumen.gastos_total}
                    color="hsl(var(--destructive))"
                  />
                ))}
              </ul>
            )}
          </div>
        </article>
      </section>

      {/* ── Movimientos recientes ──────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Movimientos recientes
          </h2>
          <p className="text-xs text-muted-foreground">
            Últimos {resumen.movimientos_recientes.length} movimientos del período, en orden cronológico.
          </p>
        </header>
        {resumen.movimientos_recientes.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Sin movimientos.</p>
        ) : (
          <ul className="divide-y divide-border">
            {resumen.movimientos_recientes.map((m) => (
              <MovimientoRow key={m.id} mov={m} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────

function LineaCalc({
  label,
  monto,
  signo,
  destacado,
}: {
  label: string;
  monto: number;
  signo: '+' | '−' | '=';
  destacado?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3',
        destacado ? 'pt-0.5 text-base font-semibold text-foreground' : 'text-sm text-muted-foreground',
      )}
    >
      <span className="flex items-center gap-2">
        {!destacado && (
          <span className="inline-flex h-4 w-4 items-center justify-center font-mono text-xs">
            {signo}
          </span>
        )}
        {label}
      </span>
      <span className={cn('tabular-nums', destacado && 'text-foreground')}>
        {currencyFmt.format(monto)}
      </span>
    </div>
  );
}

function KpiCard({
  label,
  monto,
  icon: Icon,
  variant,
  subtitle,
}: {
  label: string;
  monto: number;
  icon: LucideIcon;
  variant: 'positive' | 'negative' | 'neutral';
  subtitle?: string;
}) {
  const color =
    variant === 'positive'
      ? 'hsl(var(--estado-pagada))'
      : variant === 'negative'
        ? 'hsl(var(--destructive))'
        : 'hsl(var(--muted-foreground))';
  const bg =
    variant === 'positive'
      ? 'hsl(var(--estado-pagada) / 0.10)'
      : variant === 'negative'
        ? 'hsl(var(--destructive) / 0.10)'
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
      <p className="mt-2 text-xl font-bold tabular-nums text-foreground">
        {currencyFmt.format(monto)}
      </p>
      {subtitle && (
        <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

function BarraUnidad({
  label,
  sublabel,
  monto,
  total,
  color,
}: {
  label: string;
  sublabel?: string;
  monto: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (monto / total) * 100 : 0;
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{label}</p>
          {sublabel && (
            <p className="truncate text-[11px] text-muted-foreground">{sublabel}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-medium tabular-nums text-foreground">
            {currencyFmt.format(monto)}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{pct.toFixed(1)}%</p>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }}
        />
      </div>
    </li>
  );
}

function MovimientoRow({ mov }: { mov: MovimientoReciente }) {
  const positivo = mov.signo === '+';
  const color = positivo ? 'hsl(var(--estado-pagada))' : 'hsl(var(--destructive))';
  const Icon = positivo ? ArrowUpRight : ArrowDownRight;

  const tipoLabel =
    mov.tipo === 'gasto'
      ? 'Gasto'
      : mov.tipo === 'otro_ingreso'
        ? 'Otro ingreso'
        : mov.tipo === 'venta'
          ? 'Venta'
          : mov.tipo === 'cobro_reserva'
            ? 'Reserva'
            : 'Clase';

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${color.replace(')', ' / 0.12)')}`, color }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 truncate text-sm text-foreground">
          <span className="font-medium">{mov.descripcion}</span>
          <span className="text-[11px] text-muted-foreground">{tipoLabel}</span>
        </p>
        {mov.detalle && (
          <p className="truncate text-[11px] text-muted-foreground">{mov.detalle}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums" style={{ color }}>
          {mov.signo === '+' ? '+' : '−'}{currencyFmt.format(mov.monto)}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {fmtFechaCorta(mov.fecha)}
        </p>
      </div>
    </li>
  );
}
