import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NuevoGastoDialog } from './NuevoGastoDialog';
import { NuevoOtroIngresoDialog } from './NuevoOtroIngresoDialog';
import { useResumenFinanciero } from './hooks/useResumenFinanciero';
import { EERRHeroKpis } from './EERRHeroKpis';
import { EERRChartsRow } from './EERRChartsRow';
import { EERRTable, type DrillKey } from './EERRTable';
import { DrillDownPanel } from './DrillDownPanel';

const mesFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
});

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/**
 * Hub financiero del club — EERR corporativo en cascada.
 *
 * Layout alineado con el dashboard:
 *   - Hero limpio (título + mes + fecha completa).
 *   - 4 KPI cards hero (Ingresos / Egresos / Margen bruto % / Resultado).
 *   - 2 gráficos lado-a-lado (Ingresos por unidad / Top categorías).
 *   - Tabla EERR cascada con comparativo + drill-down.
 *
 * Sólo lectura — los botones "Gasto" / "Ingreso" abren los dialogs de
 * carga manual existentes (sin tocar).
 */
export function FinanzasPage() {
  const ahora = new Date();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [gastoOpen, setGastoOpen] = useState(false);
  const [ingresoOpen, setIngresoOpen] = useState(false);

  // Comparativo: hook actual + mes anterior.
  const queryActual = useResumenFinanciero(anio, mes);
  const { anio: anioAnt, mes: mesAnt } = mesAnterior(anio, mes);
  const queryAnterior = useResumenFinanciero(anioAnt, mesAnt);

  // Drill-down: qué línea está abierta. Cierra a null.
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);

  function navMes(delta: number): void {
    let nuevoMes = mes + delta;
    let nuevoAnio = anio;
    if (nuevoMes < 1) {
      nuevoMes = 12;
      nuevoAnio -= 1;
    } else if (nuevoMes > 12) {
      nuevoMes = 1;
      nuevoAnio += 1;
    }
    setMes(nuevoMes);
    setAnio(nuevoAnio);
    setDrillKey(null);
  }

  const mesLabel = useMemo(() => {
    const d = new Date(anio, mes - 1, 1);
    const s = mesFmt.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [anio, mes]);

  const fechaHoyTxt = useMemo(() => {
    const s = fechaCortaFmt.format(ahora);
    return s.charAt(0).toUpperCase() + s.slice(1);
    // ahora capturado al mount; el dashboard hace lo mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const esMesActual = anio === ahora.getFullYear() && mes === ahora.getMonth() + 1;

  return (
    <div className="space-y-6">
      {/* ── Hero (estilo dashboard) ───────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Estado de Resultados
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {mesLabel}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {fechaHoyTxt}
          </p>
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIngresoOpen(true)}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Ingreso
          </Button>
          <Button type="button" size="sm" onClick={() => setGastoOpen(true)}>
            <TrendingDown className="h-3.5 w-3.5" />
            Gasto
          </Button>
        </div>
      </header>

      {queryActual.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Calculando estado de resultados…
        </div>
      )}

      {queryActual.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {queryActual.error.message}
        </div>
      )}

      {queryActual.data && (
        <>
          {/* ── KPIs hero (4 cards) ─────────────────────────────────── */}
          <EERRHeroKpis
            actual={queryActual.data}
            anterior={queryAnterior.data ?? null}
            loading={queryActual.isLoading || queryAnterior.isLoading}
          />

          {/* ── Gráficos (2 columnas, estilo dashboard) ─────────────── */}
          <EERRChartsRow resumen={queryActual.data} anio={anio} mes={mes} />

          {/* ── Tabla EERR con comparativo + drill ──────────────────── */}
          <EERRTable
            actual={queryActual.data}
            anterior={queryAnterior.data ?? null}
            onDrill={(k) => setDrillKey(k)}
          />
        </>
      )}

      <DrillDownPanel
        open={drillKey !== null}
        drillKey={drillKey}
        resumen={queryActual.data ?? null}
        onClose={() => setDrillKey(null)}
      />

      <NuevoGastoDialog open={gastoOpen} onOpenChange={setGastoOpen} />
      <NuevoOtroIngresoDialog open={ingresoOpen} onOpenChange={setIngresoOpen} />
    </div>
  );
}
