import { useMemo } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Layers,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResumenFinanciero } from './hooks/useResumenFinanciero';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

interface EERRHeroKpisProps {
  actual: ResumenFinanciero | null;
  anterior: ResumenFinanciero | null;
  loading: boolean;
}

/**
 * Hero de 4 KPI cards del EERR, alineado con el lenguaje visual del
 * dashboard (mismo layout, tipografía, manejo de comparativo):
 *   1. Ingresos del mes
 *   2. Costos + gastos (egresos totales)
 *   3. Margen bruto %
 *   4. Resultado neto
 *
 * Cada card muestra valor + comparativo con mes anterior (verde/rojo
 * según si la dirección es buena para esa métrica).
 */
export function EERRHeroKpis({ actual, anterior, loading }: EERRHeroKpisProps) {
  const egresosActual = actual
    ? actual.costos_directos + actual.gastos_total
    : null;
  const egresosAnterior = anterior
    ? anterior.costos_directos + anterior.gastos_total
    : null;

  const margenActual =
    actual && actual.ingresos_total > 0
      ? (actual.margen_bruto / actual.ingresos_total) * 100
      : null;
  const margenAnterior =
    anterior && anterior.ingresos_total > 0
      ? (anterior.margen_bruto / anterior.ingresos_total) * 100
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
        label="Costos + Gastos"
        valor={egresosActual}
        valorAnterior={egresosAnterior}
        signoVerde="negativo"
        loading={loading}
      />
      <KpiCard
        icon={Layers}
        label="Margen bruto"
        valor={margenActual}
        valorAnterior={margenAnterior}
        signoVerde="positivo"
        formatoValor="porcentaje"
        formatoComparativo="pp"
        loading={loading}
      />
      <KpiCard
        icon={Activity}
        label="Resultado neto"
        valor={actual?.resultado_neto ?? null}
        valorAnterior={anterior?.resultado_neto ?? null}
        signoVerde="positivo"
        resaltarSignoDelMonto
        loading={loading}
      />
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  valor: number | null;
  valorAnterior: number | null;
  signoVerde: 'positivo' | 'negativo';
  /** 'moneda' (default) o 'porcentaje' (sufijo %). */
  formatoValor?: 'moneda' | 'porcentaje';
  /** 'pct' (default, X%) o 'pp' (puntos porcentuales para margen). */
  formatoComparativo?: 'pct' | 'pp';
  /** Si TRUE, el valor se colorea según su signo (típico de "resultado"). */
  resaltarSignoDelMonto?: boolean;
  loading: boolean;
}

function KpiCard({
  icon: Icon,
  label,
  valor,
  valorAnterior,
  signoVerde,
  formatoValor = 'moneda',
  formatoComparativo = 'pct',
  resaltarSignoDelMonto,
  loading,
}: KpiCardProps) {
  const variacion = useMemo(() => {
    if (valor === null || valorAnterior === null) return null;
    if (formatoComparativo === 'pp') {
      // Para %, la "variación" es la diferencia absoluta en puntos %.
      return valor - valorAnterior;
    }
    if (valorAnterior === 0) return null;
    return ((valor - valorAnterior) / Math.abs(valorAnterior)) * 100;
  }, [valor, valorAnterior, formatoComparativo]);

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

  function formatValor(n: number): string {
    if (formatoValor === 'porcentaje') {
      return `${n.toFixed(1)}%`;
    }
    return fmtMoney(n);
  }

  function formatVar(n: number): string {
    const signo = n >= 0 ? '+' : '';
    if (formatoComparativo === 'pp') {
      return `${signo}${n.toFixed(1)} pp`;
    }
    return `${signo}${n.toFixed(1)}%`;
  }

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
          {formatValor(valor)}
        </p>
      )}

      <div className="mt-3 h-4">
        {!loading && variacion !== null && (
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
            {formatVar(variacion)} vs mes anterior
          </p>
        )}
      </div>
    </article>
  );
}
