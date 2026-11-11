import { useEffect, useState, type FormEvent } from 'react';
import { PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEliminarUnidad } from '@/features/finanzas/hooks/useUnidadesNegocio';
import type { UnidadNegocio } from '@/types/database';

interface EliminarUnidadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unidad: UnidadNegocio | null;
  /** Cantidad de categorías de gasto asociadas (informativo). */
  cantCategorias?: number;
}

/**
 * Desactiva (`activa = FALSE`) una unidad de negocio.
 *
 * No es un borrado: la unidad se conserva y solo deja de aparecer en los
 * selectores, preservando su historial para el EERR. Se puede volver a
 * activar editándola.
 */
export function EliminarUnidadDialog({
  open,
  onOpenChange,
  unidad,
  cantCategorias = 0,
}: EliminarUnidadDialogProps) {
  const desactivar = useEliminarUnidad();
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const pending = desactivar.isPending;

  useEffect(() => {
    if (open) {
      setError(null);
      setListo(false);
    }
  }, [open]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!unidad) return;

    try {
      await desactivar.mutateAsync(unidad.id);
      setListo(true);
      setTimeout(() => onOpenChange(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos desactivar la unidad.');
    }
  }

  if (!unidad) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PowerOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Desactivar unidad de negocio
          </DialogTitle>
          <DialogDescription>
            La unidad dejará de aparecer en los selectores del sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium text-foreground">
            Vas a desactivar la unidad &quot;{unidad.nombre}&quot;.
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>
              No se elimina nada: se conserva su historial para el estado de
              resultados.
            </li>
            {cantCategorias > 0 && (
              <li>
                Sus{' '}
                <strong>
                  {cantCategorias}{' '}
                  {cantCategorias === 1 ? 'categoría' : 'categorías'}
                </strong>{' '}
                de gasto se mantienen.
              </li>
            )}
            <li>
              Podés volver a activarla cuando quieras desde &quot;Editar&quot;.
            </li>
          </ul>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {listo && (
            <div
              role="status"
              className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-foreground"
            >
              ✓ Unidad desactivada.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || listo}>
              {pending ? 'Desactivando…' : 'Desactivar unidad'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
