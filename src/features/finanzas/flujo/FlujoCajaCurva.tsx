import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
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
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// ── Datos del gráfico ────────────────────────────────────────────────────────
interface ChartRow {
  periodo: string;
  real: number | null; // tramo real (pasado + actual); null en futuro
  proy: number | null; // tramo proyectado (futuro) + empalme (hoy)
  tipo: TipoFila;
  saldo: number;
  esHoy: boolean;
}

const STROKE_ID = 'flujoStrokeGrad';
const FILL_ID = 'flujoFillGrad';

// ── Tooltip custom ───────────────────────────────────────────────────────────
interface CurvaTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow }>;
  gran: Granularidad;
}

const CHIP: Record<TipoFila, { label: string; cls: string }> = {
  real: { label: 'Real', cls: 'bg-primary/10 text-primary' },
  actual: { label: 'En curso', cls: 'bg-primary/10 text-primary' },
  proyectado: {
    label: 'Proyectado',
    cls: 'border border-dashed border-border text-muted-foreground',
  },
};

function CurvaTooltip({ active, payload, gran }: CurvaTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const chip = CHIP[row.tipo];
  return (
    <div className="space-y-1 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{etiquetaFull(row.periodo, gran)}</p>
      <p
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
          chip.cls,
        )}
      >
        {row.esHoy ? 'Hoy · Real' : chip.label}
      </p>
      <p
        className={cn(
          'text-sm font-semibold tabular-nums',
          row.saldo < 0 ? 'text-destructive' : 'text-foreground',
        )}
      >
        {fmtMoney(row.saldo)}
      </p>
    </div>
  );
}

// ── Estados ──────────────────────────────────────────────────────────────────
function SkeletonCurva() {
  return <div aria-busy="true" className="h-full w-full animate-pulse rounded-md bg-muted/40" />;
}
function CurvaVacia({ mensaje }: { mensaje: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{mensaje}</p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────
interface FlujoCajaCurvaProps {
  combinado: FlujoCombinado | null;
  loading: boolean;
  granularidad: Granularidad;
}

export function FlujoCajaCurva({ combinado, loading, granularidad }: FlujoCajaCurvaProps) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Saldo de caja</h2>
          <p className="text-xs text-muted-foreground">
            Real (línea sólida) → proyectado (punteado). El cruce de $0 marca el
            límite de liquidez.
          </p>
        </div>
        <Leyenda />
      </header>
      <div className="h-72">
        <CurvaInterior
          combinado={combinado}
          loading={loading}
          granularidad={granularidad}
        />
      </div>
    </article>
  );
}

function Leyenda() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-4 rounded bg-primary" />
        Real
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-0.5 w-4 rounded bg-primary/70"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to right, hsl(var(--primary)) 0 4px, transparent 4px 8px)',
            backgroundColor: 'transparent',
          }}
        />
        Proyectado
      </span>
    </div>
  );
}

function CurvaInterior({ combinado, loading, granularidad }: FlujoCajaCurvaProps) {
  if (loading) return <SkeletonCurva />;
  if (!combinado || combinado.filas.length === 0) {
    return <CurvaVacia mensaje="Sin datos de flujo para este rango." />;
  }

  const filas = combinado.filas;

  // Empalme: índice del último período REAL/ACTUAL (= "hoy"). Las dos series
  // comparten ese punto (mismo saldoCierre) → la curva es continua.
  let junctionIndex = -1;
  filas.forEach((f, i) => {
    if (f.tipo !== 'proyectado') junctionIndex = i;
  });

  const data: ChartRow[] = filas.map((f, i) => ({
    periodo: f.periodo,
    real: f.tipo === 'proyectado' ? null : f.saldoCierre,
    proy:
      f.tipo === 'proyectado' ? f.saldoCierre : i === junctionIndex ? f.saldoCierre : null,
    tipo: f.tipo,
    saldo: f.saldoCierre,
    esHoy: i === junctionIndex,
  }));

  // Dominio Y con el 0 adentro + padding proporcional.
  const saldos = filas.map((f) => f.saldoCierre);
  const dataMin = Math.min(...saldos);
  const dataMax = Math.max(...saldos);
  const yMin = Math.min(0, dataMin);
  const yMax = Math.max(0, dataMax);
  const span = yMax - yMin || Math.abs(yMax) || 1;
  const pad = span * 0.1;
  const domMin = yMin - (yMin < 0 ? pad : 0);
  const domMax = yMax + (yMax > 0 ? pad : 0);

  // Fracción de altura donde cae el 0 (corte azul→rojo del gradiente).
  const off =
    domMax - domMin === 0 ? (domMax >= 0 ? 1 : 0) : clamp01(domMax / (domMax - domMin));

  const hoyFila: FilaFlujo | undefined =
    junctionIndex >= 0 ? filas[junctionIndex] : undefined;

  // Valle de liquidez (saldo más bajo del rango).
  let valle: FilaFlujo = filas[0] as FilaFlujo;
  for (const f of filas) if (f.saldoCierre < valle.saldoCierre) valle = f;
  const mostrarValle = !hoyFila || valle.periodo !== hoyFila.periodo;
  const valleColor = valle.saldoCierre < 0 ? 'hsl(var(--destructive))' : '#f59e0b';

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 14, right: 16, left: 4, bottom: 0 }}>
        <defs>
          {/* Línea: corte duro azul/rojo en y=0. */}
          <linearGradient id={STROKE_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset={off} stopColor="hsl(var(--primary))" />
            <stop offset={off} stopColor="hsl(var(--destructive))" />
          </linearGradient>
          {/* Relleno: se desvanece hacia el 0 (azul arriba, rojo abajo). */}
          <linearGradient id={FILL_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset={0} stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset={off} stopColor="hsl(var(--primary))" stopOpacity={0.04} />
            <stop offset={off} stopColor="hsl(var(--destructive))" stopOpacity={0.04} />
            <stop offset={1} stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="periodo"
          tickFormatter={(p: string) => etiquetaEje(p, granularidad)}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
          interval="preserveStartEnd"
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
          content={<CurvaTooltip gran={granularidad} />}
          cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
        />

        {/* Línea del 0 — límite de liquidez. */}
        <ReferenceLine
          y={0}
          stroke="hsl(var(--destructive))"
          strokeDasharray="4 3"
          strokeOpacity={0.7}
          label={{
            value: '$0',
            position: 'insideTopLeft',
            fill: 'hsl(var(--destructive))',
            fontSize: 10,
          }}
        />

        {/* Tramo REAL (sólido, relleno). */}
        <Area
          type="monotone"
          dataKey="real"
          baseValue={0}
          stroke={`url(#${STROKE_ID})`}
          strokeWidth={2.5}
          fill={`url(#${FILL_ID})`}
          connectNulls={false}
          dot={{ r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 0 }}
          isAnimationActive={false}
        />
        {/* Tramo PROYECTADO (punteado + relleno más tenue). Comparte el punto
            de hoy con el real → continuidad. */}
        <Area
          type="monotone"
          dataKey="proy"
          baseValue={0}
          stroke={`url(#${STROKE_ID})`}
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="5 4"
          fill={`url(#${FILL_ID})`}
          fillOpacity={0.5}
          connectNulls={false}
          dot={{ r: 3, strokeWidth: 0, fillOpacity: 0.7 }}
          activeDot={{ r: 5, strokeWidth: 0 }}
          isAnimationActive={false}
        />

        {/* Valle de liquidez (punto más bajo). */}
        {mostrarValle && (
          <ReferenceDot
            x={valle.periodo}
            y={valle.saldoCierre}
            r={4}
            fill="hsl(var(--card))"
            stroke={valleColor}
            strokeWidth={2}
            label={{
              value: `Piso ${fmtMoneyCompact(valle.saldoCierre)}`,
              position: 'bottom',
              fill: valleColor,
              fontSize: 10,
              fontWeight: 600,
            }}
          />
        )}

        {/* Marcador "Hoy" en el empalme. */}
        {hoyFila && (
          <ReferenceDot
            x={hoyFila.periodo}
            y={hoyFila.saldoCierre}
            r={5}
            fill="hsl(var(--primary))"
            stroke="hsl(var(--card))"
            strokeWidth={2}
            label={{
              value: 'Hoy',
              position: 'top',
              fill: 'hsl(var(--primary))',
              fontSize: 10,
              fontWeight: 600,
            }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
