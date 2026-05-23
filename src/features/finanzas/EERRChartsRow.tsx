import {
  Banknote,
  Building2,
  CreditCard,
  Smartphone,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { ResumenFinanciero } from './hooks/useResumenFinanciero';
import {
  useIngresosPorMedio,
  type IngresoPorMedio,
  type MedioPagoIngreso,
} from './hooks/useIngresosPorMedio';
import type { TipoUnidad } from '@/types/database';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const currencyCompactFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

function fmtMoneyCompact(n: number): string {
  return currencyCompactFmt.format(Math.round(n));
}

// ── Medios de pago: color + label + icono ─────────────────────────────
const MEDIO_LABEL: Record<MedioPagoIngreso, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

// Paleta semántica: efectivo verde (físico, "plata cash"), transferencia
// azul (bancario), MP celeste (su brand), tarjeta púrpura, otro gris.
const MEDIO_COLOR: Record<MedioPagoIngreso, string> = {
  efectivo: '#10b981',      // emerald
  transferencia: '#3b82f6', // blue
  mp: '#06b6d4',            // cyan (cerca de MP brand)
  tarjeta: '#a855f7',       // purple
  otro: '#6b7280',          // gray
};

const MEDIO_ICON: Record<MedioPagoIngreso, LucideIcon> = {
  efectivo: Banknote,
  transferencia: Building2,
  mp: Smartphone,
  tarjeta: CreditCard,
  otro: Wallet,
};

// Color para top categorías de gasto (sin cambios).
const COLOR_GASTO: Record<string, string> = {
  canchas: '#ef4444',
  clases: '#ef4444',
  buffet: '#ef4444',
  shop: '#ef4444',
  estructura: '#f97316',
  financiero: '#a855f7',
  auspicios: '#6b7280',
  membresias: '#6b7280',
  otro: '#6b7280',
};

interface EERRChartsRowProps {
  resumen: ResumenFinanciero;
  anio: number;
  mes: number;
}

export function EERRChartsRow({ resumen, anio, mes }: EERRChartsRowProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        titulo="Cómo se cobró el dinero"
        subtitulo="Distribución del mes por medio de pago"
      >
        <IngresosPorMedioChart anio={anio} mes={mes} />
      </ChartCard>
      <ChartCard
        titulo="Top categorías de gasto"
        subtitulo="Rojo operativos · naranja estructura · púrpura financiero"
      >
        <TopGastosChart resumen={resumen} />
      </ChartCard>
    </div>
  );
}

interface ChartCardProps {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}

function ChartCard({ titulo, subtitulo, children }: ChartCardProps) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header className="mb-2">
        <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
        {subtitulo && (
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        )}
      </header>
      <div className="h-56">{children}</div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Donut: cómo se cobró el dinero por medio de pago
// ─────────────────────────────────────────────────────────────────────

function IngresosPorMedioChart({ anio, mes }: { anio: number; mes: number }) {
  const query = useIngresosPorMedio(anio, mes);

  if (query.isLoading) {
    return <SkeletonChart />;
  }
  if (query.error) {
    return <EstadoVacio mensaje={query.error.message} />;
  }
  const data = query.data;
  if (!data || data.items.length === 0 || data.total <= 0) {
    return <EstadoVacio mensaje="Sin cobros registrados este mes" />;
  }

  const chartData = data.items.map((i) => ({
    medio: i.medio,
    monto: i.monto,
    label: MEDIO_LABEL[i.medio],
    fill: MEDIO_COLOR[i.medio],
  }));

  return (
    <div className="grid h-full grid-cols-5 items-center gap-3">
      {/* Donut con total centrado */}
      <div className="relative col-span-2 h-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="monto"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="hsl(var(--card))"
              strokeWidth={2}
            >
              {chartData.map((d) => (
                <Cell key={d.medio} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip content={<MedioTooltip total={data.total} />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Total absolutamente centrado en el donut */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total
          </p>
          <p className="text-base font-bold tabular-nums leading-tight text-foreground">
            {fmtMoneyCompact(data.total)}
          </p>
        </div>
      </div>

      {/* Leyenda lateral con monto + % por medio */}
      <ul className="col-span-3 space-y-1.5 self-center">
        {data.items.map((item) => (
          <LegendItem key={item.medio} item={item} total={data.total} />
        ))}
      </ul>
    </div>
  );
}

function LegendItem({
  item,
  total,
}: {
  item: IngresoPorMedio;
  total: number;
}) {
  const pct = total > 0 ? (item.monto / total) * 100 : 0;
  const Icon = MEDIO_ICON[item.medio];
  const color = MEDIO_COLOR[item.medio];

  return (
    <li className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon
            className="h-3 w-3 shrink-0"
            style={{ color }}
            aria-hidden="true"
          />
          <span className="truncate font-medium text-foreground">
            {MEDIO_LABEL[item.medio]}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center gap-2 pl-[18px]">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-foreground">
          {fmtMoneyCompact(item.monto)}
        </span>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top categorías de gasto (sin cambios)
// ─────────────────────────────────────────────────────────────────────

function TopGastosChart({ resumen }: { resumen: ResumenFinanciero }) {
  const items = resumen.top_gastos_categoria.slice(0, 8);
  if (items.length === 0) {
    return <EstadoVacio mensaje="Sin gastos cargados este mes" />;
  }
  const datos = items.map((c) => ({
    nombre: c.categoria_nombre,
    unidad: c.unidad_nombre,
    monto: c.monto,
    fill: COLOR_GASTO[c.unidad_tipo] ?? '#6b7280',
    tipo: c.unidad_tipo as TipoUnidad,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={datos}
        layout="vertical"
        margin={{ top: 5, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
        <XAxis
          type="number"
          tickFormatter={fmtMoneyCompact}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="nombre"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          width={130}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) =>
            String(v).length > 18 ? `${String(v).slice(0, 16)}…` : String(v)
          }
        />
        <Tooltip
          content={<GastoTooltip />}
          cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
        />
        <Bar dataKey="monto" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {datos.map((d) => (
            <Cell key={d.nombre} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tooltips custom
// ─────────────────────────────────────────────────────────────────────

interface RechartTooltipPayload {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: Record<string, unknown> }>;
}

function MedioTooltip({
  total,
  ...props
}: RechartTooltipPayload & { total: number }) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const item = props.payload[0];
  const payload = item?.payload as
    | { label: string; medio: MedioPagoIngreso; fill: string }
    | undefined;
  const value = Number(item?.value ?? 0);
  if (!payload) return null;
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-0.5 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <span
          className={cn('inline-block h-2 w-2 rounded-full')}
          style={{ backgroundColor: payload.fill }}
        />
        {payload.label}
      </p>
      <p className="tabular-nums text-foreground">{fmtMoney(value)}</p>
      <p className="text-[10px] text-muted-foreground">
        {pct.toFixed(1)}% del total
      </p>
    </div>
  );
}

function GastoTooltip(props: RechartTooltipPayload) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const item = props.payload[0];
  const payload = item?.payload as
    | { nombre: string; unidad: string }
    | undefined;
  if (!payload) return null;
  return (
    <div className="space-y-0.5 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{payload.nombre}</p>
      <p className="text-[10px] text-muted-foreground">{payload.unidad}</p>
      <p className="tabular-nums text-foreground">
        {fmtMoney(Number(item?.value ?? 0))}
      </p>
    </div>
  );
}

function EstadoVacio({ mensaje }: { mensaje: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-xs text-muted-foreground">{mensaje}</p>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div
      aria-busy="true"
      className="h-full w-full animate-pulse rounded bg-muted/40"
    />
  );
}
