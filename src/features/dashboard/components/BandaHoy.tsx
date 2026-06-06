import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  Gauge,
  PackageX,
  Target,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTurnosAbiertosViejos } from '@/features/reservas/hooks/useTurnosAbiertosViejos';
import { useVentaDelDia } from '../hooks/useVentaDelDia';
import { useProyeccionCierreHoy } from '../hooks/useProyeccionCierreHoy';
import { useOcupacionHoy } from '../hooks/useOcupacionHoy';
import { useCobroPendienteHoy } from '../hooks/useCobroPendienteHoy';
import { useProductosParaReponer } from '../hooks/useProductosParaReponer';

// ─────────────────────────────────────────────────────────────────────
// Formatter
// ─────────────────────────────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

// ─────────────────────────────────────────────────────────────────────
// Banda "Hoy" — KPIs del día + panel de alarmas
// ─────────────────────────────────────────────────────────────────────

/**
 * Banda operativa "Hoy": 3 KPIs del día (venta, proyección de cierre,
 * ocupación) + panel "Para atender" (alarmas que solo aparecen si disparan).
 * Vive ARRIBA del bloque mensual del dashboard; reusa el look de las KpiCard
 * (mismo chrome, tokens). Toda la lógica de datos vive en los hooks del
 * feature (`../hooks/`), acá solo está la presentación.
 */
export function BandaHoy() {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Hoy
      </h2>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiVentaDelDia />
        <KpiProyeccionCierre />
        <KpiOcupacion />
      </div>

      <PanelParaAtender />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Chrome compartido de las cards del día (espeja el de KpiCard del mes)
// ─────────────────────────────────────────────────────────────────────

function CardHoy({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Wallet;
  label: string;
  children: React.ReactNode;
}) {
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
      {children}
    </article>
  );
}

/** Monto grande (o skeleton / "—"). */
function MontoHoy({
  loading,
  valor,
}: {
  loading: boolean;
  valor: number | null;
}) {
  if (loading) {
    return <div className="mt-3 h-7 w-32 animate-pulse rounded bg-muted/50" />;
  }
  if (valor === null) {
    return (
      <p className="mt-3 text-2xl font-bold tabular-nums text-muted-foreground">
        —
      </p>
    );
  }
  return (
    <p className="mt-3 text-2xl font-bold tabular-nums leading-none text-foreground">
      {fmtMoney(valor)}
    </p>
  );
}

/** Área de nota inferior (misma altura que el comparativo del mes: h-4). */
function NotaHoy({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex h-4 items-center text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KPI 1 — Venta del día
// ─────────────────────────────────────────────────────────────────────

function KpiVentaDelDia() {
  const { ventaDelDia, isLoading } = useVentaDelDia();
  return (
    <CardHoy icon={DollarSign} label="Venta del día">
      <MontoHoy loading={isLoading} valor={ventaDelDia} />
      <NotaHoy>Cobrado hoy · todos los medios</NotaHoy>
    </CardHoy>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KPI 2 — Proyección de cierre
// ─────────────────────────────────────────────────────────────────────

function KpiProyeccionCierre() {
  const { proyeccion, saldoPendiente, isLoading } = useProyeccionCierreHoy();
  return (
    <CardHoy icon={Target} label="Proyección de cierre">
      <MontoHoy loading={isLoading} valor={proyeccion} />
      <NotaHoy>
        {!isLoading && saldoPendiente !== null && saldoPendiente > 0 ? (
          <span>
            <span className="font-medium tabular-nums text-foreground">
              + {fmtMoney(saldoPendiente)}
            </span>{' '}
            reservado por cobrar
          </span>
        ) : (
          'Cierre estimado del día'
        )}
      </NotaHoy>
    </CardHoy>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KPI 3 — Ocupación de canchas
// ─────────────────────────────────────────────────────────────────────

function KpiOcupacion() {
  const { resultado, isLoading } = useOcupacionHoy();

  return (
    <CardHoy icon={Gauge} label="Ocupación de canchas">
      {isLoading ? (
        <div className="mt-3 h-7 w-20 animate-pulse rounded bg-muted/50" />
      ) : resultado === null || resultado.porcentaje === null ? (
        <>
          <p className="mt-3 text-2xl font-bold tabular-nums text-muted-foreground">
            —
          </p>
          <div className="mt-3 flex h-4 items-center">
            <Link
              to="/configuracion/horarios"
              className="text-[11px] text-primary underline-offset-4 hover:underline"
            >
              Configurá el horario del club
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-2xl font-bold tabular-nums leading-none text-foreground">
            {Math.round(resultado.porcentaje)}%
          </p>
          <div className="mt-3 flex h-4 items-center">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.round(resultado.porcentaje)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-emerald-500/70 transition-all"
                style={{ width: `${Math.min(100, resultado.porcentaje)}%` }}
              />
            </div>
          </div>
        </>
      )}
    </CardHoy>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel "Para atender" — alarmas que solo aparecen si disparan
// ─────────────────────────────────────────────────────────────────────

type Severidad = 'rojo' | 'ambar';

function PanelParaAtender() {
  const turnosViejos = useTurnosAbiertosViejos();
  const cobro = useCobroPendienteHoy();
  const reponer = useProductosParaReponer();

  const cargando =
    turnosViejos.isLoading || cobro.isLoading || reponer.isLoading;

  const cantViejos = turnosViejos.data?.length ?? 0;
  const cobroRes = cobro.resultado;
  const productos = reponer.productos ?? [];
  const hayStockCero = productos.some((p) => p.severidad === 'rojo');

  const alarmas: AlarmaItem[] = [];
  if (cantViejos > 0) {
    alarmas.push({
      id: 'turnos-viejos',
      to: '/reservas',
      severidad: 'rojo',
      icon: Clock,
      titulo: `${cantViejos} ${
        cantViejos === 1 ? 'turno sin cerrar' : 'turnos sin cerrar'
      } de días anteriores`,
      detalle: null,
    });
  }
  if (cobroRes && cobroRes.cantidad > 0) {
    alarmas.push({
      id: 'cobro-pendiente',
      to: '/reservas',
      severidad: 'ambar',
      icon: Wallet,
      titulo: `${cobroRes.cantidad} ${
        cobroRes.cantidad === 1 ? 'turno de hoy' : 'turnos de hoy'
      } con cobro pendiente`,
      detalle: fmtMoney(cobroRes.total),
    });
  }
  if (productos.length > 0) {
    alarmas.push({
      id: 'reponer',
      to: '/inventario?tab=reposicion',
      severidad: hayStockCero ? 'rojo' : 'ambar',
      icon: PackageX,
      titulo: `${productos.length} ${
        productos.length === 1 ? 'producto para reponer' : 'productos para reponer'
      }`,
      detalle: null,
    });
  }

  // Mientras carga, un placeholder fino (evita el pop-in del panel).
  if (cargando) {
    return (
      <div
        aria-busy="true"
        className="h-12 animate-pulse rounded-lg border border-border bg-muted/30"
      />
    );
  }

  // Todo en cero → estado "al día" (elegante, no se oculta el espacio).
  if (alarmas.length === 0) {
    return (
      <article className="flex items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
        Todo al día
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-border bg-card p-2">
      <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Para atender
      </p>
      <div className="space-y-0.5">
        {alarmas.map((a) => (
          <AlarmaLinea key={a.id} {...a} />
        ))}
      </div>
    </article>
  );
}

interface AlarmaItem {
  id: string;
  to: string;
  severidad: Severidad;
  icon: typeof Clock;
  titulo: string;
  /** Monto o número a la derecha; null si no aplica. */
  detalle: string | null;
}

function AlarmaLinea({ to, severidad, icon: Icon, titulo, detalle }: AlarmaItem) {
  const dot = severidad === 'rojo' ? 'bg-red-500' : 'bg-amber-500';
  const iconColor =
    severidad === 'rojo'
      ? 'text-red-600 dark:text-red-500'
      : 'text-amber-600 dark:text-amber-500';

  return (
    <Link
      to={to}
      className="group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', dot)} />
      <Icon className={cn('h-4 w-4 shrink-0', iconColor)} aria-hidden="true" />
      <span className="flex-1 text-sm text-foreground">{titulo}</span>
      {detalle && (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
          {detalle}
        </span>
      )}
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
