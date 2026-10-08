import { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  ArrowRight,
  Receipt,
  FileText,
  DollarSign,
  TrendingUp,
  Lock,
  Unlock,
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
import type { TurnoCajaConDetalles } from './hooks/useTurnosCajaHistorial';
import { useMovimientosCaja } from './hooks/useMovimientosCaja';
import { MovimientosCajaList } from './MovimientosCajaList';
import { useResumenCajaAbierta } from './hooks/useResumenCajaAbierta';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const AR_TZ = 'America/Argentina/Buenos_Aires';

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: AR_TZ,
});

const fechaHoraFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: AR_TZ,
});

function formatFH(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return fechaHoraFmt.format(new Date(iso));
  } catch {
    return iso;
  }
}

interface DetalleArqueoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turno: TurnoCajaConDetalles | null;
}

export function DetalleArqueoDialog({
  open,
  onOpenChange,
  turno,
}: DetalleArqueoDialogProps) {
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entradas' | 'salidas'>(
    'todos',
  );

  const turnoId = turno?.id ?? null;
  const movimientosQuery = useMovimientosCaja(turnoId);
  const resumenQuery = useResumenCajaAbierta(turnoId);

  if (!turno) return null;

  const esAbierta = !turno.cerrada_en;
  const movimientos = movimientosQuery.data ?? [];

  const movimientosFiltrados = movimientos.filter((m) => {
    if (filtroTipo === 'entradas') return m.signo === '+';
    if (filtroTipo === 'salidas') return m.signo === '-';
    return true;
  });

  const diferenciaNum = turno.diferencia ?? 0;
  const esCuadrada = turno.cerrada_en !== null && Math.abs(diferenciaNum) < 0.01;
  const esSobrante = turno.cerrada_en !== null && diferenciaNum > 0.01;
  const esFaltante = turno.cerrada_en !== null && diferenciaNum < -0.01;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full max-w-2xl max-h-[92vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <DialogHeader className="pr-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-primary" />
                  <span>Arqueo de Caja #{turno.id}</span>
                </DialogTitle>
                {esAbierta ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Abierta
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                    <Lock className="h-3 w-3" />
                    Cerrada
                  </span>
                )}
              </div>
              <DialogDescription className="text-xs sm:text-sm capitalize">
                {fechaFmt.format(new Date(turno.fecha_jornada + 'T12:00:00'))}
              </DialogDescription>
            </div>

            {/* Badge de resultado de arqueo si está cerrada */}
            {!esAbierta && (
              <div>
                {esCuadrada ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Caja cuadrada (Exacta)</span>
                  </div>
                ) : esSobrante ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                    <TrendingUp className="h-4 w-4" />
                    <span>Sobrante: +{currencyFmt.format(diferenciaNum)}</span>
                  </div>
                ) : esFaltante ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-semibold">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Faltante: {currencyFmt.format(diferenciaNum)}</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Tarjetas de Apertura vs Cierre con Usuarios Responsables */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Tarjeta Apertura */}
            <div className="rounded-xl border border-border bg-card/70 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Unlock className="h-3.5 w-3.5 text-primary" />
                  Apertura
                </span>
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {currencyFmt.format(turno.monto_apertura)}
                </span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" />
                    Abierta por:
                  </span>
                  <strong className="text-foreground font-medium">
                    {turno.usuarioAperturaNombre}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Fecha y hora:
                  </span>
                  <span className="text-foreground tabular-nums">
                    {formatFH(turno.abierta_en)}
                  </span>
                </div>
              </div>
            </div>

            {/* Tarjeta Cierre */}
            <div className="rounded-xl border border-border bg-card/70 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-primary" />
                  Cierre & Arqueo
                </span>
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {turno.efectivo_contado !== null
                    ? currencyFmt.format(turno.efectivo_contado)
                    : 'En curso'}
                </span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" />
                    Cerrada por:
                  </span>
                  <strong className="text-foreground font-medium">
                    {turno.usuarioCierreNombre ?? (
                      <span className="italic text-muted-foreground">
                        Caja aún abierta
                      </span>
                    )}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Fecha y hora:
                  </span>
                  <span className="text-foreground tabular-nums">
                    {turno.cerrada_en ? formatFH(turno.cerrada_en) : '-'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Cuadro de Arqueo Detallado */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Balance Numérico del Turno
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              <div className="p-2.5 rounded-lg bg-background border border-border">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Apertura
                </span>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {currencyFmt.format(turno.monto_apertura)}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-background border border-border">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Esperado (Sistema)
                </span>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {turno.efectivo_esperado !== null
                    ? currencyFmt.format(turno.efectivo_esperado)
                    : resumenQuery.data
                      ? currencyFmt.format(resumenQuery.data.esperado)
                      : '-'}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-background border border-border">
                <span className="text-[10px] text-muted-foreground block font-medium">
                  Contado (Físico)
                </span>
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {turno.efectivo_contado !== null
                    ? currencyFmt.format(turno.efectivo_contado)
                    : '-'}
                </span>
              </div>
              <div
                className={cn(
                  'p-2.5 rounded-lg border',
                  esCuadrada
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                    : esSobrante
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                      : esFaltante
                        ? 'bg-destructive/10 border-destructive/30 text-destructive'
                        : 'bg-background border-border text-foreground',
                )}
              >
                <span className="text-[10px] opacity-80 block font-medium">
                  Diferencia
                </span>
                <span className="text-sm font-bold tabular-nums">
                  {turno.diferencia !== null
                    ? `${diferenciaNum > 0 ? '+' : ''}${currencyFmt.format(diferenciaNum)}`
                    : '-'}
                </span>
              </div>
            </div>

            {/* Observaciones registradas al momento del cierre */}
            {turno.observaciones_cierre && (
              <div className="rounded-lg bg-background border border-border p-2.5 text-xs space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  Observaciones registradas en el cierre:
                </span>
                <p className="text-foreground whitespace-pre-line text-xs pl-4">
                  {turno.observaciones_cierre}
                </p>
              </div>
            )}
          </div>

          {/* Continuidad con la próxima apertura */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" />
                Continuidad de Caja (Pase de turno)
              </span>
              {turno.siguienteTurno && (
                <span className="text-[11px] text-muted-foreground">
                  Turno siguiente #{turno.siguienteTurno.id}
                </span>
              )}
            </div>

            {turno.siguienteTurno ? (
              <div className="space-y-2 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 bg-background/80 p-2.5 rounded-lg border border-border/70">
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground text-[11px]">
                      Efectivo contado al cerrar este turno:
                    </span>
                    <p className="font-bold tabular-nums text-foreground">
                      {currencyFmt.format(turno.efectivo_contado ?? 0)}
                    </p>
                  </div>
                  <div className="hidden sm:block text-muted-foreground">→</div>
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground text-[11px]">
                      Apertura siguiente caja (
                      {turno.siguienteTurno.usuarioAperturaNombre}):
                    </span>
                    <p className="font-bold tabular-nums text-primary">
                      {currencyFmt.format(turno.siguienteTurno.monto_apertura)}
                    </p>
                  </div>
                </div>

                {turno.diferenciaConProximaApertura !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    {Math.abs(turno.diferenciaConProximaApertura) < 0.01 ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        ✓ Pase exacto: la siguiente caja arrancó exactamente
                        con el mismo efectivo contado al cierre (
                        {currencyFmt.format(turno.siguienteTurno.monto_apertura)}
                        ).
                      </span>
                    ) : turno.diferenciaConProximaApertura < 0 ? (
                      <span>
                        Se retiraron{' '}
                        <strong>
                          {currencyFmt.format(
                            Math.abs(turno.diferenciaConProximaApertura),
                          )}
                        </strong>{' '}
                        para depósito/resguardo y se dejaron{' '}
                        <strong>
                          {currencyFmt.format(
                            turno.siguienteTurno.monto_apertura,
                          )}
                        </strong>{' '}
                        como fondo para el siguiente turno.
                      </span>
                    ) : (
                      <span>
                        La siguiente caja inició con un refuerzo de{' '}
                        <strong>
                          +
                          {currencyFmt.format(
                            turno.diferenciaConProximaApertura,
                          )}
                        </strong>{' '}
                        respecto a este cierre.
                      </span>
                    )}
                  </p>
                )}
              </div>
            ) : esAbierta ? (
              <p className="text-xs text-muted-foreground">
                Esta caja está actualmente abierta. Cuando se realice el cierre
                con arqueo, el importe contado quedará asentado como referencia
                para el siguiente turno.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Esta caja es el cierre más reciente. Cuando se abra una nueva
                caja, su monto de apertura se comparará contra los{' '}
                <strong className="text-foreground">
                  {currencyFmt.format(turno.efectivo_contado ?? 0)}
                </strong>{' '}
                contados de este arqueo.
              </p>
            )}
          </div>

          {/* Movimientos del Turno */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Movimientos registrados en esta caja ({movimientos.length})
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Cobros en efectivo de reservas, buffet, clases y retiros
                  manuales.
                </p>
              </div>

              {/* Filtro rápido dentro de los movimientos */}
              <div className="flex rounded-md bg-muted p-0.5 text-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setFiltroTipo('todos')}
                  className={cn(
                    'px-2 py-0.5 rounded font-medium transition-all',
                    filtroTipo === 'todos'
                      ? 'bg-background text-foreground shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Todos ({movimientos.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipo('entradas')}
                  className={cn(
                    'px-2 py-0.5 rounded font-medium transition-all',
                    filtroTipo === 'entradas'
                      ? 'bg-background text-foreground shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Cobros (+)
                </button>
                <button
                  type="button"
                  onClick={() => setFiltroTipo('salidas')}
                  className={cn(
                    'px-2 py-0.5 rounded font-medium transition-all',
                    filtroTipo === 'salidas'
                      ? 'bg-background text-foreground shadow-xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Salidas (−)
                </button>
              </div>
            </div>

            {movimientosQuery.isLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Cargando movimientos del turno…
              </div>
            ) : movimientosFiltrados.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground rounded-lg border border-dashed border-border">
                No hay movimientos registrados para el filtro seleccionado.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                <MovimientosCajaList movimientos={movimientosFiltrados} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            size="sm"
            className="w-full sm:w-auto"
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
