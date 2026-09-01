import { useEffect, useState, type FormEvent } from 'react';
import type { MedioPago, OtroIngreso } from '@/types/database';
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
import { useUnidadesNegocio } from './hooks/useUnidadesNegocio';
import { useActualizarOtroIngreso } from './hooks/useActualizarOtroIngreso';

interface EditarOtroIngresoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ingreso: OtroIngreso | null;
}

interface FormState {
  unidad_id: number | null;
  concepto: string;
  monto: string;
  fecha: string;
  cobrado: boolean;
  medio_pago: MedioPago | null;
  fecha_cobro: string;
  observaciones: string;
}

type FieldErrors = Partial<
  Record<
    | 'unidad_id'
    | 'concepto'
    | 'monto'
    | 'fecha'
    | 'medio_pago'
    | 'fecha_cobro'
    | 'observaciones'
    | 'form',
    string
  >
>;

export function EditarOtroIngresoDialog({
  open,
  onOpenChange,
  ingreso,
}: EditarOtroIngresoDialogProps) {
  const unidadesQuery = useUnidadesNegocio();
  const actualizar = useActualizarOtroIngreso();

  const [state, setState] = useState<FormState>({
    unidad_id: null,
    concepto: '',
    monto: '',
    fecha: '',
    cobrado: false,
    medio_pago: null,
    fecha_cobro: '',
    observaciones: '',
  });

  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (ingreso && open) {
      setState({
        unidad_id: ingreso.unidad_id,
        concepto: ingreso.concepto ?? '',
        monto: ingreso.monto ? String(ingreso.monto) : '',
        fecha: ingreso.fecha ?? '',
        cobrado: ingreso.fecha_cobro !== null,
        medio_pago: ingreso.medio_pago,
        fecha_cobro: ingreso.fecha_cobro ?? ingreso.fecha ?? '',
        observaciones: ingreso.observaciones ?? '',
      });
      setErrors({});
    }
  }, [ingreso, open]);

  const unidades = (unidadesQuery.data ?? []).filter((u) => u.activa || u.id === ingreso?.unidad_id);

  function validate(): boolean {
    const nextErrors: FieldErrors = {};

    if (!state.unidad_id) {
      nextErrors.unidad_id = 'Elegí una unidad de negocio.';
    }

    if (!state.concepto.trim()) {
      nextErrors.concepto = 'El concepto es obligatorio.';
    }

    const montoNum = parseFloat(state.monto);
    if (Number.isNaN(montoNum) || montoNum <= 0) {
      nextErrors.monto = 'El monto debe ser mayor a 0.';
    }

    if (!state.fecha) {
      nextErrors.fecha = 'La fecha del ingreso es obligatoria.';
    }

    if (state.cobrado) {
      if (!state.medio_pago) {
        nextErrors.medio_pago = 'Elegí un medio de pago.';
      }
      if (!state.fecha_cobro) {
        nextErrors.fecha_cobro = 'Elegí la fecha de cobro.';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!ingreso || !validate()) return;

    try {
      await actualizar.mutateAsync({
        ingreso_id: ingreso.id,
        unidad_id: state.unidad_id!,
        concepto: state.concepto.trim(),
        monto: parseFloat(state.monto),
        fecha: state.fecha,
        fecha_cobro: state.cobrado ? state.fecha_cobro : null,
        medio_pago: state.cobrado ? state.medio_pago : null,
        observaciones: state.observaciones.trim() || null,
      });

      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos actualizar el ingreso.',
      });
    }
  }

  const pending = actualizar.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar ingreso</DialogTitle>
          <DialogDescription>
            Modificá el monto, fechas, concepto, unidad o medio de cobro del ingreso.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Unidad de negocio */}
          <div className="space-y-1">
            <Label htmlFor="edit-ingreso-unidad">Unidad de negocio</Label>
            <select
              id="edit-ingreso-unidad"
              value={state.unidad_id ?? ''}
              onChange={(e) =>
                setState({ ...state, unidad_id: e.target.value === '' ? null : Number(e.target.value) })
              }
              disabled={pending}
              required
              aria-invalid={!!errors.unidad_id}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— Elegí una unidad —</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
            {errors.unidad_id && (
              <p role="alert" className="text-xs text-destructive">{errors.unidad_id}</p>
            )}
          </div>

          {/* Concepto */}
          <div className="space-y-1">
            <Label htmlFor="edit-ingreso-concepto">Concepto</Label>
            <Input
              id="edit-ingreso-concepto"
              type="text"
              value={state.concepto}
              onChange={(e) => setState({ ...state, concepto: e.target.value })}
              disabled={pending}
              maxLength={200}
              placeholder="Ej: Auspicio camiseta Q2, Membresía Juan Pérez"
              aria-invalid={!!errors.concepto}
            />
            {errors.concepto && (
              <p role="alert" className="text-xs text-destructive">{errors.concepto}</p>
            )}
          </div>

          {/* Monto y Fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-ingreso-monto">Monto</Label>
              <Input
                id="edit-ingreso-monto"
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
              <Label htmlFor="edit-ingreso-fecha">Fecha</Label>
              <Input
                id="edit-ingreso-fecha"
                type="date"
                value={state.fecha}
                onChange={(e) => setState({ ...state, fecha: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.fecha}
              />
              {errors.fecha && (
                <p role="alert" className="text-xs text-destructive">{errors.fecha}</p>
              )}
            </div>
          </div>

          {/* Switch: ¿Ya cobrado? */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
            <div className="space-y-0.5">
              <Label htmlFor="edit-ingreso-cobrado" className="text-sm font-medium">
                ¿Ya cobrado?
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagado, el ingreso queda pendiente de cobro.
              </p>
            </div>
            <Switch
              id="edit-ingreso-cobrado"
              checked={state.cobrado}
              onCheckedChange={(checked) =>
                setState({
                  ...state,
                  cobrado: checked,
                  fecha_cobro: checked ? state.fecha_cobro || state.fecha : '',
                  medio_pago: checked ? state.medio_pago || 'efectivo' : null,
                })
              }
              disabled={pending}
            />
          </div>

          {/* Bloque de cobro */}
          {state.cobrado && (
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
                <Label htmlFor="edit-ingreso-fecha-cobro">Fecha de cobro</Label>
                <Input
                  id="edit-ingreso-fecha-cobro"
                  type="date"
                  value={state.fecha_cobro}
                  onChange={(e) => setState({ ...state, fecha_cobro: e.target.value })}
                  disabled={pending}
                  aria-invalid={!!errors.fecha_cobro}
                />
                {errors.fecha_cobro && (
                  <p role="alert" className="text-xs text-destructive">{errors.fecha_cobro}</p>
                )}
              </div>
            </div>
          )}

          {/* Observaciones */}
          <div className="space-y-1">
            <Label htmlFor="edit-ingreso-obs">Observaciones (opcional)</Label>
            <textarea
              id="edit-ingreso-obs"
              value={state.observaciones}
              onChange={(e) => setState({ ...state, observaciones: e.target.value })}
              disabled={pending}
              maxLength={2000}
              rows={2}
              placeholder="Notas internas, comprobante, etc."
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
