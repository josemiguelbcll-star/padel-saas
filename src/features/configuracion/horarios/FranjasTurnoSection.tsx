import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
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
import type { FranjaTurno } from '@/types/database';
import { horaToMinutos } from '@/features/reservas/utils/horaUtils';
import { diaSemanaDe, fechaHoy } from '@/features/reservas/utils/fechaUtils';
import {
  useEliminarFranjaTurno,
  useFranjasTurno,
} from '@/features/configuracion/hooks/useFranjasTurno';
import { DIAS_SEMANA } from './franjaTurnoSchema';
import { FranjaTurnoDialog } from './FranjaTurnoDialog';
import {
  fechaDeISODOW,
  hayHuecoSinFranja,
  previsualizarInicios,
} from './previewFranjas';
import { VistaPreviaDia } from './VistaPreviaDia';

interface FranjasTurnoSectionProps {
  horaApertura: string | null;
  horaCierre: string | null;
  duracionDefault: number;
}

function hhmm(t: string | null): string {
  return t ? t.slice(0, 5) : '';
}

function diasLabel(dias: number[] | null): string {
  if (dias === null || dias.length === 7) return 'Todos los días';
  return dias
    .slice()
    .sort((a, b) => a - b)
    .map((n) => DIAS_SEMANA.find((d) => d.n === n)?.label ?? n)
    .join(' · ');
}

/** ¿Solapan dos rangos horarios? null = borde abierto (apertura/cierre). */
function franjasSolapan(
  a: FranjaTurno,
  b: FranjaTurno,
  aperturaMin: number,
  cierreMin: number,
): boolean {
  const aDesde = a.desde_hora ? horaToMinutos(a.desde_hora) : aperturaMin;
  const aHasta = a.hasta_hora ? horaToMinutos(a.hasta_hora) : cierreMin;
  const bDesde = b.desde_hora ? horaToMinutos(b.desde_hora) : aperturaMin;
  const bHasta = b.hasta_hora ? horaToMinutos(b.hasta_hora) : cierreMin;
  return Math.max(aDesde, bDesde) < Math.min(aHasta, bHasta);
}

export function FranjasTurnoSection({
  horaApertura,
  horaCierre,
  duracionDefault,
}: FranjasTurnoSectionProps) {
  const franjasQuery = useFranjasTurno();
  const eliminar = useEliminarFranjaTurno();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<FranjaTurno | null>(null);
  const [borrando, setBorrando] = useState<FranjaTurno | null>(null);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);
  // Día de la vista previa (1=lun..7=dom). Default: hoy.
  const [diaPreview, setDiaPreview] = useState<number>(() => diaSemanaDe(fechaHoy()));

  const franjas = franjasQuery.data ?? [];
  const hayHorario = horaApertura !== null && horaCierre !== null;
  const fechaPreview = fechaDeISODOW(diaPreview);

  // Inicios de la vista previa para el día elegido (config global → sentinel).
  const inicios = useMemo(() => {
    if (!hayHorario) return [];
    return previsualizarInicios({
      franjas,
      horaApertura: horaApertura!,
      horaCierre: horaCierre!,
      duracionDefault,
      fecha: fechaPreview,
    });
  }, [franjas, hayHorario, horaApertura, horaCierre, duracionDefault, fechaPreview]);

  // Avisos suaves para el día elegido (solo franjas globales — lo que ve
  // la vista previa).
  const avisos = useMemo(() => {
    if (!hayHorario) return { solapan: false, hueco: false };
    const aperturaMin = horaToMinutos(horaApertura!);
    let cierreMin = horaToMinutos(horaCierre!);
    if (cierreMin === 0) cierreMin = 1440;
    const delDia = franjas.filter(
      (f) =>
        f.activa &&
        f.cancha_id === null &&
        (f.dias_semana === null || f.dias_semana.includes(diaPreview)),
    );
    let solapan = false;
    for (let i = 0; i < delDia.length && !solapan; i++) {
      for (let j = i + 1; j < delDia.length; j++) {
        if (franjasSolapan(delDia[i]!, delDia[j]!, aperturaMin, cierreMin)) {
          solapan = true;
          break;
        }
      }
    }
    const hueco = hayHuecoSinFranja({
      franjas,
      horaApertura: horaApertura!,
      horaCierre: horaCierre!,
      duracionDefault,
      fecha: fechaPreview,
    });
    return { solapan, hueco };
  }, [franjas, hayHorario, horaApertura, horaCierre, duracionDefault, diaPreview, fechaPreview]);

  function abrirAlta(): void {
    setEditando(null);
    setDialogOpen(true);
  }
  function abrirEdicion(f: FranjaTurno): void {
    setEditando(f);
    setDialogOpen(true);
  }

  async function confirmarBorrado(): Promise<void> {
    if (!borrando) return;
    setErrorBorrar(null);
    try {
      await eliminar.mutateAsync(borrando.id);
      setBorrando(null);
    } catch (err) {
      setErrorBorrar(
        err instanceof Error ? err.message : 'No pudimos eliminar la franja.',
      );
    }
  }

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
            Franjas de turno
          </h3>
          <p className="max-w-xl text-sm text-muted-foreground">
            Reglas de duración por horario. Ej: a la mañana se puede 60 o 90 min,
            a la tarde solo 90. Sin franjas, todo el día usa la duración por
            defecto ({duracionDefault} min).
          </p>
        </div>
        <Button type="button" onClick={abrirAlta} disabled={!hayHorario}>
          <Plus className="h-4 w-4" />
          Agregar franja
        </Button>
      </header>

      {!hayHorario && (
        <p className="text-xs text-muted-foreground">
          Configurá la apertura y el cierre arriba para poder definir franjas.
        </p>
      )}

      {/* Lista de franjas */}
      {franjasQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando franjas…
        </div>
      )}

      {franjasQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {franjasQuery.error.message}
        </div>
      )}

      {franjasQuery.data && franjas.length === 0 && hayHorario && (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No configuraste franjas. Todo el horario usa la duración por defecto
            ({duracionDefault} min). Agregá una franja si querés reglas distintas
            por horario.
          </p>
        </div>
      )}

      {franjas.length > 0 && (
        <ul className="space-y-2">
          {franjas.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-[180px] flex-1 space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {f.nombre}
                  {!f.activa && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      inactiva
                    </span>
                  )}
                  {f.cancha_id !== null && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      cancha específica
                    </span>
                  )}
                  {f.prioridad !== 0 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      prioridad {f.prioridad}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.desde_hora && f.hasta_hora
                    ? `${hhmm(f.desde_hora)}–${hhmm(f.hasta_hora)}`
                    : 'Toda hora'}{' '}
                  · {diasLabel(f.dias_semana)}
                </p>
              </div>

              <div className="flex flex-wrap gap-1">
                {f.duraciones_min
                  .slice()
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <span
                      key={d}
                      className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground"
                    >
                      {d}&apos;
                    </span>
                  ))}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => abrirEdicion(f)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorBorrar(null);
                    setBorrando(f);
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Vista previa en vivo de la config guardada */}
      {hayHorario && (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Vista previa de un día
            </p>
            <div className="flex flex-wrap gap-1">
              {DIAS_SEMANA.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => setDiaPreview(d.n)}
                  aria-pressed={diaPreview === d.n}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    diaPreview === d.n
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <VistaPreviaDia inicios={inicios} />

          {/* Avisos suaves (no bloquean) */}
          {(avisos.solapan || avisos.hueco) && (
            <div className="space-y-1 pt-1">
              {avisos.solapan && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  Hay franjas que se solapan en este día. Se resuelven por
                  prioridad (gana la de mayor prioridad).
                </p>
              )}
              {avisos.hueco && (
                <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  Hay horarios sin franja: ahí se usa la duración por defecto
                  ({duracionDefault} min).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Dialog alta/edición */}
      <FranjaTurnoDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditando(null);
        }}
        editing={editando}
        franjasGuardadas={franjas}
        horaApertura={horaApertura}
        horaCierre={horaCierre}
        duracionDefault={duracionDefault}
      />

      {/* Confirm borrar */}
      <Dialog
        open={borrando !== null}
        onOpenChange={(o) => {
          if (eliminar.isPending) return;
          if (!o) {
            setBorrando(null);
            setErrorBorrar(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
              Borrar franja
            </DialogTitle>
            <DialogDescription>
              Se elimina la franja <strong>"{borrando?.nombre}"</strong>. Las
              reservas ya creadas no se tocan (guardan su duración). La grilla
              vuelve a calcular los turnos sin esta franja.
            </DialogDescription>
          </DialogHeader>
          {errorBorrar && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {errorBorrar}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setBorrando(null);
                setErrorBorrar(null);
              }}
              disabled={eliminar.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmarBorrado}
              disabled={eliminar.isPending}
            >
              {eliminar.isPending ? 'Borrando…' : 'Borrar franja'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
