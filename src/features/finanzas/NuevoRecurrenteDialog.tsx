import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { useCategoriasGasto } from './hooks/useCategoriasGasto';
import { useUnidadesNegocio } from './hooks/useUnidadesNegocio';
import { useProveedores } from '@/features/configuracion/hooks/useProveedores';
import {
  useActualizarGastoRecurrente,
  useCrearGastoRecurrente,
  type RecurrenteFila,
} from './hooks/useGastosRecurrentes';

interface NuevoRecurrenteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si viene, el dialog abre en modo edición sobre esta plantilla. */
  editing?: RecurrenteFila | null;
}

interface FormState {
  concepto: string;
  categoria_id: number | null;
  proveedor_id: number | null;
  monto_estimado: string;
  dia_vencimiento: string;
  observaciones: string;
}

type FieldErrors = Partial<
  Record<
    | 'concepto'
    | 'categoria_id'
    | 'monto_estimado'
    | 'dia_vencimiento'
    | 'observaciones'
    | 'form',
    string
  >
>;

const INITIAL_STATE = (): FormState => ({
  concepto: '',
  categoria_id: null,
  proveedor_id: null,
  monto_estimado: '',
  dia_vencimiento: '10',
  observaciones: '',
});

export function NuevoRecurrenteDialog({
  open,
  onOpenChange,
  editing,
}: NuevoRecurrenteDialogProps) {
  const unidadesQuery = useUnidadesNegocio();
  const categoriasQuery = useCategoriasGasto();
  const proveedoresQuery = useProveedores();
  const crear = useCrearGastoRecurrente();
  const actualizar = useActualizarGastoRecurrente();

  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = crear.isPending || actualizar.isPending;
  const isEdit = editing != null;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setState({
        concepto: editing.concepto,
        categoria_id: editing.categoria_id,
        proveedor_id: editing.proveedor_id,
        monto_estimado: String(editing.monto_estimado),
        dia_vencimiento: String(editing.dia_vencimiento),
        observaciones: editing.observaciones ?? '',
      });
    } else {
      setState(INITIAL_STATE());
    }
    setErrors({});
  }, [open, editing]);

  const categoriasAgrupadas = useMemo(() => {
    const unidades = (unidadesQuery.data ?? []).filter((u) => u.activa);
    const cats = (categoriasQuery.data ?? []).filter((c) => c.activa);
    return unidades
      .map((u) => ({
        unidad: u,
        categorias: cats.filter((c) => c.unidad_id === u.id),
      }))
      .filter((g) => g.categorias.length > 0);
  }, [unidadesQuery.data, categoriasQuery.data]);

  const proveedoresActivos = useMemo(
    () => (proveedoresQuery.data ?? []).filter((p) => p.activo),
    [proveedoresQuery.data],
  );

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  function validar(): FieldErrors | null {
    const fe: FieldErrors = {};
    const concepto = state.concepto.trim();
    if (concepto === '') fe.concepto = 'El concepto es obligatorio.';
    if (concepto.length > 120) fe.concepto = 'Máx. 120 caracteres.';
    if (state.categoria_id === null) fe.categoria_id = 'Elegí una categoría.';
    const monto = Number(state.monto_estimado);
    if (
      state.monto_estimado.trim() === '' ||
      Number.isNaN(monto) ||
      monto <= 0
    ) {
      fe.monto_estimado = 'Ingresá un monto estimado > 0.';
    }
    const dia = Number(state.dia_vencimiento);
    if (
      state.dia_vencimiento.trim() === '' ||
      !Number.isInteger(dia) ||
      dia < 1 ||
      dia > 31
    ) {
      fe.dia_vencimiento = 'Día entre 1 y 31.';
    }
    if (state.observaciones.length > 2000) {
      fe.observaciones = 'Máx. 2000 caracteres.';
    }
    return Object.keys(fe).length > 0 ? fe : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const fe = validar();
    if (fe) {
      setErrors(fe);
      return;
    }

    const concepto = state.concepto.trim();
    const observaciones = state.observaciones.trim() === '' ? null : state.observaciones.trim();
    const monto_estimado = Number(state.monto_estimado);
    const dia_vencimiento = Number(state.dia_vencimiento);

    try {
      if (isEdit && editing) {
        await actualizar.mutateAsync({
          id: editing.id,
          changes: {
            concepto,
            categoria_id: state.categoria_id!,
            proveedor_id: state.proveedor_id,
            monto_estimado,
            dia_vencimiento,
            observaciones,
          },
        });
      } else {
        await crear.mutateAsync({
          categoria_id: state.categoria_id!,
          proveedor_id: state.proveedor_id,
          concepto,
          monto_estimado,
          dia_vencimiento,
          observaciones,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos guardar la plantilla.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar plantilla recurrente' : 'Nueva plantilla recurrente'}
          </DialogTitle>
          <DialogDescription>
            Una plantilla representa un gasto esperado cada mes (alquiler,
            luz, sueldos). Después en el panel cargás el real ajustando el
            monto exacto.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="rec-concepto">Concepto</Label>
            <Input
              id="rec-concepto"
              type="text"
              value={state.concepto}
              onChange={(e) => setState({ ...state, concepto: e.target.value })}
              disabled={pending}
              placeholder="Ej: Luz, Alquiler, Sueldo Juan"
              maxLength={120}
              aria-invalid={!!errors.concepto}
            />
            {errors.concepto && (
              <p role="alert" className="text-xs text-destructive">{errors.concepto}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="rec-categoria">Categoría (define unidad del EERR)</Label>
            <select
              id="rec-categoria"
              value={state.categoria_id ?? ''}
              onChange={(e) =>
                setState({
                  ...state,
                  categoria_id: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              disabled={pending || categoriasQuery.isLoading}
              required
              aria-invalid={!!errors.categoria_id}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rec-monto">Monto estimado</Label>
              <Input
                id="rec-monto"
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
              <Label htmlFor="rec-dia">Día de vencimiento (1-31)</Label>
              <Input
                id="rec-dia"
                type="number"
                inputMode="numeric"
                min="1"
                max="31"
                step="1"
                value={state.dia_vencimiento}
                onChange={(e) => setState({ ...state, dia_vencimiento: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.dia_vencimiento}
              />
              {errors.dia_vencimiento && (
                <p role="alert" className="text-xs text-destructive">{errors.dia_vencimiento}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rec-proveedor">Proveedor (opcional)</Label>
            <select
              id="rec-proveedor"
              value={state.proveedor_id ?? ''}
              onChange={(e) =>
                setState({
                  ...state,
                  proveedor_id: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              disabled={pending || proveedoresQuery.isLoading}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <option value="">— Sin proveedor —</option>
              {proveedoresActivos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Si tu gasto es de un proveedor del catálogo (Edenor, Telecom),
              elegilo para que el real se cargue ya vinculado.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rec-obs">Observaciones (opcional)</Label>
            <textarea
              id="rec-obs"
              value={state.observaciones}
              onChange={(e) => setState({ ...state, observaciones: e.target.value })}
              disabled={pending}
              maxLength={2000}
              rows={2}
              placeholder="Notas internas: aumentos esperados, contacto, etc."
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-invalid={!!errors.observaciones}
            />
            {errors.observaciones && (
              <p role="alert" className="text-xs text-destructive">{errors.observaciones}</p>
            )}
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
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? (isEdit ? 'Guardando…' : 'Creando…')
                : (isEdit ? 'Guardar cambios' : 'Crear plantilla')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
