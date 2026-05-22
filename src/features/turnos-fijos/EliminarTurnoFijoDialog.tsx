import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEliminarTurnoFijo } from './hooks/useTurnosFijos';
import type { TurnoFijo } from '@/types/database';

interface EliminarTurnoFijoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turno: TurnoFijo | null;
  /** Para personalizar el mensaje con el nombre del titular. */
  titularNombre?: string;
}

/**
 * Elimina (DELETE) un turno fijo. Acción destructiva e irreversible.
 *
 * Diferencia clave con `CancelarTurnoFijoDialog`:
 *  - Cancelar = activo=FALSE. La fila queda en la DB inactiva.
 *  - Eliminar = DELETE. La fila se borra y el slot queda libre para otro
 *    turno fijo. Las reservas pendientes futuras se cancelan; las
 *    pagadas/jugadas se preservan en el historial sin link al turno.
 */
export function EliminarTurnoFijoDialog({
  open,
  onOpenChange,
  turno,
  titularNombre,
}: EliminarTurnoFijoDialogProps) {
  const eliminar = useEliminarTurnoFijo();
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ canceladas: number } | null>(null);

  const pending = eliminar.isPending;

  useEffect(() => {
    if (open) {
      setError(null);
      setResultado(null);
    }
  }, [open]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!turno) return;

    try {
      const r = await eliminar.mutateAsync({ id: turno.id });
      setResultado({ canceladas: r.reservas_canceladas });
      setTimeout(() => onOpenChange(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos eliminar el turno fijo.');
    }
  }

  if (!turno) return null;

  const nombre = titularNombre ?? turno.nombre_libre ?? `Turno fijo #${turno.id}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
            Eliminar turno fijo
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
              Vas a eliminar el turno fijo de {nombre}.
            </p>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>
                Se <strong>cancelan</strong> automáticamente las reservas
                futuras pendientes asociadas a este turno fijo.
              </li>
              <li>
                Las reservas ya <strong>cobradas/jugadas se preservan</strong>{' '}
                en el historial (no se borran).
              </li>
              <li>
                El horario queda <strong>libre</strong> para crear otro
                turno fijo o aceptar reservas sueltas.
              </li>
            </ul>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Si solo querés pausar el turno fijo conservándolo en la base,
          usá "Desactivar" en su lugar.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          {resultado && (
            <div
              role="status"
              className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-foreground"
            >
              ✓ Turno fijo eliminado.{' '}
              {resultado.canceladas > 0
                ? `${resultado.canceladas} reservas pendientes futuras se cancelaron.`
                : 'No había reservas pendientes futuras.'}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || resultado !== null}
            >
              {pending ? 'Eliminando…' : 'Eliminar definitivamente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
