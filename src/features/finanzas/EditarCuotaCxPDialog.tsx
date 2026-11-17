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
import type { CuentaPorPagarFila } from './hooks/useCuentasPorPagar';
import { useActualizarCuotaCxP } from './hooks/useActualizarCuotaCxP';

interface EditarCuotaCxPDialogProps {
  cuota: CuentaPorPagarFila | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditarCuotaCxPDialog({
  cuota,
  open,
  onOpenChange,
}: EditarCuotaCxPDialogProps) {
  const actualizar = useActualizarCuotaCxP();
  const [monto, setMonto] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !cuota) return;
    setMonto(String(cuota.monto));
    setFechaVencimiento(cuota.fecha_vencimiento ?? '');
    setError(null);
  }, [cuota, open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!cuota) return;

    const montoNumerico = Number(monto);
    if (!Number.isFinite(montoNumerico) || montoNumerico <= 0) {
      setError('El monto debe ser mayor a 0.');
      return;
    }

    setError(null);
    try {
      await actualizar.mutateAsync({
        cuota_id: cuota.id,
        monto: montoNumerico,
        fecha_vencimiento: fechaVencimiento || null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos actualizar la cuota.');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!actualizar.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar cuenta por pagar</DialogTitle>
          <DialogDescription>
            Cambiá el importe o vencimiento de esta cuota pendiente. El total
            del gasto se ajustará por la diferencia para mantener las cuotas
            conciliadas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="cxp-editar-monto">Monto</Label>
            <Input
              id="cxp-editar-monto"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={monto}
              onChange={(event) => setMonto(event.target.value)}
              disabled={actualizar.isPending}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="cxp-editar-vencimiento">Fecha de vencimiento</Label>
            <Input
              id="cxp-editar-vencimiento"
              type="date"
              value={fechaVencimiento}
              onChange={(event) => setFechaVencimiento(event.target.value)}
              disabled={actualizar.isPending}
            />
          </div>

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
              onClick={() => onOpenChange(false)}
              disabled={actualizar.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={actualizar.isPending}>
              {actualizar.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
