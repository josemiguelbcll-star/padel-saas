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
import { useCargarStock } from '@/features/configuracion/hooks/useCargarStock';
import type { ProductoConStock } from '@/types/database';
import {
  cargarStockSchema,
  type CargarStockFormState,
} from './cargarStockSchema';

interface CargarStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Producto sobre el que se va a cargar stock. null = dialog cerrado. */
  producto: ProductoConStock | null;
}

export function CargarStockDialog({
  open,
  onOpenChange,
  producto,
}: CargarStockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {producto && (
          <CargarStockBody
            key={producto.id}
            producto={producto}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<
  Record<keyof CargarStockFormState | 'form', string>
>;

const defaultState: CargarStockFormState = {
  cantidad: '',
  observaciones: '',
};

interface CargarStockBodyProps {
  producto: ProductoConStock;
  onDone: () => void;
}

function CargarStockBody({ producto, onDone }: CargarStockBodyProps) {
  const cargarMutation = useCargarStock();

  const [state, setState] = useState<CargarStockFormState>(defaultState);
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = cargarMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = cargarStockSchema.safeParse(state);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'cantidad' || field === 'observaciones') {
          fieldErrors[field] = issue.message;
        } else {
          fieldErrors.form = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      await cargarMutation.mutateAsync({
        producto_id: producto.id,
        cantidad: parsed.data.cantidad,
        observaciones: parsed.data.observaciones,
      });
      onDone();
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos cargar el stock. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cargar stock — {producto.nombre}</DialogTitle>
        <DialogDescription>
          Suma una entrada manual de inventario. Stock actual:{' '}
          <span className="font-medium text-foreground">
            {producto.stock_actual}
          </span>
          .
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="cargar-stock-cantidad">Cantidad a sumar</Label>
          <Input
            id="cargar-stock-cantidad"
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={state.cantidad}
            onChange={(e) => setState({ ...state, cantidad: e.target.value })}
            disabled={isPending}
            autoFocus
            required
            aria-invalid={errors.cantidad ? true : undefined}
            placeholder="Ej: 24"
          />
          {errors.cantidad && (
            <p className="text-xs text-destructive">{errors.cantidad}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cargar-stock-obs">Observaciones (opcional)</Label>
          <Input
            id="cargar-stock-obs"
            type="text"
            value={state.observaciones}
            onChange={(e) =>
              setState({ ...state, observaciones: e.target.value })
            }
            disabled={isPending}
            maxLength={500}
            placeholder="Ej: factura 12345, compra mayorista"
          />
        </div>

        {errors.form && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {errors.form}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onDone}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Cargando…' : 'Cargar stock'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
