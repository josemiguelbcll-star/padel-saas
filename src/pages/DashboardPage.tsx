import { useMemo } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Info,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { useCajaAbierta } from '@/features/caja/hooks/useCajaAbierta';
import { useResumenCajaAbierta } from '@/features/caja/hooks/useResumenCajaAbierta';
import { useHorariosClub } from '@/features/configuracion/hooks/useHorariosClub';
import { useTarifas } from '@/features/configuracion/hooks/useTarifas';
import {
  useResumenFinanciero,
  type ResumenFinanciero,
} from '@/features/finanzas/hooks/useResumenFinanciero';
import {
  useProyeccionAlquileres,
  type ProyeccionAlquileres,
} from '@/features/finanzas/hooks/useProyeccionAlquileres';
import {
  useComparativoBuffet,
  type ComparativoBuffet,
} from '@/features/finanzas/hooks/useComparativoBuffet';
import {
  useIngresosDiariosMes,
  type IngresosDiariosMes,
} from '@/features/finanzas/hooks/useIngresosDiariosMes';
import { BandaHoy } from '@/features/dashboard';

// ─────────────────────────────────────────────────────────────────────
// Formatters + constantes
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

const fechaCorta = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const fechaCortaTabla = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

function fmtMoneyCompact(n: number): string {
  return currencyCompactFmt.format(Math.round(n));
}

const MESES_NOMBRE: Record<number, string> = {
  1: 'enero', 2: 'febrero', 3: 'marzo', 4: 'abril',
  5: 'mayo', 6: 'junio', 7: 'julio', 8: 'agosto',
  9: 'septiembre', 10: 'octubre', 11: 'noviembre', 12: 'diciembre',
};

function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

// ─────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────

/**
 * Dashboard del club. Para admin renderiza un panel ejecutivo con KPIs
 * + gráficos + tarjetas operativas + movimientos recientes. Para
 * vendedor solo muestra placeholder + banner de setup pendientes (si
 * aplica). Información financiera = del dueño.
 */
export function DashboardPage() {
  const { user, club } = useSession();
  const isAdmin = user?.rol === 'admin';

  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth() + 1;

  return (
    <div className="space-y-6">
      <SetupPendientesBanner />

      <DashboardHero
        nombreUsuario={user?.nombre ?? ''}
        nombreClub={club?.nombre ?? ''}
        fecha={ahora}
        mes={mes}
        anio={anio}
        isAdmin={isAdmin}
      />

      {isAdmin ? (
        <AdminDashboard anio={anio} mes={mes} />
      ) : (
        <VendedorDashboard />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────

interface DashboardHeroProps {
  nombreUsuario: string;
  nombreClub: string;
  fecha: Date;
  mes: number;
  anio: number;
  isAdmin: boolean;
}

function DashboardHero({
  nombreUsuario,
  fecha,
  mes,
  anio,
  isAdmin,
}: DashboardHeroProps) {
  const fechaTexto = fechaCorta.format(fecha);
  // Capitalizar primera letra ("martes 22 de mayo" → "Martes 22 de mayo")
  const fechaCap = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);

  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {nombreUsuario ? `Hola, ${nombreUsuario.split(' ')[0]}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? `Resumen de ${MESES_NOMBRE[mes]} ${anio}`
            : 'Bienvenido de vuelta'}
        </p>
      </div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {fechaCap}
      </p>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Vendedor — vista mínima
// ─────────────────────────────────────────────────────────────────────

function VendedorDashboard() {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <Activity
        className="mx-auto h-8 w-8 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="mt-3 text-sm text-muted-foreground">
        Usá el menú lateral para gestionar reservas, caja y mostrador.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Admin dashboard — orquesta todas las secciones
// ─────────────────────────────────────────────────────────────────────

interface AdminDashboardProps {
  anio: number;
  mes: number;
}

function AdminDashboard({ anio, mes }: AdminDashboardProps) {
  const resumenActual = useResumenFinanciero(anio, mes);
  const { anio: anioAnt, mes: mesAnt } = mesAnterior(anio, mes);
  const resumenAnterior = useResumenFinanciero(anioAnt, mesAnt);
  const cajaAbierta = useCajaAbierta();
  const resumenCaja = useResumenCajaAbierta(cajaAbierta.data?.id ?? null);
  const ingresosDiarios = useIngresosDiariosMes(anio, mes);
  const proyeccion = useProyeccionAlquileres(anio, mes);
  const comparativoBuffet = useComparativoBuffet();

  return (
    <div className="space-y-5">
      <BandaHoy />

      <h2 className="border-t border-border pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Este mes
      </h2>

      <KpiGrid
        actual={resumenActual.data ?? null}
        anterior={resumenAnterior.data ?? null}
        cajaAbiertaEn={cajaAbierta.data?.abierta_en ?? null}
        cajaSaldoActual={resumenCaja.data?.esperado ?? null}
        loading={resumenActual.isLoading || resumenAnterior.isLoading}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          titulo="Ingresos por unidad"
          subtitulo={`${MESES_NOMBRE[mes]} ${anio}`}
        >
          {resumenActual.isLoading ? (
            <ChartSkeleton />
          ) : (
            <IngresosUnidadChart data={resumenActual.data ?? null} />
          )}
        </ChartCard>

        <ChartCard
          titulo="Evolución diaria de ingresos"
          subtitulo="Acumulado del mes"
        >
          {ingresosDiarios.isLoading ? (
            <ChartSkeleton />
          ) : (
            <EvolucionDiariaChart data={ingresosDiarios.data ?? null} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AlquileresCard
          query={proyeccion}
          mesNombre={MESES_NOMBRE[mes] ?? ''}
        />
        <BuffetRitmoCard query={comparativoBuffet} />
      </div>

      <MovimientosRecientesPanel
        resumen={resumenActual.data ?? null}
        loading={resumenActual.isLoading}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KPI Grid — 4 cards superiores
// ─────────────────────────────────────────────────────────────────────

interface KpiGridProps {
  actual: ResumenFinanciero | null;
  anterior: ResumenFinanciero | null;
  cajaAbiertaEn: string | null;
  cajaSaldoActual: number | null;
  loading: boolean;
}

function KpiGrid({
  actual,
  anterior,
  cajaAbiertaEn,
  cajaSaldoActual,
  loading,
}: KpiGridProps) {
  const horaApertura = cajaAbiertaEn
    ? new Date(cajaAbiertaEn).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={TrendingUp}
        label="Ingresos del mes"
        valor={actual?.ingresos_total ?? null}
        valorAnterior={anterior?.ingresos_total ?? null}
        signoVerde="positivo"
        loading={loading}
      />
      <KpiCard
        icon={TrendingDown}
        label="Egresos del mes"
        valor={
          actual ? actual.costos_directos + actual.gastos_total : null
        }
        valorAnterior={
          anterior ? anterior.costos_directos + anterior.gastos_total : null
        }
        signoVerde="negativo"
        loading={loading}
      />
      <KpiCard
        icon={Activity}
        label="Resultado del mes"
        valor={actual?.resultado_neto ?? null}
        valorAnterior={anterior?.resultado_neto ?? null}
        signoVerde="positivo"
        resaltarSignoDelMonto
        loading={loading}
      />
      <KpiCard
        icon={Wallet}
        label="Caja hoy"
        valor={cajaAbiertaEn ? cajaSaldoActual : null}
        valorAnterior={null}
        signoVerde="positivo"
        loading={loading}
        bottomNote={
          cajaAbiertaEn
            ? `Abierta desde ${horaApertura}`
            : 'Caja cerrada'
        }
        deshabilitarComparativo
      />
    </div>
  );
}

interface KpiCardProps {
  icon: typeof TrendingUp;
  label: string;
  valor: number | null;
  valorAnterior: number | null;
  /** Define qué dirección de variación es "positiva" (verde). */
  signoVerde: 'positivo' | 'negativo';
  /** Si TRUE, el monto en sí se colorea según su signo (típico de "resultado"). */
  resaltarSignoDelMonto?: boolean;
  /** Texto chico en lugar del comparativo (ej. "Caja cerrada"). */
  bottomNote?: string;
  deshabilitarComparativo?: boolean;
  loading: boolean;
}

function KpiCard({
  icon: Icon,
  label,
  valor,
  valorAnterior,
  signoVerde,
  resaltarSignoDelMonto,
  bottomNote,
  deshabilitarComparativo,
  loading,
}: KpiCardProps) {
  const variacion = useMemo(() => {
    if (valor === null || valorAnterior === null || valorAnterior === 0) {
      return null;
    }
    return ((valor - valorAnterior) / Math.abs(valorAnterior)) * 100;
  }, [valor, valorAnterior]);

  const variacionEsBuena =
    variacion === null
      ? null
      : signoVerde === 'positivo'
        ? variacion >= 0
        : variacion <= 0;

  const colorMonto =
    resaltarSignoDelMonto && valor !== null
      ? valor >= 0
        ? 'text-emerald-600 dark:text-emerald-500'
        : 'text-red-600 dark:text-red-500'
      : 'text-foreground';

  return (
    <article className="group relative overflow-hidden rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon
          className="h-3.5 w-3.5 text-muted-foreground/60"
          aria-hidden="true"
        />
      </div>

      {loading ? (
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-muted/50" />
      ) : valor === null ? (
        <p className="mt-3 text-2xl font-bold tabular-nums text-muted-foreground">
          —
        </p>
      ) : (
        <p
          className={cn(
            'mt-3 text-2xl font-bold tabular-nums leading-none',
            colorMonto,
          )}
        >
          {fmtMoney(valor)}
        </p>
      )}

      <div className="mt-3 h-4">
        {bottomNote ? (
          <p className="text-[11px] text-muted-foreground">{bottomNote}</p>
        ) : !deshabilitarComparativo && !loading && variacion !== null ? (
          <p
            className={cn(
              'flex items-center gap-1 text-[11px] font-medium tabular-nums',
              variacionEsBuena
                ? 'text-emerald-600 dark:text-emerald-500'
                : 'text-red-600 dark:text-red-500',
            )}
          >
            {variacion >= 0 ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
            )}
            {variacion >= 0 ? '+' : ''}
            {variacion.toFixed(1)}% vs mes anterior
          </p>
        ) : null}
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ChartCard — wrapper de las cards de gráfico
// ─────────────────────────────────────────────────────────────────────

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

function ChartSkeleton() {
  return (
    <div
      aria-busy="true"
      className="h-full w-full animate-pulse rounded bg-muted/40"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Ingresos por unidad — gráfico de barras horizontales
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

function IngresosUnidadChart({
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
// Evolución diaria — line chart con marca de hoy
// ─────────────────────────────────────────────────────────────────────

function EvolucionDiariaChart({
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

// ─────────────────────────────────────────────────────────────────────
// Tooltips custom de los gráficos
// ─────────────────────────────────────────────────────────────────────

// Tipado del payload de Recharts: la lib expone `active`/`payload` en
// runtime pero su tipo `TooltipProps` no los marca accesibles. Patrón
// estándar es tipar el shape esperado a mano.
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
// Card Alquileres del mes (pulida)
// ─────────────────────────────────────────────────────────────────────

interface AlquileresCardProps {
  query: ReturnType<typeof useProyeccionAlquileres>;
  mesNombre: string;
}

function AlquileresCard({ query, mesNombre }: AlquileresCardProps) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">
            Alquileres del mes
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {mesNombre}
        </span>
      </header>

      {query.isLoading && (
        <div
          aria-busy="true"
          className="mt-3 h-36 animate-pulse rounded-md bg-muted/40"
        />
      )}
      {query.error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {query.error.message}
        </p>
      )}
      {query.data && <AlquileresContenido data={query.data} />}
    </article>
  );
}

function AlquileresContenido({ data }: { data: ProyeccionAlquileres }) {
  const total = data.total_estimado;
  const cobradoPct = total > 0 ? (data.ya_cobrado_total / total) * 100 : 0;

  return (
    <div className="mt-3 space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Estimación de cierre
        </p>
        <p className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-foreground">
          {fmtMoney(total)}
        </p>
      </div>

      {/* Barra de progreso cobrado vs pendiente */}
      <div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="bg-emerald-500 transition-all"
            style={{ width: `${cobradoPct}%` }}
            aria-label={`${Math.round(cobradoPct)}% cobrado`}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Cobrado</span>
            <strong className="tabular-nums text-foreground">
              {fmtMoney(data.ya_cobrado_total)}
            </strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Pendiente</span>
            <strong className="tabular-nums text-foreground">
              {fmtMoney(data.falta_cobrar_total)}
            </strong>
          </span>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border pt-3 text-xs">
        <DesgloseRow
          label="Turnos fijos"
          ya={data.desglose.turnos_fijos.ya_cobrado}
          falta={data.desglose.turnos_fijos.falta_cobrar}
        />
        <DesgloseRow
          label="Clases"
          ya={data.desglose.clases.ya_cobrado}
          falta={data.desglose.clases.falta_cobrar}
        />
        <DesgloseRow
          label="Reservas sueltas"
          ya={data.desglose.reservas_sueltas.ya_cobrado}
          falta={data.desglose.reservas_sueltas.falta_cobrar}
        />
      </div>
    </div>
  );
}

function DesgloseRow({
  label,
  ya,
  falta,
}: {
  label: string;
  ya: number;
  falta: number;
}) {
  const total = ya + falta;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">
        {fmtMoney(total)}
        <span className="ml-1.5 text-[10px] text-muted-foreground">
          ({fmtMoney(ya)} cobrado)
        </span>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Card Buffet ritmo (pulida)
// ─────────────────────────────────────────────────────────────────────

function BuffetRitmoCard({
  query,
}: {
  query: ReturnType<typeof useComparativoBuffet>;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header className="flex items-center gap-2">
        <ShoppingCart className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">
          Buffet & Shop · ritmo
        </h2>
      </header>

      {query.isLoading && (
        <div
          aria-busy="true"
          className="mt-3 h-36 animate-pulse rounded-md bg-muted/40"
        />
      )}
      {query.error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {query.error.message}
        </p>
      )}
      {query.data && <BuffetContenido data={query.data} />}
    </article>
  );
}

function BuffetContenido({ data }: { data: ComparativoBuffet }) {
  const diaHoy = Number(data.hoy.slice(8, 10));
  const diaMesAnt = Number(data.mismo_dia_mes_anterior.slice(8, 10));
  const tieneComparable = data.vendido_mes_anterior_hasta_mismo_dia > 0;
  const Icono = data.va_por_encima ? TrendingUp : TrendingDown;
  const tono = data.va_por_encima
    ? 'text-emerald-600 dark:text-emerald-500'
    : 'text-red-600 dark:text-red-500';
  const palabra = data.va_por_encima ? 'ENCIMA' : 'DEBAJO';
  const signo = data.va_por_encima ? '+' : '−';
  const pct = Number.isNaN(data.diferencia_porcentaje)
    ? null
    : Math.round(Math.abs(data.diferencia_porcentaje));

  return (
    <div className="mt-3 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mes anterior
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums leading-none text-foreground">
            {fmtMoney(data.total_mes_anterior)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Este mes (al día {diaHoy})
          </p>
          <p className="mt-0.5 text-lg font-bold tabular-nums leading-none text-foreground">
            {fmtMoney(data.vendido_este_mes_hasta_hoy)}
          </p>
        </div>
      </div>

      {tieneComparable ? (
        <div
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 text-xs',
            data.va_por_encima
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-red-500/30 bg-red-500/5',
          )}
        >
          <Icono className={cn('mt-0.5 h-4 w-4 shrink-0', tono)} aria-hidden="true" />
          <p>
            Al día {diaMesAnt}, el mes pasado llevaba{' '}
            <strong className="font-semibold tabular-nums text-foreground">
              {fmtMoney(data.vendido_mes_anterior_hasta_mismo_dia)}
            </strong>
            . Vamos{' '}
            <strong className={cn('font-semibold tabular-nums', tono)}>
              {signo} {fmtMoney(Math.abs(data.diferencia_pesos))}
              {pct !== null && ` (${signo}${pct}%)`}
            </strong>{' '}
            por <strong className={cn('font-semibold', tono)}>{palabra}</strong>.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Sin ventas el mes pasado hasta el día {diaMesAnt}; no hay base de
          comparación todavía.
        </p>
      )}

      <p className="text-[10px] italic text-muted-foreground">
        Sin proyección — el buffet es impredecible.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Movimientos recientes
// ─────────────────────────────────────────────────────────────────────

const TIPO_LABEL: Record<string, string> = {
  cobro_reserva: 'Cobro reserva',
  cobro_clase: 'Cobro clase',
  venta: 'Venta',
  otro_ingreso: 'Otro ingreso',
  gasto: 'Gasto',
};

function MovimientosRecientesPanel({
  resumen,
  loading,
}: {
  resumen: ResumenFinanciero | null;
  loading: boolean;
}) {
  const movs = (resumen?.movimientos_recientes ?? []).slice(0, 10);

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Movimientos recientes
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Últimos 10
        </span>
      </header>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-8 animate-pulse rounded bg-muted/40"
            />
          ))}
        </div>
      ) : movs.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Sin movimientos este mes
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {movs.map((m) => {
            const esIngreso = m.signo === '+';
            return (
              <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-10 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {fechaCortaTabla.format(new Date(m.fecha))}
                </span>
                <span className="w-28 shrink-0 truncate text-[11px] font-medium text-muted-foreground">
                  {TIPO_LABEL[m.tipo] ?? m.tipo}
                </span>
                <span className="flex-1 truncate text-foreground">
                  {m.descripcion}
                  {m.detalle && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      · {m.detalle}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    esIngreso
                      ? 'text-emerald-600 dark:text-emerald-500'
                      : 'text-red-600 dark:text-red-500',
                  )}
                >
                  {esIngreso ? '+' : '−'} {fmtMoney(m.monto)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Banner setup pendientes (existente, sin cambios funcionales)
// ─────────────────────────────────────────────────────────────────────

interface ItemPendiente {
  label: string;
  to: string;
}

function SetupPendientesBanner() {
  const { user } = useSession();
  const horariosQuery = useHorariosClub();
  const tarifasQuery = useTarifas();

  if (user?.rol !== 'admin') return null;
  if (horariosQuery.isLoading || tarifasQuery.isLoading) return null;

  const horariosFaltantes =
    !horariosQuery.data?.hora_apertura || !horariosQuery.data?.hora_cierre;
  const tarifasFaltantes = (tarifasQuery.data?.length ?? 0) === 0;
  if (!horariosFaltantes && !tarifasFaltantes) return null;

  const pendientes: ItemPendiente[] = [];
  if (horariosFaltantes) {
    pendientes.push({ label: 'Horarios del club', to: '/configuracion/horarios' });
  }
  if (tarifasFaltantes) {
    pendientes.push({ label: 'Al menos una tarifa', to: '/configuracion/tarifas' });
  }

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-foreground">Te falta configurar:</p>
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
