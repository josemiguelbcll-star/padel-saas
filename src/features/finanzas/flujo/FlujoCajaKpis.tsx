import {
  ArrowDownRight,
  ArrowUpRight,
  LineChart,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { etiquetaPeriodo, type Granularidad } from '../utils/clavePeriodo';
import type { ResumenFlujo } from '../utils/resumenFlujo';

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
function fmtCompact(n: number): string {
  return moneyCompact.format(Math.round(n));
}
function fmtSigned(n: number): string {
  if (Math.round(n) === 0) return '$0';
  return `${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`;
}

interface FlujoCajaKpisProps {
  resumen: ResumenFlujo | null;
  loading: boolean;
  granularidad: Granularidad;
}

/**
 * Hero de 4 KPIs del flujo de caja, alineado con EERRHeroKpis:
 *   1. Saldo hoy (real)            2. Saldo proyectado (fin del horizonte)
 *   3. Variación proyectada        4. Liquidez (alerta: si/cuándo va a rojo)
 * La card de Liquidez es el insight protagonista: acento rojo si hay riesgo,
 * verde si no.
 */
export function FlujoCajaKpis({ resumen, loading, granularidad }: FlujoCajaKpisProps) {
  const r = resumen;
  const enRojo = r?.primerNegativo != null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={Wallet}
        label="Saldo hoy"
        loading={loading}
        valor={r?.saldoHoy ?? null}
        sub="Saldo real a hoy"
        colorearSigno
      />
      <KpiCard
        icon={LineChart}
        label="Saldo proyectado"
        loading={loading}
        valor={r?.saldoProyFin ?? null}
        sub={
          r?.finPeriodo
            ? `Proyectado a ${etiquetaPeriodo(r.finPeriodo, granularidad)}`
            : 'Fin del horizonte'
        }
        colorearSigno
      />
      <KpiCard
        icon={r && r.netoHorizonte >= 0 ? ArrowUpRight : ArrowDownRight}
        label="Variación proyectada"
        loading={loading}
        valorTexto={r ? fmtSigned(r.netoHorizonte) : null}
        valorClase={
          !r || Math.round(r.netoHorizonte) === 0
            ? 'text-foreground'
            : r.netoHorizonte > 0
              ? 'text-emerald-600 dark:text-emerald-500'
              : 'text-red-600 dark:text-red-500'
        }
        sub="En el horizonte proyectado"
      />

      {/* Liquidez — el insight protagonista. */}
      <KpiCard
        icon={enRojo ? ShieldAlert : ShieldCheck}
        label="Liquidez"
        loading={loading}
        acento={enRojo ? 'danger' : 'ok'}
        valorTexto={r ? (enRojo ? 'En rojo' : 'Sin riesgo') : null}
        valorClase={
          enRojo
            ? 'text-red-600 dark:text-red-500'
            : 'text-emerald-600 dark:text-emerald-500'
        }
        sub={
          !r
            ? ''
            : enRojo
              ? `Desde ${etiquetaPeriodo(r.primerNegativo as string, granularidad)} · piso ${
                  r.minSaldo != null ? fmtCompact(r.minSaldo) : '—'
                }`
              : r.minSaldo != null && r.minPeriodo
                ? `Piso ${fmtCompact(r.minSaldo)} en ${etiquetaPeriodo(r.minPeriodo, granularidad)}`
                : 'Sin riesgo en el horizonte'
        }
      />
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  loading: boolean;
  /** Valor monetario (se formatea en $). Usar este O valorTexto. */
  valor?: number | null;
  /** Valor ya formateado (texto libre). */
  valorTexto?: string | null;
  /** Clase de color del valor cuando se usa valorTexto. */
  valorClase?: string;
  /** Si TRUE (con `valor`), colorea negativo en rojo. */
  colorearSigno?: boolean;
  sub?: string;
  /** Acento de la card (borde + tinte de fondo). */
  acento?: 'none' | 'danger' | 'ok';
}

function KpiCard({
  icon: Icon,
  label,
  loading,
  valor,
  valorTexto,
  valorClase,
  colorearSigno,
  sub,
  acento = 'none',
}: KpiCardProps) {
  const tieneValor = valorTexto != null || (valor != null);

  const colorMonto =
    valorClase ??
    (colorearSigno && valor != null && valor < 0
      ? 'text-red-600 dark:text-red-500'
      : 'text-foreground');

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-card p-4 transition-colors',
        acento === 'danger'
          ? 'border-red-500/40 bg-red-500/[0.04]'
          : acento === 'ok'
            ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
            : 'border-border hover:border-foreground/20',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            acento === 'danger'
              ? 'text-red-500/70'
              : acento === 'ok'
                ? 'text-emerald-500/70'
                : 'text-muted-foreground/60',
          )}
          aria-hidden="true"
        />
      </div>

      {loading ? (
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-muted/50" />
      ) : !tieneValor ? (
        <p className="mt-3 text-2xl font-bold tabular-nums leading-none text-muted-foreground">
          —
        </p>
      ) : (
        <p className={cn('mt-3 text-2xl font-bold tabular-nums leading-none', colorMonto)}>
          {valorTexto != null ? valorTexto : fmtMoney(valor as number)}
        </p>
      )}

      <div className="mt-2 h-4">
        {!loading && sub ? (
          <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
        ) : null}
      </div>
    </article>
  );
}
