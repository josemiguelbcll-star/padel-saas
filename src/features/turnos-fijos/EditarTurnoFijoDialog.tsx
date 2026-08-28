import { useEffect, useState, type FormEvent } from 'react';
import { Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { JugadorAutocomplete } from '@/features/reservas/JugadorAutocomplete';
import type { JugadorSeleccionado } from '@/features/reservas/JugadorAutocomplete';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { useJugadores } from '@/features/reservas/hooks/useJugadores';
import { useActualizarTurnoFijo } from './hooks/useTurnosFijos';
import type { TurnoFijo } from '@/types/database';

const DIAS_SEMANA = [
  { value: 1, label: 'LUN', full: 'Lunes' },
  { value: 2, label: 'MAR', full: 'Martes' },
  { value: 3, label: 'MIE', full: 'Miércoles' },
  { value: 4, label: 'JUE', full: 'Jueves' },
  { value: 5, label: 'VIE', full: 'Viernes' },
  { value: 6, label: 'SAB', full: 'Sábado' },
  { value: 7, label: 'DOM', full: 'Domingo' },
] as const;

const DURACIONES = [60, 90, 120] as const;

interface EditarTurnoFijoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turno: TurnoFijo | null;
}

type FieldErrors = Partial<Record<
  | 'cancha_id'
  | 'titular'
  | 'dia_semana'
  | 'hora_inicio'
  | 'duracion_min'
  | 'fecha_desde'
  | 'fecha_hasta'
  | 'form',
  string
>>;

export function EditarTurnoFijoDialog({
  open,
  onOpenChange,
  turno,
}: EditarTurnoFijoDialogProps) {
  const actualizar = useActualizarTurnoFijo();
  const canchasQuery = useCanchas();
  const jugadoresQuery = useJugadores();

  const [titular, setTitular] = useState<JugadorSeleccionado | null>(null);
  const [canchaId, setCanchaId] = useState('');
  const [diaSemana, setDiaSemana] = useState<number | null>(null);
  const [horaInicio, setHoraInicio] = useState('');
  const [duracionMin, setDuracionMin] = useState(90);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = actualizar.isPending;

  useEffect(() => {
    if (open && turno) {
      if (turno.jugador_id !== null) {
        const j = (jugadoresQuery.data ?? []).find((x) => x.id === turno.jugador_id);
        setTitular({
          kind: 'jugador',
          jugadorId: turno.jugador_id,
          nombre: j ? j.nombre : '(jugador actual)',
        });
      } else if (turno.nombre_libre) {
        setTitular({ kind: 'libre', nombre: turno.nombre_libre });
      } else {
        setTitular(null);
      }
      setCanchaId(String(turno.cancha_id));
      setDiaSemana(turno.dia_semana);
      setHoraInicio(turno.hora_inicio.slice(0, 5));
      setDuracionMin(turno.duracion_min);
      setFechaDesde(turno.fecha_desde);
      setFechaHasta(turno.fecha_hasta ?? '');
      setObservaciones(turno.observaciones ?? '');
      setErrors({});
    }
  }, [open, turno, jugadoresQuery.data]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    if (!turno) return;

    if (!titular) {
      setErrors({ titular: 'Tenés que indicar un cliente o un nombre.' });
      return;
    }
    if (!canchaId) {
      setErrors({ cancha_id: 'Elegí una cancha.' });
      return;
    }
    if (diaSemana === null) {
      setErrors({ dia_semana: 'Elegí el día de la semana.' });
      return;
    }
    if (!horaInicio) {
      setErrors({ hora_inicio: 'Elegí la hora de inicio.' });
      return;
    }
    if (!fechaDesde) {
      setErrors({ fecha_desde: 'La fecha desde es obligatoria.' });
      return;
    }

    const jugadorId = titular.kind === 'jugador' ? titular.jugadorId : null;
    const nombreLibre = titular.kind === 'libre' ? titular.nombre : null;
    const clearJugador = titular.kind === 'libre' && turno.jugador_id !== null;
    const clearNombreLibre = titular.kind === 'jugador' && turno.nombre_libre !== null;

    const canchaIdNum = Number(canchaId);
    const duracionMinNum = Number(duracionMin);
    const parsedFechaHasta = fechaHasta === '' ? null : fechaHasta;
    const parsedObservaciones = observaciones === '' ? null : observaciones;

    try {
      await actualizar.mutateAsync({
        id: turno.id,
        cancha_id: canchaIdNum,
        dia_semana: diaSemana,
        hora_inicio: horaInicio,
        duracion_min: duracionMinNum,
        fecha_desde: fechaDesde,
        jugador_id: jugadorId,
        nombre_libre: nombreLibre,
        clear_jugador: clearJugador,
        clear_nombre_libre: clearNombreLibre,
        fecha_hasta: parsedFechaHasta,
        clear_fecha_hasta: parsedFechaHasta === null,
        observaciones: parsedObservaciones,
        clear_observaciones: parsedObservaciones === null,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos guardar los cambios.',
      });
    }
  }

  if (!turno) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-primary" aria-hidden="true" />
            Editar turno fijo
          </DialogTitle>
          <DialogDescription>
            Podés modificar cualquiera de los parámetros del turno fijo. Los cambios afectarán las materializaciones futuras.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Cliente */}
          <div className="space-y-1">
            <Label htmlFor="edit-tf-titular">Cliente</Label>
            <JugadorAutocomplete
              id="edit-tf-titular"
              value={titular}
              onChange={setTitular}
              permitirNombreLibre={true}
              disabled={pending}
              placeholder="Buscá un jugador o tipeá un nombre"
              aria-label="Cliente del turno fijo"
            />
            {errors.titular && (
              <p role="alert" className="text-xs text-destructive">{errors.titular}</p>
            )}
          </div>

          {/* Cancha + Día */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-tf-cancha">Cancha</Label>
              <select
                id="edit-tf-cancha"
                value={canchaId}
                onChange={(e) => setCanchaId(e.target.value)}
                disabled={pending || canchasQuery.isLoading}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
                aria-invalid={!!errors.cancha_id}
              >
                <option value="">— Elegí —</option>
                {(canchasQuery.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
              {errors.cancha_id && (
                <p role="alert" className="text-xs text-destructive">{errors.cancha_id}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Día de la semana</Label>
              <div className="flex flex-wrap gap-1">
                {DIAS_SEMANA.map((d) => {
                  const sel = diaSemana === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDiaSemana(d.value)}
                      disabled={pending}
                      title={d.full}
                      aria-pressed={sel}
                      aria-label={d.full}
                      className={cn(
                        'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        sel
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              {errors.dia_semana && (
                <p role="alert" className="text-xs text-destructive">{errors.dia_semana}</p>
              )}
            </div>
          </div>

          {/* Hora + Duración */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-tf-hora">Hora de inicio</Label>
              <Input
                id="edit-tf-hora"
                type="time"
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
                disabled={pending}
                aria-invalid={!!errors.hora_inicio}
              />
              {errors.hora_inicio && (
                <p role="alert" className="text-xs text-destructive">{errors.hora_inicio}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-tf-duracion">Duración</Label>
              <select
                id="edit-tf-duracion"
                value={duracionMin}
                onChange={(e) => setDuracionMin(Number(e.target.value))}
                disabled={pending}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {DURACIONES.map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vigencia */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-tf-desde">Vigente desde</Label>
              <Input
                id="edit-tf-desde"
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                disabled={pending}
                aria-invalid={!!errors.fecha_desde}
              />
              {errors.fecha_desde && (
                <p role="alert" className="text-xs text-destructive">{errors.fecha_desde}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-tf-hasta">Hasta (opcional)</Label>
              <Input
                id="edit-tf-hasta"
                type="date"
                value={fechaHasta}
                min={fechaDesde || undefined}
                onChange={(e) => setFechaHasta(e.target.value)}
                disabled={pending}
              />
              <p className="text-[11px] text-muted-foreground">
                Vacío = indefinido.
              </p>
            </div>
          </div>

          {/* Observaciones */}
          <div className="space-y-1">
            <Label htmlFor="edit-tf-obs">Observaciones (opcional)</Label>
            <textarea
              id="edit-tf-obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              disabled={pending}
              rows={2}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
          </div>

          {errors.form && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {errors.form}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
