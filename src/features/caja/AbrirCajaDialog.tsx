import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
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
import { useAbrirCaja } from './hooks/useAbrirCaja';

interface AbrirCajaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const abrirCajaSchema = z.object({
  montoApertura: z
    .number({ invalid_type_error: 'Ingresá un número válido.' })
    .nonnegative('El monto no puede ser negativo.'),
});

/**
 * Modal de apertura de caja. Pide el monto inicial (puede ser 0).
 *
 * Quién puede abrir: admin O vendedor (gate enforced server-side por
 * `fn_abrir_caja` — corrección 1 del plan).
 */
export function AbrirCajaDialog({ open, onOpenChange }: AbrirCajaDialogProps) {
  const abrirMutation = useAbrirCaja();
  const [montoStr, setMontoStr] = useState('');
  const [errorMonto, setErrorMonto] = useState<string | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const pending = abrirMutation.isPending;

  useEffect(() => {
    if (open) {
      setMontoStr('');
      setErrorMonto(null);
      setErrorForm(null);
    }
  }, [open]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMonto(null);
    setErrorForm(null);

    const montoNum = montoStr.trim() === '' ? NaN : Number(montoStr);
    const parsed = abrirCajaSchema.safeParse({ montoApertura: montoNum });
    if (!parsed.success) {
      setErrorMonto(
        parsed.error.issues[0]?.message ?? 'Monto inválido.',
      );
      return;
    }

    try {
      await abrirMutation.mutateAsync({ montoApertura: parsed.data.montoApertura });
      onOpenChange(false);
    } catch (err) {
      setErrorForm(
        err instanceof Error ? err.message : 'No pudimos abrir la caja.',
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Abrir caja del día</DialogTitle>
          <DialogDescription>
            Ingresá el monto en efectivo con el que arrancás la jornada
            (puede ser 0 si no hay fondo inicial).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="abrir-caja-monto">Monto de apertura</Label>
            <Input
              id="abrir-caja-monto"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={montoStr}
              onChange={(e) => setMontoStr(e.target.value)}
              disabled={pending}
              autoFocus
              placeholder="0.00"
              aria-invalid={!!errorMonto}
            />
            {errorMonto && (
              <p role="alert" className="text-xs text-destructive">
                {errorMonto}
              </p>
            )}
          </div>

          {errorForm && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {errorForm}
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
              {pending ? 'Abriendo…' : 'Abrir caja'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
