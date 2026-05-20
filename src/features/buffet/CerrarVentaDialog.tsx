import { useState, type FormEvent } from 'react';
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
import type { MedioPago, Venta } from '@/types/database';
import {
  useCerrarVenta,
  type CerrarVentaItem,
} from './hooks/useCerrarVenta';
import type { VentaItemEnriquecido } from './VentaActual';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MEDIOS_PAGO_LIST: readonly MedioPago[] = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'otro',
] as const;

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

interface CerrarVentaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: VentaItemEnriquecido[];
  total: number;
  /** Se llama tras un cierre exitoso con la venta creada. El padre limpia
   *  el carrito y muestra el mensaje de "venta registrada". */
  onSuccess: (venta: Venta) => void;
}

export function CerrarVentaDialog({
  open,
  onOpenChange,
  items,
  total,
  onSuccess,
}: CerrarVentaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <CerrarVentaBody
          // Remount cada vez que se abre: medio/observaciones/error
          // arrancan limpios. Si el padre dispara dos cierres seguidos
          // de la misma sesión, este key sincroniza.
          key={open ? 'open' : 'closed'}
          items={items}
          total={total}
          onSuccess={onSuccess}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CerrarVentaBodyProps {
  items: VentaItemEnriquecido[];
  total: number;
  onSuccess: (venta: Venta) => void;
  onCancel: () => void;
}

function CerrarVentaBody({
  items,
  total,
  onSuccess,
  onCancel,
}: CerrarVentaBodyProps) {
  const [medio, setMedio] = useState<MedioPago | null>('efectivo');
  const [obs, setObs] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cerrarMutation = useCerrarVenta();
  const isPending = cerrarMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (items.length === 0) {
      setError('La venta está vacía.');
      return;
    }
    if (!medio) {
      setError('Elegí un medio de pago.');
      return;
    }

    const rpcItems: CerrarVentaItem[] = items.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
    }));

    try {
      const venta = await cerrarMutation.mutateAsync({
        items: rpcItems,
        medio_pago: medio,
        observaciones: obs.trim() === '' ? null : obs.trim(),
      });
      onSuccess(venta);
    } catch (err) {
      // Errores típicos del RPC (todos en castellano via dbErrors):
      //   "Stock insuficiente de «X»: hay Y, querés vender Z."
      //   "El producto «X» está desactivado, no se puede vender."
      // Se muestran en el banner para que el vendedor entienda y ajuste.
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos registrar la venta.',
      );
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cerrar venta</DialogTitle>
        <DialogDescription>
          Total a cobrar:{' '}
          <span className="font-semibold text-foreground tabular-nums">
            {currencyFmt.format(total)}
          </span>
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Resumen breve de items */}
        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
          {items.map((item) => (
            <div
              key={item.producto.id}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="truncate text-muted-foreground">
                {item.cantidad}× {item.producto.nombre}
              </span>
              <span className="shrink-0 tabular-nums text-foreground">
                {currencyFmt.format(item.subtotal)}
              </span>
            </div>
          ))}
        </div>

        {/* Medio de pago */}
        <div className="space-y-2">
          <Label>Medio de pago</Label>
          <div className="flex flex-wrap gap-1.5">
            {MEDIOS_PAGO_LIST.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMedio(m)}
                disabled={isPending}
                aria-pressed={medio === m}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  medio === m
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {MEDIO_PAGO_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Observaciones (opcional) */}
        <div className="space-y-2">
          <Label htmlFor="cerrar-venta-obs">Observaciones (opcional)</Label>
          <Input
            id="cerrar-venta-obs"
            type="text"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            disabled={isPending}
            maxLength={500}
            placeholder="Notas internas de esta venta…"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Registrando…' : 'Confirmar venta'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
