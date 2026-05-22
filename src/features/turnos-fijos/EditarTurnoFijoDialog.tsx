import { useEffect, useState, type FormEvent } from 'react';
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
import { useActualizarTurnoFijo } from './hooks/useTurnosFijos';
import type { TurnoFijo } from '@/types/database';

interface EditarTurnoFijoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turno: TurnoFijo | null;
}

type FieldErrors = Partial<Record<'titular' | 'fecha_hasta' | 'form', string>>;

/**
 * Edita titular / fecha_hasta / observaciones de un turno fijo.
 * NO cambia cancha/día/hora/duración (para eso: desactivar + crear nuevo).
 * Las reservas ya materializadas mantienen sus snapshots (jugador_id,
 * monto_total). Los cambios afectan solo materializaciones futuras.
 */
export function EditarTurnoFijoDialog({
  open,
  onOpenChange,
  turno,
}: EditarTurnoFijoDialogProps) {
  const actualizar = useActualizarTurnoFijo();
  const [titular, setTitular] = useState<JugadorSeleccionado | null>(null);
  const [fechaHasta, setFechaHasta] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = actualizar.isPending;

  useEffect(() => {
    if (open && turno) {
      // Cargar titular existente.
      if (turno.jugador_id !== null) {
        // No tenemos el nombre directo del jugador acá — el autocomplete
        // muestra el nombre solo después de elegirlo. Para edit usamos
        // nombre_libre como placeholder visual si no hay nombre.
        setTitular({
          kind: 'jugador',
          jugadorId: turno.jugador_id,
          nombre: '(jugador actual)',
        });
      } else if (turno.nombre_libre) {
        setTitular({ kind: 'libre', nombre: turno.nombre_libre });
      } else {
        setTitular(null);
      }
      setFechaHasta(turno.fecha_hasta ?? '');
      setObservaciones(turno.observaciones ?? '');
      setErrors({});
    }
  }, [open, turno]);

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

    // Construir el input diferencial.
    const tituarCambio =
      (titular.kind === 'jugador' &&
        titular.jugadorId !== turno.jugador_id) ||
      (titular.kind === 'libre' && titular.nombre !== turno.nombre_libre);

    const jugadorId =
      titular.kind === 'jugador' ? titular.jugadorId : undefined;
    const nombreLibre =
      titular.kind === 'libre' ? titular.nombre : undefined;
    const clearJugador = titular.kind === 'libre' && turno.jugador_id !== null;
    const clearNombreLibre =
      titular.kind === 'jugador' && turno.nombre_libre !== null;

    const fechaHastaCambio = (fechaHasta || null) !== turno.fecha_hasta;
    const obsCambio = (observaciones || null) !== turno.observaciones;

    try {
      await actualizar.mutateAsync({
        id: turno.id,
        jugador_id: tituarCambio ? jugadorId ?? null : undefined,
        nombre_libre: tituarCambio ? nombreLibre ?? null : undefined,
        clear_jugador: clearJugador,
        clear_nombre_libre: clearNombreLibre,
        fecha_hasta: fechaHastaCambio && fechaHasta !== '' ? fechaHasta : undefined,
        clear_fecha_hasta: fechaHastaCambio && fechaHasta === '',
        observaciones: obsCambio && observaciones !== '' ? observaciones : undefined,
        clear_observaciones: obsCambio && observaciones === '',
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar turno fijo</DialogTitle>
          <DialogDescription>
            Podés cambiar titular, fecha hasta o las observaciones. Cancha,
            día, hora y duración no se cambian acá (desactivá + creá uno
            nuevo si necesitás moverlo).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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

          <div className="space-y-1">
            <Label htmlFor="edit-tf-hasta">Vigente hasta (opcional)</Label>
            <Input
              id="edit-tf-hasta"
              type="date"
              value={fechaHasta}
              min={turno.fecha_desde}
              onChange={(e) => setFechaHasta(e.target.value)}
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              Vacío = indefinido. Las reservas ya materializadas se mantienen.
            </p>
          </div>

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
