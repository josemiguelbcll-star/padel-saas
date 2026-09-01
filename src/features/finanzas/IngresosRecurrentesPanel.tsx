import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { NuevoIngresoRecurrenteDialog } from './NuevoIngresoRecurrenteDialog';
import { NuevoOtroIngresoDialog, type OtroIngresoPrefill } from './NuevoOtroIngresoDialog';
import {
  useDesactivarIngresoRecurrente,
  useIngresosRecurrentes,
  type IngresoRecurrenteFila,
} from './hooks/useIngresosRecurrentes';
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

type EstadoIngresoRecurrente = 'cargado' | 'vencido' | 'por_vencer';

interface IngresoRecurrenteCardData {
  fila: IngresoRecurrenteFila;
  estado: EstadoIngresoRecurrente;
  diaEfectivo: number;
  realesDelMes: ReadonlyArray<{
    id: number;
    monto: number;
    fecha: string;
    fecha_cobro: string | null;
  }>;
}

export function IngresosRecurrentesPanel({ readOnly }: { readOnly?: boolean }) {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth();
  const hoy = hoyISO();
  const { desde, hasta } = rangoDelMes(anio, mes);
  const mesLabel = mesActualFmt.format(ahora);

  const recurrentesQuery = useIngresosRecurrentes();
  const desactivar = useDesactivarIngresoRecurrente();

  const [dialogNuevaPlantilla, setDialogNuevaPlantilla] = useState(false);
  const [plantillaAEditar, setPlantillaAEditar] = useState<IngresoRecurrenteFila | null>(null);
  const [plantillaADesactivar, setPlantillaADesactivar] = useState<IngresoRecurrenteFila | null>(null);
  const [cargarRealPrefill, setCargarRealPrefill] = useState<OtroIngresoPrefill | null>(null);
  const [dialogCargarReal, setDialogCargarReal] = useState(false);

  const { cardsData, resumen } = useMemo(() => {
    const filas = recurrentesQuery.data ?? [];
    const cards: IngresoRecurrenteCardData[] = [];
    let nCargadas = 0;
    let nVencidas = 0;
    let nPorVencer = 0;
    let estimadoTotal = 0;
    let cobradoTotal = 0;

    for (const fila of filas) {
      estimadoTotal += fila.monto_estimado;
      const diaEfectivo = clampDiaAlMes(fila.dia_vencimiento, anio, mes);
      const fechaVenc = fechaVencimientoEnMes(fila.dia_vencimiento, anio, mes);

      const realesDelMes = fila.reales.filter(
        (r) => r.fecha >= desde && r.fecha <= hasta,
      );

      const sumRealFila = realesDelMes.reduce((acc, r) => acc + r.monto, 0);

      let estado: EstadoIngresoRecurrente;
      if (realesDelMes.length > 0) {
        estado = 'cargado';
        nCargadas++;
        cobradoTotal += sumRealFila;
      } else if (hoy > fechaVenc) {
        estado = 'vencido';
        nVencidas++;
      } else {
        estado = 'por_vencer';
        nPorVencer++;
      }

      cards.push({
        fila,
        estado,
        diaEfectivo,
        realesDelMes,
      });
    }

    return {
      cardsData: cards,
      resumen: {
        nCargadas,
        nVencidas,
        nPorVencer,
        estimadoTotal,
        cobradoTotal,
        totalCount: filas.length,
      },
    };
  }, [recurrentesQuery.data, anio, mes, hoy, desde, hasta]);

  function handleAbrirCargarReal(c: IngresoRecurrenteCardData) {
    setCargarRealPrefill({
      ingreso_recurrente_id: c.fila.id,
      unidad_id: c.fila.unidad_id,
      concepto: c.fila.concepto,
      monto: c.fila.monto_estimado,
      fecha: fechaVencimientoEnMes(c.fila.dia_vencimiento, anio, mes),
    });
    setDialogCargarReal(true);
  }

  const vencidas = cardsData.filter((c) => c.estado === 'vencido');
  const porVencer = cardsData.filter((c) => c.estado === 'por_vencer');
  const cargadas = cardsData.filter((c) => c.estado === 'cargado');

  return (
    <div className="space-y-5">
      {/* Header del panel idéntico a Gastos */}
      <header className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Repeat className="h-3 w-3" aria-hidden="true" />
            Panel del mes
          </p>
          <h2 className="text-lg font-semibold capitalize text-foreground">
            {mesLabel}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Hoy {ahora.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ResumenStat label="Cobradas" valor={resumen.nCargadas} tone="ok" />
          <ResumenStat label="Vencidas" valor={resumen.nVencidas} tone="bad" />
          <ResumenStat label="Por cobrar" valor={resumen.nPorVencer} tone="warn" />
          <div className="border-l border-border pl-3 text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Estimado del mes
            </p>
            <p className="text-base font-bold tabular-nums text-foreground">
              {fmtMoney(resumen.estimadoTotal)}
            </p>
            {resumen.nCargadas > 0 && (
              <p className="text-[10px] text-muted-foreground">
                cobrado {fmtMoney(resumen.cobradoTotal)}
              </p>
            )}
          </div>
          {!readOnly && (
            <Button
              type="button"
              onClick={() => {
                setPlantillaAEditar(null);
                setDialogNuevaPlantilla(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Nueva plantilla
            </Button>
          )}
        </div>
      </header>

      {recurrentesQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando plantillas de ingresos…
        </div>
      )}

      {recurrentesQuery.data && recurrentesQuery.data.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <Repeat className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-foreground">
            No tenés plantillas de ingresos recurrentes configuradas
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Creá plantillas para tus ingresos fijos de cada mes (auspicios, cuotas, membresías, alquiler de buffet).
          </p>
          {!readOnly && (
            <Button
              type="button"
              onClick={() => setDialogNuevaPlantilla(true)}
              className="mt-4"
            >
              <Plus className="h-4 w-4" />
              Crear primera plantilla
            </Button>
          )}
        </div>
      )}

      {/* Secciones agrupadas por bucket */}
      {cardsData.length > 0 && (
        <div className="space-y-6">
          {vencidas.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                <span>Vencidas sin cobrar ({vencidas.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {vencidas.map((c) => (
                  <CardItem
                    key={c.fila.id}
                    card={c}
                    readOnly={readOnly}
                    onCargarReal={() => handleAbrirCargarReal(c)}
                    onEditar={() => setPlantillaAEditar(c.fila)}
                    onDesactivar={() => setPlantillaADesactivar(c.fila)}
                  />
                ))}
              </div>
            </section>
          )}

          {porVencer.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400">
                <Clock className="h-4 w-4" />
                <span>Por cobrar este mes ({porVencer.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {porVencer.map((c) => (
                  <CardItem
                    key={c.fila.id}
                    card={c}
                    readOnly={readOnly}
                    onCargarReal={() => handleAbrirCargarReal(c)}
                    onEditar={() => setPlantillaAEditar(c.fila)}
                    onDesactivar={() => setPlantillaADesactivar(c.fila)}
                  />
                ))}
              </div>
            </section>
          )}

          {cargadas.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="h-4 w-4" />
                <span>Cobradas en el mes ({cargadas.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {cargadas.map((c) => (
                  <CardItem
                    key={c.fila.id}
                    card={c}
                    readOnly={readOnly}
                    onCargarReal={() => handleAbrirCargarReal(c)}
                    onEditar={() => setPlantillaAEditar(c.fila)}
                    onDesactivar={() => setPlantillaADesactivar(c.fila)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Diálogos */}
      <NuevoIngresoRecurrenteDialog
        open={dialogNuevaPlantilla || plantillaAEditar !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialogNuevaPlantilla(false);
            setPlantillaAEditar(null);
          }
        }}
        editing={plantillaAEditar}
      />

      <NuevoOtroIngresoDialog
        open={dialogCargarReal}
        onOpenChange={(o) => {
          setDialogCargarReal(o);
          if (!o) setCargarRealPrefill(null);
        }}
        prefill={cargarRealPrefill}
      />

      {/* Confirmación desactivar */}
      <Dialog
        open={plantillaADesactivar !== null}
        onOpenChange={(o) => {
          if (!o) setPlantillaADesactivar(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Desactivar plantilla de ingreso</DialogTitle>
            <DialogDescription>
              ¿Querés desactivar "{plantillaADesactivar?.concepto}"? Dejará de
              aparecer en el panel de los próximos meses.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPlantillaADesactivar(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={desactivar.isPending}
              onClick={async () => {
                if (!plantillaADesactivar) return;
                await desactivar.mutateAsync(plantillaADesactivar.id);
                setPlantillaADesactivar(null);
              }}
            >
              {desactivar.isPending ? 'Desactivando…' : 'Desactivar'}
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
  tone: 'ok' | 'bad' | 'warn';
}) {
  const color =
    tone === 'ok'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'bad'
        ? 'text-red-700 dark:text-red-400'
        : 'text-amber-700 dark:text-amber-400';

  return (
    <div className="rounded-md border border-border bg-background px-3 py-1.5 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={cn('text-lg font-bold tabular-nums', color)}>{valor}</p>
    </div>
  );
}

function CardItem({
  card,
  readOnly,
  onCargarReal,
  onEditar,
  onDesactivar,
}: {
  card: IngresoRecurrenteCardData;
  readOnly?: boolean;
  onCargarReal: () => void;
  onEditar: () => void;
  onDesactivar: () => void;
}) {
  const { fila, estado, diaEfectivo, realesDelMes } = card;
  const [menuOpen, setMenuOpen] = useState(false);

  const sumReal = realesDelMes.reduce((acc, r) => acc + r.monto, 0);

  const borderClass =
    estado === 'cargado'
      ? 'border-l-emerald-500'
      : estado === 'vencido'
        ? 'border-l-red-500'
        : 'border-l-amber-500';

  return (
    <article
      className={cn(
        'relative flex flex-col rounded-lg border-l-4 border border-border bg-card p-4',
        'shadow-sm transition-colors hover:bg-card/80',
        borderClass,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="font-semibold text-foreground">{fila.concepto}</p>
          <p className="text-xs text-muted-foreground">{fila.unidad_nombre}</p>
        </div>

        {!readOnly && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-6 z-20 w-36 rounded-md border border-border bg-popover p-1 shadow-md"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEditar();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground hover:bg-accent"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar plantilla
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDesactivar();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Desactivar
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <div>
          <span className="text-[11px] text-muted-foreground">
            Día {diaEfectivo} de cada mes
          </span>
          <p className="text-lg font-bold tabular-nums text-foreground">
            {fmtMoney(fila.monto_estimado)}
          </p>
        </div>

        {estado === 'cargado' ? (
          <div className="text-right">
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              Cobrado: {fmtMoney(sumReal)}
            </span>
          </div>
        ) : (
          !readOnly && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCargarReal}
              className="h-8 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              Cargar cobro
            </Button>
          )
        )}
      </div>
    </article>
  );
}
