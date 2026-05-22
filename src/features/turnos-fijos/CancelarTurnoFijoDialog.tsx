import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCancelarTurnoFijo } from './hooks/useTurnosFijos';
import type { TurnoFijo } from '@/types/database';

interface CancelarTurnoFijoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turno: TurnoFijo | null;
}

/**
 * Desactiva un turno fijo (soft-disable). Toggle "cancelar pendientes"
 * para los casos en que el cliente avisa hoy que no viene más y
 * queremos limpiar la agenda futura. NO toca pagadas/señadas/jugadas.
 */
export function CancelarTurnoFijoDialog({
  open,
  onOpenChange,
  turno,
}: CancelarTurnoFijoDialogProps) {
  const cancelar = useCancelarTurnoFijo();
  const [cancelarPendientes, setCancelarPendientes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ canceladas: number } | null>(null);

  const pending = cancelar.isPending;

  useEffect(() => {
    if (open) {
      setCancelarPendientes(false);
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
      const r = await cancelar.mutateAsync({
        id: turno.id,
        cancelar_pendientes: cancelarPendientes,
      });
      setResultado({ canceladas: r.reservas_canceladas });
      // Cerrar después de un beat para que el admin vea el conteo.
      setTimeout(() => onOpenChange(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos desactivar el turno fijo.');
    }
  }

  if (!turno) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Desactivar turno fijo</DialogTitle>
          <DialogDescription>
            El turno fijo queda inactivo: no se materializan más reservas
            a partir de él. Las reservas ya generadas se mantienen como
            están (a menos que actives la opción de abajo).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
            <div className="space-y-1">
              <Label htmlFor="cancel-pendientes" className="cursor-pointer">
                ¿Cancelar también las próximas reservas pendientes?
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Marca como "cancelada" todas las reservas futuras de este
                turno que aún no están pagadas/señadas. Útil cuando el
                cliente avisa hoy que no viene más.
              </p>
            </div>
            <Switch
              id="cancel-pendientes"
              checked={cancelarPendientes}
              onCheckedChange={setCancelarPendientes}
              disabled={pending}
            />
          </div>

          {cancelarPendientes && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                aria-hidden="true"
              />
              <p>
                Las reservas pagadas/señadas/jugadas no se tocan
                (preserva historia). Solo las pendientes futuras.
              </p>
            </div>
          )}

          {resultado && (
            <div
              role="status"
              className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-foreground"
            >
              ✓ Turno desactivado.{' '}
              {resultado.canceladas > 0
                ? `${resultado.canceladas} reservas pendientes futuras se cancelaron.`
                : 'Las reservas ya materializadas se mantienen.'}
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

          <DialogFooter>
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
              {pending ? 'Desactivando…' : 'Desactivar turno fijo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
