import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ResumenFinanciero } from '@/features/finanzas/hooks/useResumenFinanciero';
import type { IngresosDiariosMes } from '@/features/finanzas/hooks/useIngresosDiariosMes';

// ─────────────────────────────────────────────────────────────────────
// Formatters locales para los gráficos
// ─────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────
// Estado vacío amigable para los gráficos
// ─────────────────────────────────────────────────────────────────────
function EstadoVacio({ mensaje }: { mensaje: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-xs text-muted-foreground">{mensaje}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tooltips custom de los gráficos
// ─────────────────────────────────────────────────────────────────────
interface RechartTooltipPayload {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: Record<string, unknown> }>;
}

function MoneyTooltip(props: RechartTooltipPayload) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const item = props.payload[0];
  const nombre = (item?.payload?.nombre as string) ?? '';
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-md">
      <p className="font-medium text-foreground">{nombre}</p>
      <p className="tabular-nums text-foreground">
        {fmtMoney(Number(item?.value ?? 0))}
      </p>
    </div>
  );
}

function DiarioTooltip(props: RechartTooltipPayload) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const item = props.payload[0];
  const p = item?.payload as
    | { dia: number; monto: number; acumulado: number }
    | undefined;
  if (!p) return null;
  return (
    <div className="space-y-0.5 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">Día {p.dia}</p>
      <p className="text-muted-foreground">
        Del día:{' '}
        <span className="font-medium tabular-nums text-foreground">
          {fmtMoney(p.monto)}
        </span>
      </p>
      <p className="text-muted-foreground">
        Acumulado:{' '}
        <span className="font-medium tabular-nums text-foreground">
          {fmtMoney(p.acumulado)}
        </span>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Componente de barras de ingresos por unidad
// ─────────────────────────────────────────────────────────────────────
const COLOR_UNIDAD: Record<string, string> = {
  canchas: '#10b981',  // emerald
  clases: '#3b82f6',   // blue
  buffet: '#f59e0b',   // amber
  shop: '#a855f7',     // purple
};

function colorDeUnidad(tipo: string): string {
  return COLOR_UNIDAD[tipo] ?? '#6b7280';
}

export function IngresosUnidadChart({
  data,
}: {
  data: ResumenFinanciero | null;
}) {
  if (!data || data.ingresos_por_unidad.length === 0) {
    return <EstadoVacio mensaje="Sin ingresos cargados este mes" />;
  }

  const datos = data.ingresos_por_unidad.map((u) => ({
    nombre: u.unidad,
    monto: u.monto,
    fill: colorDeUnidad(u.tipo),
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
          fontSize={12}
          width={90}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
        <Bar dataKey="monto" radius={[0, 4, 4, 0]} maxBarSize={32}>
          {datos.map((d) => (
            <Cell key={d.nombre} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Componente de línea de evolución diaria
// ─────────────────────────────────────────────────────────────────────
export function EvolucionDiariaChart({
  data,
}: {
  data: IngresosDiariosMes | null;
}) {
  const hoyDia = new Date().getDate();

  if (!data) return null;
  if (data.serie.length === 0 || data.serie.every((p) => p.monto === 0)) {
    return <EstadoVacio mensaje="Sin movimientos este mes" />;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data.serie}
        margin={{ top: 5, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="dia"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={fmtMoneyCompact}
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={50}
        />
        <Tooltip content={<DiarioTooltip />} />
        <ReferenceLine
          x={hoyDia}
          stroke="hsl(var(--primary))"
          strokeDasharray="3 3"
          label={{
            value: 'Hoy',
            position: 'top',
            fill: 'hsl(var(--primary))',
            fontSize: 10,
          }}
        />
        <Line
          type="monotone"
          dataKey="acumulado"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
