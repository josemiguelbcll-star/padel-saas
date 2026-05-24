import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock, Loader2, Plus, Power, Repeat, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NuevoGastoDialog } from './NuevoGastoDialog';
import { NuevoRecurrenteDialog } from './NuevoRecurrenteDialog';
import {
  RecurrenteCard,
  type EstadoRecurrente,
  type RecurrenteCardData,
} from './RecurrenteCard';
import {
  useActualizarGastoRecurrente,
  useEliminarGastoRecurrente,
  useGastosRecurrentes,
  type RecurrenteFila,
} from './hooks/useGastosRecurrentes';
import {
  clampDiaAlMes,
  fechaVencimientoEnMes,
  hoyISO,
  rangoDelMes,
} from './utils/fechaRecurrente';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

const mesActualFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
});

interface BucketDef {
  key: EstadoRecurrente;
  label: string;
  icon: typeof Check;
  toneClass: string;
}

const BUCKETS: ReadonlyArray<BucketDef> = [
  {
    key: 'vencido',
    label: 'Vencidas sin cargar',
    icon: AlertTriangle,
    toneClass: 'text-red-700 dark:text-red-400',
  },
  {
    key: 'por_vencer',
    label: 'Por vencer este mes',
    icon: Clock,
    toneClass: 'text-amber-700 dark:text-amber-400',
  },
  {
    key: 'cargado',
    label: 'Cargadas este mes',
    icon: Check,
    toneClass: 'text-emerald-700 dark:text-emerald-400',
  },
];

/**
 * Panel del mes activo (mes calendario actual). Muestra las plantillas
 * recurrentes activas del club agrupadas por estado:
 *   - Vencidas sin cargar (hoy > día de vencimiento del mes, 0 reales)
 *   - Por vencer (hoy <= día, 0 reales)
 *   - Cargadas (>= 1 real con fecha_gasto en el mes)
 *
 * El día efectivo es clamp(diaPlantilla, ultimoDelMes) — NO addMonths.
 * Estado se computa con la fecha local del día.
 */
export function RecurrentesPanel() {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth();
  const hoy = hoyISO();
  const { desde, hasta } = rangoDelMes(anio, mes);
  const mesLabel = mesActualFmt.format(ahora);

  const recurrentesQuery = useGastosRecurrentes();
  const actualizar = useActualizarGastoRecurrente();
  const eliminar = useEliminarGastoRecurrente();

  // Dialogs
  const [openNueva, setOpenNueva] = useState(false);
  const [editandoFila, setEditandoFila] = useState<RecurrenteFila | null>(null);
  const [cargarRealFila, setCargarRealFila] = useState<RecurrenteFila | null>(null);
  const [desactivarFila, setDesactivarFila] = useState<RecurrenteFila | null>(null);
  const [eliminarFila, setEliminarFila] = useState<RecurrenteFila | null>(null);
  const [errorOp, setErrorOp] = useState<string | null>(null);

  const cards = useMemo<RecurrenteCardData[]>(() => {
    const filas = recurrentesQuery.data ?? [];
    return filas.map((fila) => {
      const diaEfectivo = clampDiaAlMes(fila.dia_vencimiento, anio, mes);
      const realesDelMes = fila.reales.filter(
        (r) => r.fecha_gasto >= desde && r.fecha_gasto <= hasta,
      );
      const hoyDia = ahora.getDate();
      let estado: EstadoRecurrente;
      if (realesDelMes.length > 0) {
        estado = 'cargado';
      } else if (hoyDia > diaEfectivo) {
        estado = 'vencido';
      } else {
        estado = 'por_vencer';
      }
      return { fila, estado, diaEfectivo, realesDelMes };
    });
  }, [recurrentesQuery.data, anio, mes, desde, hasta, ahora]);

  const resumen = useMemo(() => {
    let nCargadas = 0;
    let nVencidas = 0;
    let nPorVencer = 0;
    let estimadoTotal = 0;
    let cargadoTotal = 0;
    for (const c of cards) {
      estimadoTotal += c.fila.monto_estimado;
      if (c.estado === 'cargado') {
        nCargadas++;
        cargadoTotal += c.realesDelMes.reduce((acc, r) => acc + r.monto, 0);
      } else if (c.estado === 'vencido') {
        nVencidas++;
      } else {
        nPorVencer++;
      }
    }
    return { nCargadas, nVencidas, nPorVencer, estimadoTotal, cargadoTotal };
  }, [cards]);

  const porBucket = useMemo(() => {
    const map = new Map<EstadoRecurrente, RecurrenteCardData[]>();
    for (const def of BUCKETS) map.set(def.key, []);
    for (const c of cards) map.get(c.estado)!.push(c);
    return map;
  }, [cards]);

  async function handleDesactivarConfirm(): Promise<void> {
    if (!desactivarFila) return;
    setErrorOp(null);
    try {
      await actualizar.mutateAsync({
        id: desactivarFila.id,
        changes: { activo: false },
      });
      setDesactivarFila(null);
    } catch (err) {
      setErrorOp(err instanceof Error ? err.message : 'No pudimos desactivar la plantilla.');
    }
  }

  async function handleEliminarConfirm(): Promise<void> {
    if (!eliminarFila) return;
    setErrorOp(null);
    try {
      await eliminar.mutateAsync(eliminarFila.id);
      setEliminarFila(null);
    } catch (err) {
      setErrorOp(err instanceof Error ? err.message : 'No pudimos eliminar la plantilla.');
    }
  }

  return (
    <div className="space-y-5">
      {/* Header del panel */}
      <header className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Repeat className="h-3 w-3" aria-hidden="true" />
            Panel del mes
          </p>
          <h2 className="text-lg font-semibold capitalize text-foreground">
            {mesLabel}
          </h2>
          {hoy && (
            <p className="text-[11px] text-muted-foreground">
              Hoy {ahora.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ResumenStat label="Cargadas" valor={resumen.nCargadas} tone="ok" />
          <ResumenStat label="Vencidas" valor={resumen.nVencidas} tone="bad" />
          <ResumenStat label="Por vencer" valor={resumen.nPorVencer} tone="warn" />
          <div className="border-l border-border pl-3 text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Estimado del mes
            </p>
            <p className="text-base font-bold tabular-nums text-foreground">
              {fmtMoney(resumen.estimadoTotal)}
            </p>
            {resumen.nCargadas > 0 && (
              <p className="text-[10px] text-muted-foreground">
                cargado {fmtMoney(resumen.cargadoTotal)}
              </p>
            )}
          </div>
          <Button
            type="button"
            onClick={() => { setEditandoFila(null); setOpenNueva(true); }}
          >
            <Plus className="h-4 w-4" />
            Nueva plantilla
          </Button>
        </div>
      </header>

      {/* Estados */}
      {recurrentesQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando plantillas…
        </div>
      )}

      {recurrentesQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {recurrentesQuery.error.message}
        </div>
      )}

      {recurrentesQuery.data && cards.length === 0 && (
        <EmptyState onCrear={() => { setEditandoFila(null); setOpenNueva(true); }} />
      )}

      {recurrentesQuery.data && cards.length > 0 && (
        <div className="space-y-5">
          {BUCKETS.map((def) => {
            const lista = porBucket.get(def.key) ?? [];
            if (lista.length === 0) return null;
            const Icon = def.icon;
            return (
              <section key={def.key} className="space-y-2">
                <header className="flex items-center gap-1.5">
                  <Icon className={`h-3.5 w-3.5 ${def.toneClass}`} aria-hidden="true" />
                  <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${def.toneClass}`}>
                    {def.label}
                  </h3>
                  <span className="text-[11px] text-muted-foreground">· {lista.length}</span>
                </header>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {lista.map((c) => (
                    <RecurrenteCard
                      key={c.fila.id}
                      data={c}
                      onCargarReal={() => setCargarRealFila(c.fila)}
                      onEditar={() => { setEditandoFila(c.fila); setOpenNueva(true); }}
                      onDesactivar={() => setDesactivarFila(c.fila)}
                      onEliminar={() => setEliminarFila(c.fila)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Dialog crear/editar plantilla */}
      <NuevoRecurrenteDialog
        open={openNueva}
        onOpenChange={(o) => {
          setOpenNueva(o);
          if (!o) setEditandoFila(null);
        }}
        editing={editandoFila}
      />

      {/* Dialog "Cargar real" — abre NuevoGastoDialog con prefill.
          La fecha de vencimiento se calcula desde dia_vencimiento de la
          plantilla, clampeada al mes activo del panel (NO addMonths). */}
      <NuevoGastoDialog
        open={cargarRealFila !== null}
        onOpenChange={(o) => { if (!o) setCargarRealFila(null); }}
        prefill={
          cargarRealFila
            ? {
                gasto_recurrente_id: cargarRealFila.id,
                concepto: cargarRealFila.concepto,
                categoria_id: cargarRealFila.categoria_id,
                monto: cargarRealFila.monto_estimado,
                proveedor_id: cargarRealFila.proveedor_id,
                proveedor_nombre: cargarRealFila.proveedor_nombre,
                observaciones: null,
                fecha_vencimiento: fechaVencimientoEnMes(
                  cargarRealFila.dia_vencimiento,
                  anio,
                  mes,
                ),
              }
            : null
        }
      />

      {/* Confirm: desactivar */}
      <Dialog
        open={desactivarFila !== null}
        onOpenChange={(o) => {
          if (actualizar.isPending) return;
          if (!o) { setDesactivarFila(null); setErrorOp(null); }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Desactivar plantilla
            </DialogTitle>
            <DialogDescription>
              La plantilla <strong>"{desactivarFila?.concepto}"</strong> dejará
              de aparecer en el panel del mes. Los gastos históricos cargados
              desde esta plantilla siguen en su lugar. Podés reactivarla más
              adelante editándola.
            </DialogDescription>
          </DialogHeader>
          {errorOp && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {errorOp}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setDesactivarFila(null); setErrorOp(null); }}
              disabled={actualizar.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleDesactivarConfirm}
              disabled={actualizar.isPending}
            >
              {actualizar.isPending ? 'Desactivando…' : 'Desactivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm: eliminar */}
      <Dialog
        open={eliminarFila !== null}
        onOpenChange={(o) => {
          if (eliminar.isPending) return;
          if (!o) { setEliminarFila(null); setErrorOp(null); }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
              Eliminar plantilla
            </DialogTitle>
            <DialogDescription>
              Esta acción es <strong>irreversible</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">
                Vas a eliminar la plantilla "{eliminarFila?.concepto}".
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>
                  Los gastos reales históricos cargados desde esta plantilla
                  <strong> NO se borran</strong>.
                </li>
                <li>
                  Pierden el vínculo a la plantilla (quedan como gastos
                  manuales normales).
                </li>
              </ul>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Si solo querés pausar la plantilla conservándola en la base,
            usá "Desactivar" en su lugar.
          </p>

          {errorOp && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {errorOp}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setEliminarFila(null); setErrorOp(null); }}
              disabled={eliminar.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleEliminarConfirm}
              disabled={eliminar.isPending}
            >
              {eliminar.isPending ? 'Eliminando…' : 'Eliminar definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResumenStat({
  label,
  valor,
  tone,
}: {
  label: string;
  valor: number;
  tone: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'ok'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400';
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-base font-bold tabular-nums ${color}`}>{valor}</p>
    </div>
  );
}

function EmptyState({ onCrear }: { onCrear: () => void }) {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <Repeat className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="mt-2 text-sm text-muted-foreground">
        Todavía no cargaste plantillas recurrentes. Empezá con las que se
        repiten cada mes: alquiler, luz, sueldos.
      </p>
      <Button type="button" onClick={onCrear} className="mt-3">
        <Plus className="h-4 w-4" />
        Crear primera plantilla
      </Button>
    </div>
  );
}
