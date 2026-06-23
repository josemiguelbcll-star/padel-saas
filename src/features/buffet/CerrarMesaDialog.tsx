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
import { useCerrarMesa, type BuffetMesa } from './hooks/useMesasBuffet';
import { useJugadores } from '@/features/reservas/hooks/useJugadores';

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
  'cuenta_corriente',
  'otro',
] as const;

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cuenta_corriente: 'Cuenta Corriente',
  otro: 'Otro',
};

interface CerrarMesaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mesa: BuffetMesa | null;
  onSuccess: (venta: Venta) => void;
}

export function CerrarMesaDialog({
  open,
  onOpenChange,
  mesa,
  onSuccess,
}: CerrarMesaDialogProps) {
  if (!mesa) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <CerrarMesaBody
          key={mesa.id}
          mesa={mesa}
          onSuccess={onSuccess}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CerrarMesaBodyProps {
  mesa: BuffetMesa;
  onSuccess: (venta: Venta) => void;
  onCancel: () => void;
}

function CerrarMesaBody({
  mesa,
  onSuccess,
  onCancel,
}: CerrarMesaBodyProps) {
  const [medio, setMedio] = useState<MedioPago | null>('efectivo');
  const [obs, setObs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [jugadorId, setJugadorId] = useState<number | null>(null);

  const jugadoresQuery = useJugadores();
  const jugadores = jugadoresQuery.data ?? [];

  const cerrarMesaMutation = useCerrarMesa();
  const isPending = cerrarMesaMutation.isPending;

  const total = mesa.consumos.reduce(
    (sum, c) => sum + c.producto.precio * c.cantidad,
    0,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (mesa.consumos.length === 0) {
      setError('La mesa no tiene consumos registrados.');
      return;
    }
    if (!medio) {
      setError('Elegí un medio de pago.');
      return;
    }
    if (medio === 'cuenta_corriente' && !jugadorId) {
      setError('Elegí un cliente para la cuenta corriente.');
      return;
    }

    try {
      const venta = await cerrarMesaMutation.mutateAsync({
        mesaId: mesa.id,
        medioPago: medio,
        observaciones: obs.trim(),
        jugadorId: medio === 'cuenta_corriente' ? jugadorId : null,
      });
      onSuccess(venta);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos cerrar la mesa.',
      );
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cerrar {mesa.nombre}</DialogTitle>
        <DialogDescription>
          Total acumulado:{' '}
          <span className="font-semibold text-foreground tabular-nums">
            {currencyFmt.format(total)}
          </span>
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Resumen de consumos */}
        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm max-h-[160px] overflow-y-auto">
          {mesa.consumos.map((item) => (
            <div
              key={item.id}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="truncate text-muted-foreground">
                {item.cantidad}× {item.producto.nombre}
              </span>
              <span className="shrink-0 tabular-nums text-foreground">
                {currencyFmt.format(item.producto.precio * item.cantidad)}
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

        {/* Cliente para Cuenta Corriente */}
        {medio === 'cuenta_corriente' && (
          <div className="space-y-2">
            <Label htmlFor="mesa-jugador">Seleccionar Cliente (Cta. Corriente)</Label>
            <select
              id="mesa-jugador"
              value={jugadorId ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setJugadorId(val ? Number(val) : null);
              }}
              disabled={isPending}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">-- Seleccionar Jugador --</option>
              {jugadores.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.nombre} {j.telefono ? `(${j.telefono})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Observaciones (opcional) */}
        <div className="space-y-2">
          <Label htmlFor="cerrar-mesa-obs">Observaciones (opcional)</Label>
          <Input
            id="cerrar-mesa-obs"
            type="text"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            disabled={isPending}
            maxLength={500}
            placeholder="Notas internas del cierre…"
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
            {isPending ? 'Cerrando...' : 'Cobrar y cerrar mesa'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
