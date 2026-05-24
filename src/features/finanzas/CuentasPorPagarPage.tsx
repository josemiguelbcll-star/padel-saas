import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CircleDashed,
  History,
  Receipt,
  Repeat,
  Wallet,
  X,
} from 'lucide-react';
import type { MotivoAnulacionTipo } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useCajaAbierta } from '@/features/caja/hooks/useCajaAbierta';
import {
  useCuentasPorPagar,
  usePagosCuotaRecientes,
  type CuentaPorPagarFila,
  type PagoCuotaReciente,
} from './hooks/useCuentasPorPagar';
import { useAnularPagoCuota } from './hooks/useAnulaciones';
import { AnularDialog } from './AnularDialog';
import { PagarCuotaDialog } from './PagarCuotaDialog';
import { MEDIO_PAGO_LABEL } from './finanzasSchemas';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
});

function fmtDateShort(iso: string): string {
  return dateFmt.format(new Date(iso + 'T00:00:00'));
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function lastDayOfMonthISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  // Día 0 del mes siguiente = último día del mes actual.
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const y = last.getFullYear();
  const m = String(last.getMonth() + 1).padStart(2, '0');
  const day = String(last.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─────────────────────────────────────────────────────────────────────
// Aging buckets
// ─────────────────────────────────────────────────────────────────────

type Bucket = 'vencido' | 'esta_semana' | 'este_mes' | 'mas_adelante' | 'sin_fecha';

interface BucketDef {
  key: Bucket;
  label: string;
  icon: typeof AlertTriangle;
  description: string;
  /** Clases del card del bucket header. */
  toneClass: string;
  /** Si la fila debe llamar la atención (rojo en monto, etc.). */
  urgent: boolean;
}

const BUCKETS: ReadonlyArray<BucketDef> = [
  {
    key: 'vencido',
    label: 'Vencido',
    icon: AlertTriangle,
    description: 'Cuotas con fecha de vencimiento pasada',
    toneClass: 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400',
    urgent: true,
  },
  {
    key: 'esta_semana',
    label: 'Vence esta semana',
    icon: CalendarClock,
    description: 'Cuotas que vencen en los próximos 7 días',
    toneClass:
      'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
    urgent: true,
  },
  {
    key: 'este_mes',
    label: 'Vence este mes',
    icon: CalendarDays,
    description: 'Cuotas que vencen del 8vo día en adelante, dentro del mes',
    toneClass: 'border-border bg-card text-foreground',
    urgent: false,
  },
  {
    key: 'mas_adelante',
    label: 'Más adelante',
    icon: CalendarRange,
    description: 'Cuotas que vencen el próximo mes o después',
    toneClass: 'border-border bg-card text-muted-foreground',
    urgent: false,
  },
  {
    key: 'sin_fecha',
    label: 'Sin fecha',
    icon: CircleDashed,
    description:
      'Cuotas sin vencimiento explícito (gastos legacy o ABM sin fecha)',
    toneClass: 'border-dashed border-border bg-muted/20 text-muted-foreground',
    urgent: false,
  },
];

function clasificar(
  cuota: CuentaPorPagarFila,
  hoy: string,
  finMes: string,
  enUnaSemana: string,
): Bucket {
  if (cuota.fecha_vencimiento === null) return 'sin_fecha';
  if (cuota.fecha_vencimiento < hoy) return 'vencido';
  if (cuota.fecha_vencimiento <= enUnaSemana) return 'esta_semana';
  if (cuota.fecha_vencimiento <= finMes) return 'este_mes';
  return 'mas_adelante';
}

// ─────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────

export function CuentasPorPagarPage() {
  const query = useCuentasPorPagar();
  const pagosQuery = usePagosCuotaRecientes();
  const cajaQuery = useCajaAbierta();
  const anularPago = useAnularPagoCuota();

  const [proveedorFiltro, setProveedorFiltro] = useState<string>('todos');
  const [soloVencidas, setSoloVencidas] = useState(false);
  const [cuotaSeleccionada, setCuotaSeleccionada] =
    useState<CuentaPorPagarFila | null>(null);
  const [pagoAAnular, setPagoAAnular] = useState<PagoCuotaReciente | null>(null);
  const [anularError, setAnularError] = useState<string | null>(null);
  const [ajusteMsg, setAjusteMsg] = useState<string | null>(null);

  async function handleAnularPagoConfirm(
    motivoTipo: MotivoAnulacionTipo,
    motivoDetalle: string | null,
  ): Promise<void> {
    if (!pagoAAnular) return;
    setAnularError(null);
    try {
      const anulacion = await anularPago.mutateAsync({
        cuota_id: pagoAAnular.id,
        motivo_tipo: motivoTipo,
        motivo_detalle: motivoDetalle,
        turnoCajaIdParaInvalidate: cajaQuery.data?.id ?? null,
      });
      setPagoAAnular(null);
      // Si el pago era efectivo de una caja ya cerrada, la RPC registró
      // un ajuste en la caja de hoy — avisamos.
      setAjusteMsg(
        anulacion.caja_movimiento_id !== null
          ? 'Se registró un ajuste positivo en la caja de hoy para compensar el pago en efectivo de una caja ya cerrada.'
          : null,
      );
    } catch (err) {
      setAnularError(
        err instanceof Error ? err.message : 'No pudimos anular el pago.',
      );
    }
  }

  const cuotas = query.data ?? [];

  // Fechas de referencia para clasificar.
  const hoy = todayISO();
  const enUnaSemana = addDaysISO(hoy, 7);
  const finMes = lastDayOfMonthISO(hoy);

  // Label de cada fila para el filtro: proveedor si existe, sino el
  // concepto de la plantilla recurrente. Sin ambos, queda sin filtrar.
  function filterLabel(c: CuentaPorPagarFila): string | null {
    return c.proveedor ?? c.concepto_recurrente ?? null;
  }

  // Clasificación + filtros.
  const cuotasFiltradas = useMemo(() => {
    let result = cuotas;
    if (proveedorFiltro !== 'todos') {
      result = result.filter((c) => filterLabel(c) === proveedorFiltro);
    }
    return result.map((c) => ({
      ...c,
      bucket: clasificar(c, hoy, finMes, enUnaSemana),
    }));
  }, [cuotas, proveedorFiltro, hoy, finMes, enUnaSemana]);

  const cuotasFiltradasFinal = useMemo(() => {
    if (!soloVencidas) return cuotasFiltradas;
    return cuotasFiltradas.filter((c) => c.bucket === 'vencido');
  }, [cuotasFiltradas, soloVencidas]);

  // KPIs (sin filtro de "solo vencidas" — los KPIs son globales).
  const kpis = useMemo(() => {
    const todas = cuotasFiltradas;
    let totalAdeudado = 0;
    let totalVencido = 0;
    let totalSemana = 0;
    let countVencido = 0;
    let countSemana = 0;
    for (const c of todas) {
      totalAdeudado += c.monto;
      if (c.bucket === 'vencido') {
        totalVencido += c.monto;
        countVencido++;
      } else if (c.bucket === 'esta_semana') {
        totalSemana += c.monto;
        countSemana++;
      }
    }
    return {
      totalAdeudado,
      countAdeudado: todas.length,
      totalVencido,
      countVencido,
      totalSemana,
      countSemana,
    };
  }, [cuotasFiltradas]);

  // Agrupado por bucket para la vista.
  const porBucket = useMemo(() => {
    const map = new Map<
      Bucket,
      Array<CuentaPorPagarFila & { bucket: Bucket }>
    >();
    for (const def of BUCKETS) map.set(def.key, []);
    for (const c of cuotasFiltradasFinal) {
      map.get(c.bucket)!.push(c);
    }
    return map;
  }, [cuotasFiltradasFinal]);

  // Labels para el select de filtros: proveedor del gasto o, en su
  // defecto, concepto de la plantilla recurrente. Así los recurrentes
  // sin proveedor formal (sueldos, "Luz" cargado sin link a Edenor)
  // también se pueden filtrar por su concepto.
  const filtroLabels = useMemo(() => {
    const set = new Set<string>();
    for (const c of cuotas) {
      const label = filterLabel(c);
      if (label) set.add(label);
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, 'es', { sensitivity: 'base' }),
    );
  }, [cuotas]);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
          Finanzas
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Cuentas por pagar
        </h1>
        <p className="text-sm text-muted-foreground">
          Cuotas pendientes ordenadas por vencimiento. <strong>Gastos</strong>{' '}
          (devengado del EERR) vive en otra pantalla — acá ves lo que tenés
          que pagar y cuándo.
        </p>
      </header>

      {/* Aviso: la anulación de un pago efectivo de caja cerrada generó
          un ajuste en la caja de hoy. */}
      {ajusteMsg && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400"
        >
          <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="flex-1">{ajusteMsg}</p>
          <button
            type="button"
            onClick={() => setAjusteMsg(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 rounded p-0.5 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* KPIs hero */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Total adeudado"
          valor={fmtMoney(kpis.totalAdeudado)}
          subtitulo={`${kpis.countAdeudado} cuota${kpis.countAdeudado === 1 ? '' : 's'}`}
          tone="neutral"
        />
        <KpiCard
          label="Vencido"
          valor={fmtMoney(kpis.totalVencido)}
          subtitulo={`${kpis.countVencido} cuota${kpis.countVencido === 1 ? '' : 's'}`}
          tone={kpis.countVencido > 0 ? 'urgent' : 'neutral'}
        />
        <KpiCard
          label="Vence esta semana"
          valor={fmtMoney(kpis.totalSemana)}
          subtitulo={`${kpis.countSemana} cuota${kpis.countSemana === 1 ? '' : 's'}`}
          tone={kpis.countSemana > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label
            htmlFor="cxp-proveedor"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Proveedor / Concepto
          </Label>
          <select
            id="cxp-proveedor"
            value={proveedorFiltro}
            onChange={(e) => setProveedorFiltro(e.target.value)}
            className={cn(
              'flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <option value="todos">Todos</option>
            {filtroLabels.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 pb-1">
          <button
            type="button"
            onClick={() => setSoloVencidas((v) => !v)}
            aria-pressed={soloVencidas}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              soloVencidas
                ? 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Solo vencidas
          </button>
        </div>
      </div>

      {/* Buckets */}
      {query.isLoading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border bg-muted/30"
            />
          ))}
        </div>
      )}

      {query.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {query.error.message}
        </div>
      )}

      {query.data && cuotasFiltradasFinal.length === 0 && (
        <EmptyState soloVencidas={soloVencidas} />
      )}

      {query.data && cuotasFiltradasFinal.length > 0 && (
        <div className="space-y-4">
          {BUCKETS.map((def) => {
            const lista = porBucket.get(def.key) ?? [];
            if (lista.length === 0) return null;
            return (
              <BucketSection
                key={def.key}
                def={def}
                cuotas={lista}
                onPagar={(c) => setCuotaSeleccionada(c)}
              />
            );
          })}
        </div>
      )}

      {/* Pagos recientes (para anular un pago mal hecho) */}
      <PagosRecientesSection
        query={pagosQuery}
        onAnular={(p) => {
          setAnularError(null);
          setPagoAAnular(p);
        }}
      />

      <PagarCuotaDialog
        open={cuotaSeleccionada !== null}
        onOpenChange={(o) => {
          if (!o) setCuotaSeleccionada(null);
        }}
        cuota={cuotaSeleccionada}
      />

      <AnularDialog
        open={pagoAAnular !== null}
        onOpenChange={(o) => {
          if (anularPago.isPending) return;
          if (!o) {
            setPagoAAnular(null);
            setAnularError(null);
          }
        }}
        titulo="Anular pago"
        descripcion="La cuota vuelve a quedar pendiente (reaparece arriba en su vencimiento). El gasto sigue contando en el resultado del período. Si el pago fue en efectivo de una caja ya cerrada, se registra un ajuste en la caja de hoy."
        resumen={
          pagoAAnular && (
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                {pagoAAnular.proveedor ??
                  pagoAAnular.concepto_recurrente ?? (
                    <span className="italic text-muted-foreground">
                      (sin proveedor)
                    </span>
                  )}
              </p>
              <p className="text-xs text-muted-foreground">
                {pagoAAnular.categoria_nombre} · {pagoAAnular.unidad_nombre} ·{' '}
                {cuotaLabel(pagoAAnular)}
              </p>
              <p className="text-xs text-muted-foreground">
                Pagó {fmtDateShort(pagoAAnular.fecha_pago)}
                {pagoAAnular.medio_pago &&
                  ` · ${MEDIO_PAGO_LABEL[pagoAAnular.medio_pago]}`}
              </p>
              <div className="flex items-baseline justify-between pt-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Monto
                </span>
                <span className="text-lg font-bold tabular-nums text-foreground">
                  {fmtMoney(pagoAAnular.monto)}
                </span>
              </div>
            </div>
          )
        }
        confirmLabel="Anular pago"
        pending={anularPago.isPending}
        error={anularError}
        onConfirm={handleAnularPagoConfirm}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Label de cuota: "Anticipo" o "Cuota N de M"
// ─────────────────────────────────────────────────────────────────────

function cuotaLabel(c: {
  es_anticipo: boolean;
  numero: number;
  total_cuotas: number;
}): string {
  if (c.es_anticipo) return 'Anticipo';
  return c.total_cuotas > 0
    ? `Cuota ${c.numero} de ${c.total_cuotas}`
    : `Cuota ${c.numero}`;
}

// ─────────────────────────────────────────────────────────────────────
// Pagos recientes (últimos 60 días) — con acción "Anular pago"
// ─────────────────────────────────────────────────────────────────────

function PagosRecientesSection({
  query,
  onAnular,
}: {
  query: ReturnType<typeof usePagosCuotaRecientes>;
  onAnular: (p: PagoCuotaReciente) => void;
}) {
  // Solo mostramos la sección si hay pagos recientes — si no, no hay
  // nada que corregir y no agregamos ruido.
  if (!query.data || query.data.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5 text-muted-foreground">
        <History className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Pagos recientes</p>
          <p className="text-[11px]">
            Cuotas pagadas en los últimos 60 días. Anulá un pago si fue un
            error — la cuota vuelve a pendiente.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-border/50">
        {query.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-[200px] flex-1 space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {p.proveedor ?? p.concepto_recurrente ?? (
                  <span className="italic text-muted-foreground">
                    (sin proveedor)
                  </span>
                )}
                {p.concepto_recurrente !== null && (
                  <span
                    title="Cargado desde una plantilla recurrente"
                    className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-muted-foreground ring-1 ring-border"
                  >
                    <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                    Recurrente
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.categoria_nombre} · {p.unidad_nombre} · {cuotaLabel(p)}
                {p.compra_id !== null && (
                  <>
                    {' '}
                    · <Receipt className="inline h-3 w-3" aria-hidden="true" />{' '}
                    Compra #{p.compra_id}
                  </>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Pagó {fmtDateShort(p.fecha_pago)}
                {p.medio_pago && ` · ${MEDIO_PAGO_LABEL[p.medio_pago]}`}
              </p>
            </div>

            <div className="text-right">
              <p className="text-base font-bold tabular-nums text-foreground">
                {fmtMoney(p.monto)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onAnular(p)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              Anular pago
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KpiCard
// ─────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  valor,
  subtitulo,
  tone,
}: {
  label: string;
  valor: string;
  subtitulo: string;
  tone: 'neutral' | 'warning' | 'urgent';
}) {
  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-lg border bg-card p-4',
        tone === 'urgent' && 'border-red-500/40',
        tone === 'warning' && 'border-amber-500/40',
        tone === 'neutral' && 'border-border',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-3 text-2xl font-bold tabular-nums leading-none',
          tone === 'urgent'
            ? 'text-red-700 dark:text-red-500'
            : tone === 'warning'
              ? 'text-amber-700 dark:text-amber-500'
              : 'text-foreground',
        )}
      >
        {valor}
      </p>
      <p className="mt-3 text-[11px] text-muted-foreground">{subtitulo}</p>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BucketSection
// ─────────────────────────────────────────────────────────────────────

interface BucketSectionProps {
  def: BucketDef;
  cuotas: Array<CuentaPorPagarFila & { bucket: Bucket }>;
  onPagar: (c: CuentaPorPagarFila) => void;
}

function BucketSection({ def, cuotas, onPagar }: BucketSectionProps) {
  const Icon = def.icon;
  const total = cuotas.reduce((acc, c) => acc + c.monto, 0);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header
        className={cn(
          'flex items-center gap-2 border-b px-4 py-2.5',
          def.toneClass,
        )}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-semibold">{def.label}</p>
          <p className="text-[11px] opacity-80">{def.description}</p>
        </div>
        <div className="text-right">
          <p className="text-xs tabular-nums">
            {cuotas.length} cuota{cuotas.length === 1 ? '' : 's'}
          </p>
          <p className="text-sm font-bold tabular-nums">{fmtMoney(total)}</p>
        </div>
      </header>

      <ul className="divide-y divide-border/50">
        {cuotas.map((c) => (
          <CuotaRow
            key={c.id}
            cuota={c}
            urgente={def.urgent}
            onPagar={() => onPagar(c)}
          />
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CuotaRow
// ─────────────────────────────────────────────────────────────────────

function CuotaRow({
  cuota,
  urgente,
  onPagar,
}: {
  cuota: CuentaPorPagarFila;
  urgente: boolean;
  onPagar: () => void;
}) {
  const cuotaLabel = cuota.es_anticipo
    ? 'Anticipo'
    : cuota.total_cuotas > 0
      ? `Cuota ${cuota.numero} de ${cuota.total_cuotas}`
      : `Cuota ${cuota.numero}`;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-[200px] space-y-0.5">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {cuota.proveedor ?? cuota.concepto_recurrente ?? (
            <span className="italic text-muted-foreground">(sin proveedor)</span>
          )}
          {cuota.concepto_recurrente !== null && (
            <span
              title="Cargado desde una plantilla recurrente"
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-muted-foreground ring-1 ring-border"
            >
              <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
              Recurrente
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {cuota.categoria_nombre} · {cuota.unidad_nombre}
          {cuota.compra_id !== null && (
            <>
              {' '}
              · <Receipt className="inline h-3 w-3" aria-hidden="true" /> Compra #
              {cuota.compra_id}
            </>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">{cuotaLabel}</p>
      </div>

      <div className="text-right">
        <p
          className={cn(
            'text-base font-bold tabular-nums',
            urgente ? 'text-red-700 dark:text-red-400' : 'text-foreground',
          )}
        >
          {fmtMoney(cuota.monto)}
        </p>
        {cuota.fecha_vencimiento ? (
          <p className="text-[11px] text-muted-foreground">
            vence {fmtDateShort(cuota.fecha_vencimiento)}
          </p>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">sin fecha</p>
        )}
      </div>

      <Button type="button" size="sm" onClick={onPagar}>
        Pagar
      </Button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────

function EmptyState({ soloVencidas }: { soloVencidas: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <Calendar className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-2 text-sm text-muted-foreground">
        {soloVencidas
          ? 'No hay cuotas vencidas. ✓'
          : 'No hay cuentas por pagar pendientes.'}
      </p>
    </div>
  );
}
