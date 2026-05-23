import { ChevronRight } from 'lucide-react';
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

function variacionPct(actual: number, anterior: number): number | null {
  if (anterior === 0) return actual === 0 ? 0 : null;
  return ((actual - anterior) / Math.abs(anterior)) * 100;
}

/** Identificador de la línea seleccionable para drill-down. */
export type DrillKey =
  | 'ingresos'
  | 'costos_directos'
  | 'gastos_directos'
  | 'gastos_estructura'
  | 'gastos_financieros'
  | 'gastos_otros'
  // Sub-líneas por unidad de ingreso (drill desde Ingresos):
  | 'ingreso_canchas'
  | 'ingreso_clases'
  | 'ingreso_buffet'
  | 'ingreso_shop';

interface EERRTableProps {
  actual: ResumenFinanciero;
  anterior: ResumenFinanciero | null;
  onDrill: (key: DrillKey) => void;
}

/**
 * Tabla EERR corporativo con estructura en cascada:
 *
 *   Ingresos operativos
 *     ↳ Canchas / Clases / Buffet / Shop
 *   − Costos directos
 *   − Gastos directos
 *   = Margen bruto
 *   − Gastos de estructura
 *   = Resultado operativo (≈ EBITDA)
 *   − Resultados financieros (siempre visible)
 *   − Otros (oculto si 0)
 *   = Resultado neto
 *
 * Cada línea con detalle disponible muestra un chevron al hover.
 * Las líneas calculadas (subtotales) NO son clickeables.
 */
export function EERRTable({ actual, anterior, onDrill }: EERRTableProps) {
  // Sub-totales por unidad de ingreso (lookup por tipo).
  const ingresoPorTipo = (tipo: string, src: ResumenFinanciero | null): number =>
    src?.ingresos_por_unidad
      .filter((u) => u.tipo === tipo)
      .reduce((acc, u) => acc + u.monto, 0) ?? 0;

  const ingCanchas = ingresoPorTipo('canchas', actual);
  const ingClases = ingresoPorTipo('clases', actual);
  const ingBuffet = ingresoPorTipo('buffet', actual);
  const ingShop = ingresoPorTipo('shop', actual);

  const ingCanchasAnt = ingresoPorTipo('canchas', anterior);
  const ingClasesAnt = ingresoPorTipo('clases', anterior);
  const ingBuffetAnt = ingresoPorTipo('buffet', anterior);
  const ingShopAnt = ingresoPorTipo('shop', anterior);

  return (
    <article className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Cascada del EERR
          </h2>
          <p className="text-xs text-muted-foreground">
            Click en cada línea para ver detalle
          </p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-2 text-left font-semibold">Concepto</th>
              <th className="px-3 py-2 text-right font-semibold">Mes actual</th>
              <th className="px-3 py-2 text-right font-semibold">Mes anterior</th>
              <th className="px-3 py-2 pr-5 text-right font-semibold">Var.</th>
              <th className="w-4 px-0 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {/* ── Ingresos operativos ───────────────────────────────── */}
            <FilaConcepto
              label="Ingresos operativos"
              actual={actual.ingresos_total}
              anterior={anterior?.ingresos_total ?? null}
              signoBueno="positivo"
              onDrill={() => onDrill('ingresos')}
              nivel="cabecera"
            />
            <FilaConcepto
              label="Canchas"
              actual={ingCanchas}
              anterior={anterior ? ingCanchasAnt : null}
              signoBueno="positivo"
              onDrill={() => onDrill('ingreso_canchas')}
              nivel="detalle"
              ocultarSiCero
            />
            <FilaConcepto
              label="Clases"
              actual={ingClases}
              anterior={anterior ? ingClasesAnt : null}
              signoBueno="positivo"
              onDrill={() => onDrill('ingreso_clases')}
              nivel="detalle"
              ocultarSiCero
            />
            <FilaConcepto
              label="Buffet"
              actual={ingBuffet}
              anterior={anterior ? ingBuffetAnt : null}
              signoBueno="positivo"
              onDrill={() => onDrill('ingreso_buffet')}
              nivel="detalle"
              ocultarSiCero
            />
            <FilaConcepto
              label="Shop"
              actual={ingShop}
              anterior={anterior ? ingShopAnt : null}
              signoBueno="positivo"
              onDrill={() => onDrill('ingreso_shop')}
              nivel="detalle"
              ocultarSiCero
            />

            {/* ── Costos y gastos directos ──────────────────────────── */}
            <FilaConcepto
              label="− Costos directos (mercadería)"
              actual={-actual.costos_directos}
              anterior={anterior ? -anterior.costos_directos : null}
              signoBueno="negativo"
              onDrill={() => onDrill('costos_directos')}
              nivel="resta"
              ocultarSiCero
            />
            <FilaConcepto
              label="− Gastos directos"
              actual={-actual.gastos_operativos}
              anterior={anterior ? -anterior.gastos_operativos : null}
              signoBueno="negativo"
              onDrill={() => onDrill('gastos_directos')}
              nivel="resta"
              ocultarSiCero
            />

            {/* ── Margen bruto ──────────────────────────────────────── */}
            <FilaSubtotal
              label="MARGEN BRUTO"
              actual={actual.margen_bruto}
              anterior={anterior?.margen_bruto ?? null}
              signoBueno="positivo"
            />

            {/* ── Gastos de estructura ──────────────────────────────── */}
            <FilaConcepto
              label="− Gastos de estructura"
              actual={-actual.gastos_estructura}
              anterior={anterior ? -anterior.gastos_estructura : null}
              signoBueno="negativo"
              onDrill={() => onDrill('gastos_estructura')}
              nivel="resta"
              ocultarSiCero
            />

            {/* ── Resultado operativo (EBITDA) ──────────────────────── */}
            <FilaSubtotal
              label="RESULTADO OPERATIVO (≈ EBITDA)"
              actual={actual.resultado_operativo}
              anterior={anterior?.resultado_operativo ?? null}
              signoBueno="positivo"
            />

            {/* ── Resultados financieros (SIEMPRE visible) ──────────── */}
            <FilaConcepto
              label="− Resultados financieros"
              actual={-actual.gastos_financieros}
              anterior={anterior ? -anterior.gastos_financieros : null}
              signoBueno="negativo"
              onDrill={() => onDrill('gastos_financieros')}
              nivel="resta"
              // NO ocultarSiCero: línea estructural del EERR.
            />

            {/* ── Otros (oculta si 0) ───────────────────────────────── */}
            <FilaConcepto
              label="− Otros"
              actual={-actual.gastos_otros}
              anterior={anterior ? -anterior.gastos_otros : null}
              signoBueno="negativo"
              onDrill={() => onDrill('gastos_otros')}
              nivel="resta"
              ocultarSiCero
            />

            {/* ── Resultado neto ────────────────────────────────────── */}
            <FilaSubtotal
              label="RESULTADO NETO"
              actual={actual.resultado_neto}
              anterior={anterior?.resultado_neto ?? null}
              signoBueno="positivo"
              destacarFuerte
            />
          </tbody>
        </table>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Filas
// ─────────────────────────────────────────────────────────────────────

interface FilaConceptoProps {
  label: string;
  actual: number;
  anterior: number | null;
  signoBueno: 'positivo' | 'negativo';
  onDrill?: () => void;
  nivel: 'cabecera' | 'detalle' | 'resta';
  ocultarSiCero?: boolean;
}

function FilaConcepto({
  label,
  actual,
  anterior,
  signoBueno,
  onDrill,
  nivel,
  ocultarSiCero,
}: FilaConceptoProps) {
  // Decisión de ocultar: si el actual Y el anterior son 0, no aporta info.
  if (ocultarSiCero && Math.abs(actual) < 0.005 && (anterior === null || Math.abs(anterior) < 0.005)) {
    return null;
  }

  const variacion =
    anterior !== null ? variacionPct(actual, anterior) : null;
  const variacionBuena =
    variacion === null
      ? null
      : signoBueno === 'positivo'
        ? variacion >= 0
        : variacion <= 0;

  const indentClass = nivel === 'detalle' ? 'pl-10' : 'pl-5';
  const labelClass =
    nivel === 'cabecera'
      ? 'font-semibold text-foreground'
      : nivel === 'detalle'
        ? 'text-muted-foreground'
        : 'text-foreground';
  const valorClass = nivel === 'detalle' ? 'text-muted-foreground' : 'text-foreground';
  const clickable = !!onDrill;

  return (
    <tr
      className={cn(
        'border-b border-border/50 last:border-b-0',
        clickable && 'group cursor-pointer transition-colors hover:bg-muted/30',
      )}
      onClick={clickable ? onDrill : undefined}
    >
      <td className={cn('py-2.5 pr-3 text-sm', indentClass, labelClass)}>
        {label}
      </td>
      <td className={cn('px-3 py-2.5 text-right tabular-nums', valorClass)}>
        {fmtMoney(actual)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
        {anterior === null ? '—' : fmtMoney(anterior)}
      </td>
      <td className="px-3 py-2.5 pr-5 text-right">
        {variacion === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              'text-xs font-medium tabular-nums',
              variacionBuena
                ? 'text-emerald-600 dark:text-emerald-500'
                : 'text-red-600 dark:text-red-500',
            )}
          >
            {variacion >= 0 ? '+' : ''}
            {variacion.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="w-4 px-0 py-2.5">
        {clickable && (
          <ChevronRight
            className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        )}
      </td>
    </tr>
  );
}

interface FilaSubtotalProps {
  label: string;
  actual: number;
  anterior: number | null;
  signoBueno: 'positivo' | 'negativo';
  destacarFuerte?: boolean;
}

function FilaSubtotal({
  label,
  actual,
  anterior,
  signoBueno,
  destacarFuerte,
}: FilaSubtotalProps) {
  const variacion =
    anterior !== null ? variacionPct(actual, anterior) : null;
  const variacionBuena =
    variacion === null
      ? null
      : signoBueno === 'positivo'
        ? variacion >= 0
        : variacion <= 0;

  const colorMonto =
    actual >= 0
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-red-700 dark:text-red-400';

  return (
    <tr
      className={cn(
        'border-y-2 border-border bg-muted/40',
        destacarFuerte && 'border-y-4 border-foreground/20 bg-muted/60',
      )}
    >
      <td className={cn(
        'py-3 pl-5 pr-3 text-[11px] font-bold uppercase tracking-wider text-foreground',
        destacarFuerte && 'text-[12px]',
      )}>
        = {label}
      </td>
      <td className={cn(
        'px-3 py-3 text-right text-base font-bold tabular-nums',
        colorMonto,
        destacarFuerte && 'text-lg',
      )}>
        {fmtMoney(actual)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-xs text-muted-foreground">
        {anterior === null ? '—' : fmtMoney(anterior)}
      </td>
      <td className="px-3 py-3 pr-5 text-right">
        {variacion === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span
            className={cn(
              'text-xs font-semibold tabular-nums',
              variacionBuena
                ? 'text-emerald-600 dark:text-emerald-500'
                : 'text-red-600 dark:text-red-500',
            )}
          >
            {variacion >= 0 ? '+' : ''}
            {variacion.toFixed(1)}%
          </span>
        )}
      </td>
      <td className="w-4 px-0 py-3"></td>
    </tr>
  );
}
