import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { hoyISO, type Granularidad } from '../utils/clavePeriodo';
import { combinarFlujo } from '../utils/combinarFlujo';
import { useFlujoCaja } from '../hooks/useFlujoCaja';
import { useFlujoProyectado } from '../hooks/useFlujoProyectado';
import { FlujoCajaTable } from './FlujoCajaTable';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
function fmtMoney(n: number): string {
  return money.format(Math.round(n));
}

const GRANS: ReadonlyArray<{ v: Granularidad; label: string }> = [
  { v: 'day', label: 'Día' },
  { v: 'week', label: 'Semana' },
  { v: 'month', label: 'Mes' },
];

function parseLocal(iso: string): Date {
  const p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const mesAnioFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
const mesFmt = new Intl.DateTimeFormat('es-AR', { month: 'long' });

/**
 * Ventana del flujo a partir de un mes ancla. Horizonte por granularidad para
 * mantener la tabla legible: mes = ancla + 3 (4 meses); semana = 2 meses;
 * día = 1 mes. desde = 1° del mes ancla; hasta = último día del último mes.
 */
function rangoDeAncla(
  anio: number,
  mes: number,
  gran: Granularidad,
): { desde: string; hasta: string } {
  const horizonMeses = gran === 'month' ? 4 : gran === 'week' ? 2 : 1;
  const fin = new Date(anio, mes - 1 + horizonMeses, 0); // último día del último mes
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { desde: `${anio}-${String(mes).padStart(2, '0')}-01`, hasta: fmt(fin) };
}

/**
 * Pantalla de FLUJO DE CAJA (tabla). Combina el flujo REAL (useFlujoCaja /
 * fn_flujo_caja, percibido) con el PROYECTADO (useFlujoProyectado) vía
 * combinarFlujo: pasado/actual reales, futuro proyectado encadenado desde el
 * saldo real de hoy. Real sólido / proyectado punteado-translúcido — nunca
 * mezclados. Los gráficos (curva de saldo + waterfall) van en una etapa aparte.
 */
export function FlujoCajaPage() {
  const ahora = useMemo(() => new Date(), []);
  const [anclaAnio, setAnclaAnio] = useState(ahora.getFullYear());
  const [anclaMes, setAnclaMes] = useState(ahora.getMonth() + 1);
  const [gran, setGran] = useState<Granularidad>('month');

  const { desde, hasta } = useMemo(
    () => rangoDeAncla(anclaAnio, anclaMes, gran),
    [anclaAnio, anclaMes, gran],
  );
  const hoy = useMemo(() => hoyISO(), []);

  const realQuery = useFlujoCaja(desde, hasta, gran);
  const proy = useFlujoProyectado(desde, hasta, gran);

  const combinado = useMemo(() => {
    if (!realQuery.data || !proy.data) return null;
    return combinarFlujo({
      real: realQuery.data,
      proyectado: proy.data,
      granularidad: gran,
      hoy,
    });
  }, [realQuery.data, proy.data, gran, hoy]);

  const loading = realQuery.isLoading || proy.isLoading;
  const error = realQuery.error ?? proy.error;

  function navAncla(delta: number): void {
    let m = anclaMes + delta;
    let a = anclaAnio;
    if (m < 1) {
      m = 12;
      a -= 1;
    } else if (m > 12) {
      m = 1;
      a += 1;
    }
    setAnclaMes(m);
    setAnclaAnio(a);
  }

  function irHoy(): void {
    setAnclaAnio(ahora.getFullYear());
    setAnclaMes(ahora.getMonth() + 1);
  }

  const esAnclaActual =
    anclaAnio === ahora.getFullYear() && anclaMes === ahora.getMonth() + 1;

  const rangoLabel = useMemo(() => {
    const d1 = parseLocal(desde);
    const d2 = parseLocal(hasta);
    const fin = cap(mesAnioFmt.format(d2));
    if (d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()) {
      return fin;
    }
    return `${cap(mesFmt.format(d1))} – ${fin}`;
  }, [desde, hasta]);

  return (
    <div className="space-y-6">
      {/* ── Hero (estilo EERR) ───────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Flujo de caja
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {rangoLabel}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de granularidad */}
          <div className="inline-flex overflow-hidden rounded-md border border-border bg-card">
            {GRANS.map((g) => (
              <button
                key={g.v}
                type="button"
                onClick={() => setGran(g.v)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  g.v !== 'day' && 'border-l border-border',
                  gran === g.v
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                aria-pressed={gran === g.v}
              >
                {g.label}
              </button>
            ))}
          </div>

          {/* Navegación de rango */}
          <div className="inline-flex overflow-hidden rounded-md border border-border bg-card">
            <button
              type="button"
              onClick={() => navAncla(-1)}
              className="px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Período anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navAncla(1)}
              className="border-l border-border px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Período siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={irHoy}
            disabled={esAnclaActual}
          >
            Hoy
          </Button>
        </div>
      </header>

      {loading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Calculando flujo de caja…
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error.message}
        </div>
      )}

      {combinado && !loading && !error && (
        <>
          <FlujoCajaTable combinado={combinado} granularidad={gran} />

          {/* Aviso: proyección de ingresos aproximada en día/semana. */}
          {combinado.ingresosAproximados && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                En esta vista la proyección de <strong>ingresos</strong> es
                aproximada (solo reservas ya materializadas a futuro). Para la
                proyección completa de ingresos, mirá la vista{' '}
                <strong>Mensual</strong>.
              </p>
            </div>
          )}

          {/* Vencido: compromisos con vencimiento pasado, aún pendientes. */}
          {combinado.vencido > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden="true"
              />
              <p className="text-foreground">
                <strong>Vencido: {fmtMoney(combinado.vencido)}</strong> — cuotas
                u órdenes a plazo con vencimiento ya pasado y aún sin pagar. Está
                sumado al primer período de la curva.
              </p>
            </div>
          )}

          {/* Compromisos sin fecha — informativos, FUERA de la curva. */}
          {(combinado.sinFecha.cuotasSinVencimiento > 0 ||
            combinado.sinFecha.ocPendientes > 0) && (
            <div className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground">
                  Compromisos sin fecha
                </h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                No tienen fecha comprometida, así que NO entran en la curva del
                saldo (no la "ensucian" con fechas inventadas).
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                {combinado.sinFecha.cuotasSinVencimiento > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      Cuotas sin vencimiento
                    </dt>
                    <dd className="tabular-nums text-foreground">
                      {fmtMoney(combinado.sinFecha.cuotasSinVencimiento)}
                    </dd>
                  </div>
                )}
                {combinado.sinFecha.ocPendientes > 0 && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">
                      Órdenes de compra por recibir
                    </dt>
                    <dd className="tabular-nums text-foreground">
                      {fmtMoney(combinado.sinFecha.ocPendientes)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </>
      )}
    </div>
  );
}
