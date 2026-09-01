import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Gasto, MedioPago } from '@/types/database';
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
import { MEDIOS_PAGO, MEDIO_PAGO_LABEL } from './finanzasSchemas';
import { useCategoriasGasto } from './hooks/useCategoriasGasto';
import { useUnidadesNegocio } from './hooks/useUnidadesNegocio';
import { useActualizarGasto } from './hooks/useActualizarGasto';

interface EditarGastoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gasto: Gasto | null;
}

interface FormState {
  categoria_id: number | null;
  monto: string;
  fecha_gasto: string;
  proveedor: string;
  pagado: boolean;
  medio_pago: MedioPago | null;
  fecha_pago: string;
  observaciones: string;
}

type FieldErrors = Partial<
  Record<
    | 'categoria_id'
    | 'monto'
    | 'fecha_gasto'
    | 'proveedor'
    | 'medio_pago'
    | 'fecha_pago'
    | 'observaciones'
    | 'form',
    string
  >
>;

export function EditarGastoDialog({
  open,
  onOpenChange,
  gasto,
}: EditarGastoDialogProps) {
  const categoriasQuery = useCategoriasGasto();
  const unidadesQuery = useUnidadesNegocio();
  const actualizar = useActualizarGasto();

  const [state, setState] = useState<FormState>({
    categoria_id: null,
    monto: '',
    fecha_gasto: '',
    proveedor: '',
    pagado: false,
    medio_pago: null,
    fecha_pago: '',
    observaciones: '',
  });

  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (gasto && open) {
      setState({
        categoria_id: gasto.categoria_id,
        monto: gasto.monto ? String(gasto.monto) : '',
        fecha_gasto: gasto.fecha_gasto ?? '',
        proveedor: gasto.proveedor ?? '',
        pagado: gasto.fecha_pago !== null,
        medio_pago: gasto.medio_pago,
        fecha_pago: gasto.fecha_pago ?? gasto.fecha_gasto ?? '',
        observaciones: gasto.observaciones ?? '',
      });
      setErrors({});
    }
  }, [gasto, open]);

  // Agrupar categorías activas por unidad
  const categoriasAgrupadas = useMemo(() => {
    const unidades = unidadesQuery.data ?? [];
    const categorias = (categoriasQuery.data ?? []).filter((c) => c.activa || c.id === gasto?.categoria_id);
    return unidades
      .map((u) => ({
        unidad: u,
        categorias: categorias.filter((c) => c.unidad_id === u.id),
      }))
      .filter((g) => g.categorias.length > 0);
  }, [unidadesQuery.data, categoriasQuery.data, gasto]);

  function validate(): boolean {
    const nextErrors: FieldErrors = {};

    if (!state.categoria_id) {
      nextErrors.categoria_id = 'Elegí una categoría.';
    }

    const montoNum = parseFloat(state.monto);
    if (Number.isNaN(montoNum) || montoNum <= 0) {
      nextErrors.monto = 'El monto debe ser mayor a 0.';
    }

    if (!state.fecha_gasto) {
      nextErrors.fecha_gasto = 'La fecha del gasto es obligatoria.';
    }

    if (state.pagado) {
      if (!state.medio_pago) {
        nextErrors.medio_pago = 'Elegí un medio de pago.';
      }
      if (!state.fecha_pago) {
        nextErrors.fecha_pago = 'Elegí la fecha de pago.';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!gasto || !validate()) return;

    try {
      await actualizar.mutateAsync({
        gasto_id: gasto.id,
        categoria_id: state.categoria_id!,
        monto: parseFloat(state.monto),
        fecha_gasto: state.fecha_gasto,
        fecha_pago: state.pagado ? state.fecha_pago : null,
        medio_pago: state.pagado ? state.medio_pago : null,
        proveedor_nombre: state.proveedor.trim() || null,
        observaciones: state.observaciones.trim() || null,
      });

      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos actualizar el gasto.',
      });
    }
  }

  const pending = actualizar.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar gasto</DialogTitle>
          <DialogDescription>
            Modificá el monto, fechas, categoría o medio de pago del gasto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Categoría */}
          <div className="space-y-1">
            <Label htmlFor="edit-gasto-categoria">Categoría</Label>
            <select
              id="edit-gasto-categoria"
              value={state.categoria_id ?? ''}
              onChange={(e) =>
                setState({ ...state, categoria_id: e.target.value === '' ? null : Number(e.target.value) })
              }
              disabled={pending}
              required
              aria-invalid={!!errors.categoria_id}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— Elegí una categoría —</option>
              {categoriasAgrupadas.map((g) => (
                <optgroup key={g.unidad.id} label={g.unidad.nombre}>
                  {g.categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {errors.categoria_id && (
              <p role="alert" className="text-xs text-destructive">{errors.categoria_id}</p>
            )}
          </div>

          {/* Monto y Fecha del gasto */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-gasto-monto">Monto</Label>
              <Input
                id="edit-gasto-monto"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={state.monto}
                onChange={(e) => setState({ ...state, monto: e.target.value })}
                disabled={pending}
                placeholder="0.00"
                aria-invalid={!!errors.monto}
              />
              {errors.monto && (
                <p role="alert" className="text-xs text-destructive">{errors.monto}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-gasto-fecha">Fecha del gasto</Label>
              <Input
                id="edit-gasto-fecha"
                type="date"
                value={state.fecha_gasto}
                onChange={(e) => setState({ ...state, fecha_gasto: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.fecha_gasto}
              />
              {errors.fecha_gasto && (
                <p role="alert" className="text-xs text-destructive">{errors.fecha_gasto}</p>
              )}
            </div>
          </div>

          {/* Proveedor */}
          <div className="space-y-1">
            <Label htmlFor="edit-gasto-proveedor">Proveedor (opcional)</Label>
            <Input
              id="edit-gasto-proveedor"
              type="text"
              value={state.proveedor}
              onChange={(e) => setState({ ...state, proveedor: e.target.value })}
              disabled={pending}
              maxLength={120}
              placeholder="Ej: Distribuidora Coca, Inmobiliaria X"
            />
          </div>

          {/* Switch: ¿Ya está pagado? */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
            <div className="space-y-0.5">
              <Label htmlFor="edit-gasto-pagado" className="text-sm font-medium">
                ¿Ya está pagado?
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagado, el gasto queda pendiente de pago.
              </p>
            </div>
            <Switch
              id="edit-gasto-pagado"
              checked={state.pagado}
              onCheckedChange={(checked) =>
                setState({
                  ...state,
                  pagado: checked,
                  fecha_pago: checked ? state.fecha_pago || state.fecha_gasto : '',
                  medio_pago: checked ? state.medio_pago || 'efectivo' : null,
                })
              }
              disabled={pending}
            />
          </div>

          {/* Bloque de pago */}
          {state.pagado && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="space-y-1.5">
                <Label>Medio de pago</Label>
                <div className="flex flex-wrap gap-1.5">
                  {MEDIOS_PAGO.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setState({ ...state, medio_pago: m })}
                      disabled={pending}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        state.medio_pago === m
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background hover:bg-muted text-foreground',
                      )}
                    >
                      {MEDIO_PAGO_LABEL[m]}
                    </button>
                  ))}
                </div>
                {errors.medio_pago && (
                  <p role="alert" className="text-xs text-destructive">{errors.medio_pago}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="edit-gasto-fecha-pago">Fecha de pago</Label>
                <Input
                  id="edit-gasto-fecha-pago"
                  type="date"
                  value={state.fecha_pago}
                  onChange={(e) => setState({ ...state, fecha_pago: e.target.value })}
                  disabled={pending}
                  aria-invalid={!!errors.fecha_pago}
                />
                {errors.fecha_pago && (
                  <p role="alert" className="text-xs text-destructive">{errors.fecha_pago}</p>
                )}
              </div>
            </div>
          )}

          {/* Observaciones */}
          <div className="space-y-1">
            <Label htmlFor="edit-gasto-obs">Observaciones (opcional)</Label>
            <textarea
              id="edit-gasto-obs"
              value={state.observaciones}
              onChange={(e) => setState({ ...state, observaciones: e.target.value })}
              disabled={pending}
              maxLength={2000}
              rows={2}
              placeholder="Notas internas, número de factura, etc."
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
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
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
