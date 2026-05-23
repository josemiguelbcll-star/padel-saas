import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Settings2 } from 'lucide-react';
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
import type { ProductoConStock } from '@/types/database';
import { useAjustarStock } from './hooks/useAjustarStock';

type TipoAjuste = 'sumar' | 'restar';

const RAZONES_PREDEFINIDAS = [
  'Recuento físico',
  'Rotura',
  'Faltante',
  'Vencido',
  'Otro',
] as const;

type RazonPredefinida = (typeof RAZONES_PREDEFINIDAS)[number];

interface AjustarStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  producto: ProductoConStock | null;
}

/**
 * Dialog de ajuste manual de stock. UX:
 *   - Toggle ⊕ Sumar / ⊖ Restar (cantidad siempre positiva en input).
 *   - Razón obligatoria (selector + textarea si "Otro").
 *   - Preview en vivo del stock resultante.
 *
 * La RPC fn_ajustar_stock recibe cantidad con signo (+ o -) y rechaza
 * resultante negativo. El gate admin está server-side.
 */
export function AjustarStockDialog({
  open,
  onOpenChange,
  producto,
}: AjustarStockDialogProps) {
  const ajustar = useAjustarStock();

  const [tipo, setTipo] = useState<TipoAjuste>('sumar');
  const [cantidadStr, setCantidadStr] = useState('');
  const [razonPredef, setRazonPredef] = useState<RazonPredefinida>('Recuento físico');
  const [razonOtro, setRazonOtro] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pending = ajustar.isPending;

  useEffect(() => {
    if (open) {
      setTipo('sumar');
      setCantidadStr('');
      setRazonPredef('Recuento físico');
      setRazonOtro('');
      setError(null);
    }
  }, [open]);

  const stockActual = producto?.stock_actual ?? 0;
  const cantidadNum = useMemo(() => {
    const n = Number(cantidadStr);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [cantidadStr]);

  const signed = tipo === 'sumar' ? cantidadNum : -cantidadNum;
  const stockResultante = stockActual + signed;
  const stockNegativo = cantidadNum > 0 && stockResultante < 0;

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!producto) return;

    if (cantidadNum <= 0) {
      setError('Ingresá una cantidad mayor a 0.');
      return;
    }
    const razonFinal =
      razonPredef === 'Otro'
        ? razonOtro.trim()
        : razonPredef;
    if (!razonFinal) {
      setError('La razón es obligatoria. Detallala si elegís "Otro".');
      return;
    }
    if (stockNegativo) {
      setError(
        `El ajuste dejaría stock en ${stockResultante}. Ajustá solo hasta lo que hay (${stockActual}).`,
      );
      return;
    }

    try {
      await ajustar.mutateAsync({
        producto_id: producto.id,
        cantidad: signed,
        razon: razonFinal,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos ajustar el stock.');
    }
  }

  if (!producto) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" aria-hidden="true" />
            Ajustar stock
          </DialogTitle>
          <DialogDescription>
            {producto.nombre} · stock actual{' '}
            <strong className="font-semibold tabular-nums text-foreground">
              {stockActual}
            </strong>{' '}
            unidades
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Toggle Sumar / Restar */}
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de ajuste</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipo('sumar')}
                disabled={pending}
                aria-pressed={tipo === 'sumar'}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  tipo === 'sumar'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                Sumar (entrada)
              </button>
              <button
                type="button"
                onClick={() => setTipo('restar')}
                disabled={pending}
                aria-pressed={tipo === 'restar'}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  tipo === 'restar'
                    ? 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                Restar (salida)
              </button>
            </div>
          </div>

          {/* Cantidad + preview */}
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-cantidad" className="text-xs">
              Cantidad
            </Label>
            <Input
              id="ajuste-cantidad"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              value={cantidadStr}
              onChange={(e) => setCantidadStr(e.target.value)}
              disabled={pending}
              autoFocus
              placeholder="0"
            />
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-xs',
                stockNegativo
                  ? 'border-red-500/40 bg-red-500/5 text-red-700 dark:text-red-400'
                  : 'border-border bg-muted/30 text-muted-foreground',
              )}
            >
              Stock resultante:{' '}
              <strong
                className={cn(
                  'tabular-nums',
                  stockNegativo
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-foreground',
                )}
              >
                {stockResultante}
              </strong>{' '}
              {stockNegativo && '(no puede quedar en negativo)'}
            </div>
          </div>

          {/* Razón */}
          <div className="space-y-1.5">
            <Label htmlFor="ajuste-razon" className="text-xs">
              Razón <span className="text-destructive">*</span>
            </Label>
            <select
              id="ajuste-razon"
              value={razonPredef}
              onChange={(e) =>
                setRazonPredef(e.target.value as RazonPredefinida)
              }
              disabled={pending}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {RAZONES_PREDEFINIDAS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {razonPredef === 'Otro' && (
              <Input
                type="text"
                value={razonOtro}
                onChange={(e) => setRazonOtro(e.target.value)}
                disabled={pending}
                maxLength={200}
                placeholder="Detallá la razón…"
                aria-label="Detalle de la razón"
              />
            )}
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
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || cantidadNum <= 0}>
              {pending ? 'Guardando…' : 'Confirmar ajuste'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
