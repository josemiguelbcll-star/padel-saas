import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { Granularidad } from '../utils/clavePeriodo';
import type { FilaFlujo, FlujoCombinado, TipoFila } from '../utils/combinarFlujo';

// ── Formato ────────────────────────────────────────────────────────────────
const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const moneyCompact = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  notation: 'compact',
  maximumFractionDigits: 1,
});
function fmtMoney(n: number): string {
  return money.format(Math.round(n));
}
function fmtMoneyCompact(n: number): string {
  return moneyCompact.format(Math.round(n));
}
function fmtSigned(n: number): string {
  if (Math.round(n) === 0) return '$0';
  return `${n > 0 ? '+' : '−'}${fmtMoneyCompact(Math.abs(n))}`;
}

const mesCortoFmt = new Intl.DateTimeFormat('es-AR', { month: 'short' });
const mesLargoFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
const diaCortoFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' });
const diaLargoFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
function parseLocal(iso: string): Date {
  const p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function etiquetaEje(iso: string, gran: Granularidad): string {
  const d = parseLocal(iso);
  if (gran === 'month') return cap(mesCortoFmt.format(d)).replace('.', '');
  return diaCortoFmt.format(d);
}
function etiquetaFull(iso: string, gran: Granularidad): string {
  const d = parseLocal(iso);
  if (gran === 'month') return cap(mesLargoFmt.format(d));
  if (gran === 'week') return `Semana del ${diaCortoFmt.format(d)}`;
  return cap(diaLargoFmt.format(d));
}

const EMERALD = '#10b981';

// ── Filas del waterfall ──────────────────────────────────────────────────────
type WfKind = 'inicio' | 'periodo' | 'cierre';
interface WfRow {
  x: string;
  /** Segmento invisible (base de la barra flotante). */
  base: number;
  /** Segmento visible (alto de la barra). */
  delta: number;
  kind: WfKind;
  signo: 1 | -1 | 0; // para color del neto del período
  tipo?: TipoFila;
  // metadatos tooltip / label
  periodoISO?: string;
  apertura?: number;
  cierre: number;
  neto?: number;
  labelTxt: string;
}

function estiloBarra(row: WfRow): {
  fill: string;
  fillOpacity: number;
  stroke?: string;
  strokeDasharray?: string;
} {
  if (row.kind !== 'periodo') {
    return { fill: 'hsl(var(--primary))', fillOpacity: 0.9 };
  }
  const color = row.signo < 0 ? 'hsl(var(--destructive))' : EMERALD;
  return row.tipo === 'proyectado'
    ? { fill: color, fillOpacity: 0.4, stroke: color, strokeDasharray: '3 2' }
    : { fill: color, fillOpacity: 0.9 };
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
const CHIP: Record<TipoFila, { label: string; cls: string }> = {
  real: { label: 'Real', cls: 'bg-primary/10 text-primary' },
  actual: { label: 'En curso', cls: 'bg-primary/10 text-primary' },
  proyectado: {
    label: 'Proyectado',
    cls: 'border border-dashed border-border text-muted-foreground',
  },
};

interface WfTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: WfRow }>;
  gran: Granularidad;
}

function WfTooltip({ active, payload, gran }: WfTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  if (row.kind !== 'periodo') {
    return (
      <div className="space-y-0.5 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
        <p className="font-medium text-foreground">
          {row.kind === 'inicio' ? 'Saldo inicial' : 'Saldo final'}
        </p>
        <p
          className={cn(
            'text-sm font-semibold tabular-nums',
            row.cierre < 0 ? 'text-destructive' : 'text-foreground',
          )}
        >
          {fmtMoney(row.cierre)}
        </p>
      </div>
    );
  }

  const chip = row.tipo ? CHIP[row.tipo] : null;
  return (
    <div className="space-y-1 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">
        {row.periodoISO ? etiquetaFull(row.periodoISO, gran) : row.x}
      </p>
      {chip && (
        <p
          className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            chip.cls,
          )}
        >
          {chip.label}
        </p>
      )}
      <p
        className={cn(
          'text-sm font-semibold tabular-nums',
          (row.neto ?? 0) > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : (row.neto ?? 0) < 0
              ? 'text-destructive'
              : 'text-muted-foreground',
        )}
      >
        Neto {fmtSigned(row.neto ?? 0)}
      </p>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {fmtMoney(row.apertura ?? 0)} → {fmtMoney(row.cierre)}
      </p>
    </div>
  );
}

// ── Estados ──────────────────────────────────────────────────────────────────
function SkeletonWf() {
  return <div aria-busy="true" className="h-full w-full animate-pulse rounded-md bg-muted/40" />;
}
function WfVacio({ mensaje }: { mensaje: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{mensaje}</p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────
interface FlujoCajaWaterfallProps {
  combinado: FlujoCombinado | null;
  loading: boolean;
  granularidad: Granularidad;
}

export function FlujoCajaWaterfall({
  combinado,
  loading,
  granularidad,
}: FlujoCajaWaterfallProps) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Composición del saldo
          </h2>
          <p className="text-xs text-muted-foreground">
            Saldo inicial → aporte de cada período (verde suma, rojo resta) →
            saldo final. Proyectado en tono tenue.
          </p>
        </div>
      </header>
      <div className="h-64">
        <WfInterior
          combinado={combinado}
          loading={loading}
          granularidad={granularidad}
        />
      </div>
    </article>
  );
}

function WfInterior({ combinado, loading, granularidad }: FlujoCajaWaterfallProps) {
  if (loading) return <SkeletonWf />;
  if (!combinado || combinado.filas.length === 0) {
    return <WfVacio mensaje="Sin datos de flujo para este rango." />;
  }

  const filas = combinado.filas;
  const primera = filas[0] as FilaFlujo;
  const ultima = filas[filas.length - 1] as FilaFlujo;

  const rows: WfRow[] = [];

  // Ancla inicial.
  rows.push({
    x: 'Inicio',
    base: 0,
    delta: primera.saldoApertura,
    kind: 'inicio',
    signo: 0,
    cierre: primera.saldoApertura,
    labelTxt: fmtMoneyCompact(primera.saldoApertura),
  });

  // Un escalón flotante por período (su neto).
  for (const f of filas) {
    const base = Math.min(f.saldoApertura, f.saldoCierre);
    rows.push({
      x: etiquetaEje(f.periodo, granularidad),
      base,
      delta: Math.abs(f.neto),
      kind: 'periodo',
      signo: f.neto > 0 ? 1 : f.neto < 0 ? -1 : 0,
      tipo: f.tipo,
      periodoISO: f.periodo,
      apertura: f.saldoApertura,
      cierre: f.saldoCierre,
      neto: f.neto,
      labelTxt: fmtSigned(f.neto),
    });
  }

  // Ancla final.
  rows.push({
    x: 'Cierre',
    base: 0,
    delta: ultima.saldoCierre,
    kind: 'cierre',
    signo: 0,
    cierre: ultima.saldoCierre,
    labelTxt: fmtMoneyCompact(ultima.saldoCierre),
  });

  // Dominio Y con el 0 adentro (cubre aperturas y cierres) + padding.
  const vals = filas.flatMap((f) => [f.saldoApertura, f.saldoCierre]);
  const dataMin = Math.min(0, ...vals);
  const dataMax = Math.max(0, ...vals);
  const span = dataMax - dataMin || Math.abs(dataMax) || 1;
  const pad = span * 0.12;
  const domMin = dataMin - (dataMin < 0 ? pad : 0);
  const domMax = dataMax + (dataMax > 0 ? pad : 0);

  // Labels solo cuando hay pocas barras (mes); en semana/día se amontonarían.
  const mostrarLabels = rows.length <= 8;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 16, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={8}
        />
        <YAxis
          domain={[domMin, domMax]}
          tickFormatter={fmtMoneyCompact}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={64}
        />
        <Tooltip
          content={<WfTooltip gran={granularidad} />}
          cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
        />
        <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeOpacity={0.7} />

        {/* Base invisible (posiciona la barra flotante). */}
        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
        {/* Delta visible (el alto de cada barra). */}
        <Bar
          dataKey="delta"
          stackId="wf"
          radius={[2, 2, 0, 0]}
          maxBarSize={46}
          isAnimationActive={false}
        >
          {rows.map((row, i) => {
            const e = estiloBarra(row);
            return (
              <Cell
                key={`${row.x}-${i}`}
                fill={e.fill}
                fillOpacity={e.fillOpacity}
                stroke={e.stroke}
                strokeDasharray={e.strokeDasharray}
                strokeWidth={e.stroke ? 1.5 : 0}
              />
            );
          })}
          {mostrarLabels && (
            <LabelList
              dataKey="labelTxt"
              position="top"
              fontSize={10}
              fill="hsl(var(--muted-foreground))"
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
