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
import type {
  CategoriaProducto,
  Linea,
  Producto,
} from '@/types/database';
import {
  CATEGORIA_LABEL,
  LINEA_LABEL,
  categoriasPermitidas,
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
  /**
   * Línea pre-seleccionada para productos nuevos (cuando se abre el
   * form desde un tab específico de la pantalla de Productos).
   * Ignorada si initialValue !== null (en edición se usa la línea
   * actual del producto). Default 'buffet'.
   */
  initialLinea?: Linea;
}

export function ProductoFormDialog({
  open,
  onOpenChange,
  initialValue,
  initialLinea = 'buffet',
}: ProductoFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ProductoFormBody
          key={initialValue?.id ?? `new-${initialLinea}`}
          initialValue={initialValue}
          initialLinea={initialLinea}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<
  Record<keyof ProductoFormState | 'form', string>
>;

/**
 * Categoría default para producto nuevo según la línea elegida.
 * Hardcoded para que TS la tipe como `CategoriaProducto` concreto
 * (categoriasPermitidas(linea)[0] sería CategoriaProducto | undefined
 * desde el punto de vista del compilador).
 */
function defaultCategoriaPorLinea(linea: Linea): CategoriaProducto {
  return linea === 'buffet' ? 'bebidas' : 'articulos_padel';
}

function defaultStateFor(linea: Linea): ProductoFormState {
  return {
    nombre: '',
    linea,
    categoria: defaultCategoriaPorLinea(linea),
    precio: '0',
    // Empty default: el admin lo carga cuando lo sepa. Empty se guarda
    // como NULL en la DB (no como 0), preservando "no cargado" vs "0 real".
    costo: '',
    stock_minimo: '0',
    activo: true,
  };
}

function productoToFormState(p: Producto): ProductoFormState {
  return {
    nombre: p.nombre,
    linea: p.linea,
    categoria: p.categoria,
    precio: p.precio.toString(),
    costo: p.costo === null ? '' : p.costo.toString(),
    stock_minimo: p.stock_minimo.toString(),
    activo: p.activo,
  };
}

interface ProductoFormBodyProps {
  initialValue: Producto | null;
  initialLinea: Linea;
  onDone: () => void;
}

function ProductoFormBody({
  initialValue,
  initialLinea,
  onDone,
}: ProductoFormBodyProps) {
  const isEdit = initialValue !== null;
  const createMutation = useCreateProducto();
  const updateMutation = useUpdateProducto();

  const [state, setState] = useState<ProductoFormState>(
    initialValue ? productoToFormState(initialValue) : defaultStateFor(initialLinea),
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  /**
   * Cambio de línea: resetea la categoría a la primera de la nueva
   * línea para evitar quedar en una combinación inválida (el CHECK
   * compuesto y el superRefine la rechazarían).
   */
  function handleChangeLinea(linea: Linea): void {
    if (linea === state.linea) return;
    setState({
      ...state,
      linea,
      categoria: defaultCategoriaPorLinea(linea),
    });
  }

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
          field === 'linea' ||
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

  const categoriasActuales = categoriasPermitidas(state.linea);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? 'Editar producto' : 'Nuevo producto'}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos del producto. El stock no se edita acá — para sumar inventario, usá "Cargar stock" desde la tabla.'
            : 'Agregá un producto al catálogo. El stock inicial se carga después con "Cargar stock".'}
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

        {/* Línea — pills primarios */}
        <div className="space-y-2">
          <Label>Línea</Label>
          <div className="flex flex-wrap gap-1.5">
            {(['buffet', 'shop'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => handleChangeLinea(l)}
                disabled={isPending}
                aria-pressed={state.linea === l}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  state.linea === l
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {LINEA_LABEL[l]}
              </button>
            ))}
          </div>
          {errors.linea && (
            <p className="text-xs text-destructive">{errors.linea}</p>
          )}
          {isEdit && (
            <p className="text-[11px] text-muted-foreground">
              Cambiar la línea resetea la categoría. Las ventas históricas
              conservan la línea anterior (snapshot).
            </p>
          )}
        </div>

        {/* Categoría — depende de la línea */}
        <div className="space-y-2">
          <Label>Categoría</Label>
          <div className="flex flex-wrap gap-1.5">
            {categoriasActuales.map((cat) => (
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
              Si está apagado, no aparece en el catálogo del mostrador.
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
 * Hint debajo del input de costo. Sin cambios funcionales respecto
 * de la versión pre-líneas.
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
