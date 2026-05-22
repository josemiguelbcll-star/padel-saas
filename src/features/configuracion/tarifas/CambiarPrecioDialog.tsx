import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { CalendarClock } from 'lucide-react';
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
import { useCambiarPrecioTarifa } from '@/features/configuracion/hooks/useTarifas';
import type { TarifaLinaje } from './tarifaLineage';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmtFecha(iso: string): string {
  return fechaFmt.format(new Date(iso + 'T00:00:00'));
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function previusDayISO(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface CambiarPrecioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linaje: TarifaLinaje | null;
}

const schema = z.object({
  monto_nuevo: z
    .number({ invalid_type_error: 'Ingresá un monto válido.' })
    .positive('El monto debe ser mayor a 0.'),
  vigente_desde: z.string().min(1, 'La fecha es obligatoria.'),
});

type FieldErrors = Partial<Record<'monto_nuevo' | 'vigente_desde' | 'form', string>>;

/**
 * Cambia el precio de un linaje. Cierra la versión vigente y crea una
 * nueva. Soporta aumentos programados (fecha futura). Atómico server-side.
 */
export function CambiarPrecioDialog({
  open,
  onOpenChange,
  linaje,
}: CambiarPrecioDialogProps) {
  const cambiar = useCambiarPrecioTarifa();
  const [montoStr, setMontoStr] = useState('');
  const [vigenteDesde, setVigenteDesde] = useState(todayISO());
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = cambiar.isPending;

  useEffect(() => {
    if (open) {
      setMontoStr('');
      setVigenteDesde(todayISO());
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

    if (!linaje) return;
    if (!linaje.vigenteHoy) {
      setErrors({
        form: 'Este linaje no tiene una versión vigente hoy. Verificá las fechas.',
      });
      return;
    }

    const parsed = schema.safeParse({
      monto_nuevo: montoStr.trim() === '' ? NaN : Number(montoStr),
      vigente_desde: vigenteDesde,
    });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (p === 'monto_nuevo' || p === 'vigente_desde') {
          fe[p] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      await cambiar.mutateAsync({
        lineage_id: linaje.lineage_id,
        monto_nuevo: parsed.data.monto_nuevo,
        vigente_desde: parsed.data.vigente_desde,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos cambiar el precio.',
      });
    }
  }

  if (!linaje) return null;

  const actual = linaje.vigenteHoy;
  const esHoy = vigenteDesde === todayISO();
  const fechaCierreActual = actual && vigenteDesde > actual.vigente_desde
    ? previusDayISO(vigenteDesde)
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar precio · {linaje.nombre}</DialogTitle>
          <DialogDescription>
            El precio actual queda cerrado y se crea una nueva versión.
            El histórico de lo cobrado no se altera (las reservas tienen
            su monto snapshot).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Precio actual de referencia */}
          {actual && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">Precio actual</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {currencyFmt.format(actual.monto)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Vigente desde {fmtFecha(actual.vigente_desde)}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="precio-nuevo">Precio nuevo</Label>
              <Input
                id="precio-nuevo"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={montoStr}
                onChange={(e) => setMontoStr(e.target.value)}
                disabled={pending}
                autoFocus
                placeholder="0.00"
                aria-invalid={!!errors.monto_nuevo}
              />
              {errors.monto_nuevo && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.monto_nuevo}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="precio-vigente">Desde</Label>
              <Input
                id="precio-vigente"
                type="date"
                value={vigenteDesde}
                min={todayISO()}
                onChange={(e) => setVigenteDesde(e.target.value)}
                disabled={pending}
                aria-invalid={!!errors.vigente_desde}
              />
              {errors.vigente_desde && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.vigente_desde}
                </p>
              )}
            </div>
          </div>

          {/* Preview del cambio */}
          {actual && fechaCierreActual && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
              <CalendarClock
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-foreground">
                  El precio actual{' '}
                  <strong className="font-semibold">
                    {currencyFmt.format(actual.monto)}
                  </strong>{' '}
                  queda vigente hasta el{' '}
                  <strong className="font-semibold">{fmtFecha(fechaCierreActual)}</strong>.
                </p>
                <p className="text-muted-foreground">
                  Desde el {fmtFecha(vigenteDesde)}{' '}
                  {esHoy ? '(hoy)' : '(programado)'} rige el precio nuevo.
                </p>
              </div>
            </div>
          )}

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
              {pending ? 'Aplicando…' : 'Aplicar cambio'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
