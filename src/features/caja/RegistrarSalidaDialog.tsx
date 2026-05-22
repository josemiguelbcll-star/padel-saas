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
import { cn } from '@/lib/utils';
import type { TipoMovimientoCaja } from '@/types/database';
import { useRegistrarMovimientoCaja } from './hooks/useRegistrarMovimientoCaja';

interface RegistrarSalidaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turnoCajaId: number;
}

const TIPOS: ReadonlyArray<{
  value: TipoMovimientoCaja;
  label: string;
  ayuda: string;
  signo: 'sale' | 'entra';
}> = [
  { value: 'retiro', label: 'Retiro', ayuda: 'El dueño/admin retira efectivo del cajón.', signo: 'sale' },
  { value: 'pago_proveedor', label: 'Pago a proveedor', ayuda: 'Pago en efectivo a un proveedor.', signo: 'sale' },
  { value: 'ajuste_negativo', label: 'Ajuste − (faltante)', ayuda: 'Encontraste un faltante en el cajón.', signo: 'sale' },
  { value: 'ajuste_positivo', label: 'Ajuste + (sobrante)', ayuda: 'Encontraste un sobrante en el cajón.', signo: 'entra' },
];

const schema = z.object({
  tipo: z.enum(['retiro', 'pago_proveedor', 'ajuste_positivo', 'ajuste_negativo']),
  monto: z
    .number({ invalid_type_error: 'Ingresá un número válido.' })
    .positive('El monto debe ser mayor a 0.'),
  concepto: z
    .string()
    .trim()
    .min(1, 'El concepto es obligatorio.')
    .max(200, 'El concepto puede tener hasta 200 caracteres.'),
  observaciones: z
    .string()
    .trim()
    .max(2000, 'Las observaciones pueden tener hasta 2000 caracteres.')
    .optional(),
});

/**
 * Modal para registrar una salida / ajuste manual en la caja abierta.
 * Quién: admin O vendedor (server-side por `fn_registrar_movimiento_caja_manual`).
 *
 * El tipo determina el signo en el cálculo del esperado al cierre:
 *   - retiro / pago_proveedor / ajuste_negativo → resta.
 *   - ajuste_positivo → suma (sobrante encontrado durante operación).
 */
export function RegistrarSalidaDialog({
  open,
  onOpenChange,
  turnoCajaId,
}: RegistrarSalidaDialogProps) {
  const registrar = useRegistrarMovimientoCaja();
  const [tipo, setTipo] = useState<TipoMovimientoCaja>('retiro');
  const [montoStr, setMontoStr] = useState('');
  const [concepto, setConcepto] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [errors, setErrors] = useState<
    Partial<Record<'monto' | 'concepto' | 'observaciones' | 'form', string>>
  >({});

  const pending = registrar.isPending;

  useEffect(() => {
    if (open) {
      setTipo('retiro');
      setMontoStr('');
      setConcepto('');
      setObservaciones('');
      setErrors({});
    }
  }, [open]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const montoNum = montoStr.trim() === '' ? NaN : Number(montoStr);
    const parsed = schema.safeParse({
      tipo,
      monto: montoNum,
      concepto,
      observaciones: observaciones.trim() === '' ? undefined : observaciones,
    });
    if (!parsed.success) {
      const fe: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'monto' || path === 'concepto' || path === 'observaciones') {
          fe[path] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      await registrar.mutateAsync({
        tipo: parsed.data.tipo,
        monto: parsed.data.monto,
        concepto: parsed.data.concepto,
        observaciones: parsed.data.observaciones,
        turnoCajaId,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos registrar el movimiento.',
      });
    }
  }

  const tipoConfig = TIPOS.find((t) => t.value === tipo)!;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar movimiento manual</DialogTitle>
          <DialogDescription>
            Salidas, pagos y ajustes que afectan el efectivo de la caja
            abierta. Los movimientos quedan registrados de forma
            permanente — para corregir, registrá uno compensatorio.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Tipo */}
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map((t) => {
                const active = t.value === tipo;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    disabled={pending}
                    aria-pressed={active}
                    className={cn(
                      'rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    <div className="font-medium">{t.label}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {t.ayuda}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {tipoConfig.signo === 'sale'
                ? 'Resta al efectivo esperado al cierre.'
                : 'Suma al efectivo esperado al cierre.'}
            </p>
          </div>

          {/* Monto */}
          <div className="space-y-1">
            <Label htmlFor="mov-monto">Monto</Label>
            <Input
              id="mov-monto"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={montoStr}
              onChange={(e) => setMontoStr(e.target.value)}
              disabled={pending}
              placeholder="0.00"
              aria-invalid={!!errors.monto}
            />
            {errors.monto && (
              <p role="alert" className="text-xs text-destructive">
                {errors.monto}
              </p>
            )}
          </div>

          {/* Concepto */}
          <div className="space-y-1">
            <Label htmlFor="mov-concepto">Concepto</Label>
            <Input
              id="mov-concepto"
              type="text"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              disabled={pending}
              maxLength={200}
              placeholder="Ej: pago coca-cola, retiro caja, cambio de billete"
              aria-invalid={!!errors.concepto}
            />
            {errors.concepto && (
              <p role="alert" className="text-xs text-destructive">
                {errors.concepto}
              </p>
            )}
          </div>

          {/* Observaciones opcional */}
          <div className="space-y-1">
            <Label htmlFor="mov-obs">Observaciones (opcional)</Label>
            <textarea
              id="mov-obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              disabled={pending}
              maxLength={2000}
              rows={2}
              placeholder="Notas adicionales…"
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.observaciones && (
              <p role="alert" className="text-xs text-destructive">
                {errors.observaciones}
              </p>
            )}
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
              {pending ? 'Registrando…' : 'Registrar movimiento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
