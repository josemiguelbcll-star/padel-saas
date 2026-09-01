import { useEffect, useState, type FormEvent } from 'react';
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
import { useUnidadesNegocio } from './hooks/useUnidadesNegocio';
import {
  useActualizarIngresoRecurrente,
  useCrearIngresoRecurrente,
  type IngresoRecurrenteFila,
} from './hooks/useIngresosRecurrentes';

interface NuevoIngresoRecurrenteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: IngresoRecurrenteFila | null;
}

interface FormState {
  concepto: string;
  unidad_id: number | null;
  monto_estimado: string;
  dia_vencimiento: string;
  observaciones: string;
}

type FieldErrors = Partial<
  Record<
    | 'concepto'
    | 'unidad_id'
    | 'monto_estimado'
    | 'dia_vencimiento'
    | 'observaciones'
    | 'form',
    string
  >
>;

const INITIAL_STATE = (): FormState => ({
  concepto: '',
  unidad_id: null,
  monto_estimado: '',
  dia_vencimiento: '10',
  observaciones: '',
});

export function NuevoIngresoRecurrenteDialog({
  open,
  onOpenChange,
  editing,
}: NuevoIngresoRecurrenteDialogProps) {
  const unidadesQuery = useUnidadesNegocio();
  const crearMutation = useCrearIngresoRecurrente();
  const actualizarMutation = useActualizarIngresoRecurrente();

  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});

  const isEditing = Boolean(editing);

  useEffect(() => {
    if (editing && open) {
      setState({
        concepto: editing.concepto,
        unidad_id: editing.unidad_id,
        monto_estimado: String(editing.monto_estimado),
        dia_vencimiento: String(editing.dia_vencimiento),
        observaciones: editing.observaciones ?? '',
      });
      setErrors({});
    } else if (open) {
      setState(INITIAL_STATE());
      setErrors({});
    }
  }, [editing, open]);

  const unidades = (unidadesQuery.data ?? []).filter((u) => u.activa || u.id === editing?.unidad_id);

  function validate(): boolean {
    const nextErrors: FieldErrors = {};

    const c = state.concepto.trim();
    if (!c) {
      nextErrors.concepto = 'El concepto es obligatorio.';
    } else if (c.length > 120) {
      nextErrors.concepto = 'Máx. 120 caracteres.';
    }

    if (!state.unidad_id) {
      nextErrors.unidad_id = 'Elegí una unidad de negocio.';
    }

    const m = parseFloat(state.monto_estimado);
    if (Number.isNaN(m) || m <= 0) {
      nextErrors.monto_estimado = 'El monto estimado debe ser mayor a 0.';
    }

    const d = parseInt(state.dia_vencimiento, 10);
    if (Number.isNaN(d) || d < 1 || d > 31) {
      nextErrors.dia_vencimiento = 'El día debe estar entre 1 y 31.';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!validate()) return;

    try {
      if (isEditing && editing) {
        await actualizarMutation.mutateAsync({
          id: editing.id,
          concepto: state.concepto.trim(),
          unidad_id: state.unidad_id!,
          monto_estimado: parseFloat(state.monto_estimado),
          dia_vencimiento: parseInt(state.dia_vencimiento, 10),
          observaciones: state.observaciones.trim() || null,
        });
      } else {
        await crearMutation.mutateAsync({
          concepto: state.concepto.trim(),
          unidad_id: state.unidad_id!,
          monto_estimado: parseFloat(state.monto_estimado),
          dia_vencimiento: parseInt(state.dia_vencimiento, 10),
          observaciones: state.observaciones.trim() || null,
        });
      }

      onOpenChange(false);
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar la plantilla de ingreso.',
      });
    }
  }

  const pending = crearMutation.isPending || actualizarMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar ingreso recurrente' : 'Nuevo ingreso recurrente'}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? (
              <>Modificá el concepto, unidad o monto estimado de esta plantilla.</>
            ) : (
              <>
                Creá una plantilla mensual para ingresos periódicos (auspicios,
                membresías, alquileres de buffet, etc.).
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Concepto */}
          <div className="space-y-1">
            <Label htmlFor="ing-rec-concepto">Concepto</Label>
            <Input
              id="ing-rec-concepto"
              type="text"
              value={state.concepto}
              onChange={(e) => setState({ ...state, concepto: e.target.value })}
              disabled={pending}
              maxLength={120}
              autoFocus
              placeholder="Ej: Auspicio Bullpadel, Alquiler Buffet"
              aria-invalid={!!errors.concepto}
            />
            {errors.concepto && (
              <p role="alert" className="text-xs text-destructive">{errors.concepto}</p>
            )}
          </div>

          {/* Unidad */}
          <div className="space-y-1">
            <Label htmlFor="ing-rec-unidad">Unidad de negocio</Label>
            <select
              id="ing-rec-unidad"
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

          {/* Monto y Día */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ing-rec-monto">Monto estimado</Label>
              <Input
                id="ing-rec-monto"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={state.monto_estimado}
                onChange={(e) => setState({ ...state, monto_estimado: e.target.value })}
                disabled={pending}
                placeholder="0.00"
                aria-invalid={!!errors.monto_estimado}
              />
              {errors.monto_estimado && (
                <p role="alert" className="text-xs text-destructive">{errors.monto_estimado}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="ing-rec-dia">Día de cobro habitual</Label>
              <Input
                id="ing-rec-dia"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={state.dia_vencimiento}
                onChange={(e) => setState({ ...state, dia_vencimiento: e.target.value })}
                disabled={pending}
                placeholder="1 al 31"
                aria-invalid={!!errors.dia_vencimiento}
              />
              {errors.dia_vencimiento && (
                <p role="alert" className="text-xs text-destructive">{errors.dia_vencimiento}</p>
              )}
            </div>
          </div>

          {/* Observaciones */}
          <div className="space-y-1">
            <Label htmlFor="ing-rec-obs">Observaciones (opcional)</Label>
            <textarea
              id="ing-rec-obs"
              value={state.observaciones}
              onChange={(e) => setState({ ...state, observaciones: e.target.value })}
              disabled={pending}
              maxLength={2000}
              rows={2}
              placeholder="Detalles sobre el contrato, acuerdo o fechas de pago…"
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
              {pending
                ? 'Guardando…'
                : isEditing
                  ? 'Guardar cambios'
                  : 'Crear plantilla'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
