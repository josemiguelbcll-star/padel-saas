import { useState, type FormEvent } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  useCreateProducto,
  useUpdateProducto,
} from '@/features/configuracion/hooks/useProductos';
import type { CategoriaProducto, Producto } from '@/types/database';
import {
  CATEGORIAS_PRODUCTO,
  CATEGORIA_LABEL,
  productoSchema,
  type ProductoFormState,
} from './productoSchema';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface ProductoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: Producto | null;
}

export function ProductoFormDialog({
  open,
  onOpenChange,
  initialValue,
}: ProductoFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ProductoFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<
  Record<keyof ProductoFormState | 'form', string>
>;

const defaultState: ProductoFormState = {
  nombre: '',
  categoria: 'bebida',
  precio: '0',
  // Empty default: el admin lo carga cuando lo sepa. Empty se guarda
  // como NULL en la DB (no como 0), preservando "no cargado" vs "0 real".
  costo: '',
  stock_minimo: '0',
  activo: true,
};

function productoToFormState(p: Producto): ProductoFormState {
  return {
    nombre: p.nombre,
    categoria: p.categoria,
    precio: p.precio.toString(),
    costo: p.costo === null ? '' : p.costo.toString(),
    stock_minimo: p.stock_minimo.toString(),
    activo: p.activo,
  };
}

interface ProductoFormBodyProps {
  initialValue: Producto | null;
  onDone: () => void;
}

function ProductoFormBody({ initialValue, onDone }: ProductoFormBodyProps) {
  const isEdit = initialValue !== null;
  const createMutation = useCreateProducto();
  const updateMutation = useUpdateProducto();

  const [state, setState] = useState<ProductoFormState>(
    initialValue ? productoToFormState(initialValue) : defaultState,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = productoSchema.safeParse(state);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'nombre' ||
          field === 'categoria' ||
          field === 'precio' ||
          field === 'costo' ||
          field === 'stock_minimo' ||
          field === 'activo'
        ) {
          fieldErrors[field] = issue.message;
        } else {
          fieldErrors.form = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      if (isEdit && initialValue) {
        await updateMutation.mutateAsync({
          id: initialValue.id,
          changes: parsed.data,
        });
      } else {
        await createMutation.mutateAsync(parsed.data);
      }
      onDone();
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar el producto. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? 'Editar producto' : 'Nuevo producto'}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos del producto. El stock no se edita acá — para sumar inventario, usá "Cargar stock" desde la tabla.'
            : 'Agregá un producto al catálogo del buffet. El stock inicial se carga después con "Cargar stock".'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="producto-nombre">Nombre</Label>
          <Input
            id="producto-nombre"
            value={state.nombre}
            onChange={(e) => setState({ ...state, nombre: e.target.value })}
            maxLength={120}
            disabled={isPending}
            autoFocus
            required
            aria-invalid={errors.nombre ? true : undefined}
            placeholder="Ej: Coca 500ml"
          />
          {errors.nombre && (
            <p className="text-xs text-destructive">{errors.nombre}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Categoría</Label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIAS_PRODUCTO.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() =>
                  setState({ ...state, categoria: cat as CategoriaProducto })
                }
                disabled={isPending}
                aria-pressed={state.categoria === cat}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  state.categoria === cat
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {CATEGORIA_LABEL[cat]}
              </button>
            ))}
          </div>
          {errors.categoria && (
            <p className="text-xs text-destructive">{errors.categoria}</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="producto-precio">Precio (pesos)</Label>
            <Input
              id="producto-precio"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={state.precio}
              onChange={(e) => setState({ ...state, precio: e.target.value })}
              disabled={isPending}
              required
              aria-invalid={errors.precio ? true : undefined}
            />
            {errors.precio && (
              <p className="text-xs text-destructive">{errors.precio}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="producto-costo">Costo (pesos)</Label>
            <Input
              id="producto-costo"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={state.costo}
              onChange={(e) => setState({ ...state, costo: e.target.value })}
              disabled={isPending}
              aria-invalid={errors.costo ? true : undefined}
              placeholder="Vacío = no cargado"
            />
            <MargenHint
              precio={state.precio}
              costo={state.costo}
              error={errors.costo}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="producto-stock-min">Stock mínimo</Label>
          <Input
            id="producto-stock-min"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={state.stock_minimo}
            onChange={(e) =>
              setState({ ...state, stock_minimo: e.target.value })
            }
            disabled={isPending}
            required
            aria-invalid={errors.stock_minimo ? true : undefined}
          />
          {errors.stock_minimo ? (
            <p className="text-xs text-destructive">{errors.stock_minimo}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              0 = sin alerta de stock bajo.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="producto-activo" className="cursor-pointer">
              Activo
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está apagado, no aparece en el catálogo de venta del buffet.
            </p>
          </div>
          <Switch
            id="producto-activo"
            checked={state.activo}
            onCheckedChange={(v) => setState({ ...state, activo: v })}
            disabled={isPending}
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
            {isPending
              ? 'Guardando…'
              : isEdit
                ? 'Guardar cambios'
                : 'Crear producto'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/**
 * Hint debajo del input de costo. Tres estados:
 *   - Error de validación zod (ej. "abc" en el input): muestra el error.
 *   - Costo vacío: "Sin costo cargado · margen no calculable." (muted).
 *   - Costo cargado, margen >= 0: "Margen: $X por unidad." (muted).
 *   - Costo cargado, margen < 0: warning ámbar (no bloquea el submit).
 *
 * El warning de margen negativo es informativo: la DB permite costo >
 * precio (se valida solo costo >= 0). El club puede tener motivos para
 * vender por debajo del costo (promoción, liquidación) y el sistema no
 * debe vetar — solo avisar.
 */
function MargenHint({
  precio,
  costo,
  error,
}: {
  precio: string;
  costo: string;
  error: string | undefined;
}) {
  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }

  const costoTrimmed = costo.trim();
  if (costoTrimmed === '') {
    return (
      <p className="text-xs text-muted-foreground">
        Sin costo cargado · margen no calculable.
      </p>
    );
  }

  const precioNum = Number(precio);
  const costoNum = Number(costoTrimmed);

  if (!Number.isFinite(precioNum) || !Number.isFinite(costoNum)) {
    // Algún input no-numérico: el error de zod debería capturarlo en submit.
    // No mostramos hint mientras se está tipeando.
    return null;
  }

  const margen = precioNum - costoNum;
  if (margen < 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        El costo es mayor al precio (margen negativo:{' '}
        {currencyFmt.format(margen)}).
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Margen: {currencyFmt.format(margen)} por unidad.
    </p>
  );
}
