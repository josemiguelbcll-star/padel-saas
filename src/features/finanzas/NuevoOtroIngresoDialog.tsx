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
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useCajaAbierta } from '@/features/caja/hooks/useCajaAbierta';
import type { MedioPago } from '@/types/database';
import { useRegistrarOtroIngreso } from './hooks/useRegistrarOtroIngreso';
import { useUnidadesNegocio } from './hooks/useUnidadesNegocio';
import {
  MEDIO_PAGO_LABEL,
  MEDIOS_PAGO,
  registrarOtroIngresoSchema,
  TIPO_UNIDAD_LABEL,
  type RegistrarOtroIngresoFormValues,
} from './finanzasSchemas';

interface NuevoOtroIngresoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  unidad_id: number | null;
  concepto: string;
  monto: string;
  fecha: string;
  observaciones: string;
  cobrado: boolean;
  medio_pago: MedioPago | '';
  fecha_cobro: string;
}

type FieldErrors = Partial<
  Record<
    | 'unidad_id' | 'concepto' | 'monto' | 'fecha' | 'observaciones'
    | 'medio_pago' | 'fecha_cobro' | 'form',
    string
  >
>;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const INITIAL_STATE = (): FormState => ({
  unidad_id: null,
  concepto: '',
  monto: '',
  fecha: todayISO(),
  observaciones: '',
  cobrado: true,
  medio_pago: '' as MedioPago | '',
  fecha_cobro: todayISO(),
});

export function NuevoOtroIngresoDialog({
  open,
  onOpenChange,
}: NuevoOtroIngresoDialogProps) {
  const unidadesQuery = useUnidadesNegocio();
  const cajaQuery = useCajaAbierta();
  const registrar = useRegistrarOtroIngreso();

  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = registrar.isPending;

  useEffect(() => {
    if (open) {
      setState(INITIAL_STATE());
      setErrors({});
    }
  }, [open]);

  const unidadesActivas = (unidadesQuery.data ?? []).filter((u) => u.activa);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const formInput: RegistrarOtroIngresoFormValues = {
      unidad_id: state.unidad_id ?? 0,
      concepto: state.concepto,
      monto: state.monto.trim() === '' ? NaN : Number(state.monto),
      fecha: state.fecha,
      observaciones: state.observaciones.trim() === '' ? undefined : state.observaciones.trim(),
      cobrado: state.cobrado,
      medio_pago: state.cobrado && state.medio_pago !== '' ? (state.medio_pago as MedioPago) : undefined,
      fecha_cobro: state.cobrado ? state.fecha_cobro : undefined,
    };

    const parsed = registrarOtroIngresoSchema.safeParse(formInput);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (
          path === 'unidad_id' || path === 'concepto' || path === 'monto' ||
          path === 'fecha' || path === 'observaciones' ||
          path === 'medio_pago' || path === 'fecha_cobro'
        ) {
          fe[path] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      await registrar.mutateAsync({
        unidad_id: parsed.data.unidad_id,
        concepto: parsed.data.concepto,
        monto: parsed.data.monto,
        fecha: parsed.data.fecha,
        fecha_cobro: parsed.data.cobrado ? (parsed.data.fecha_cobro ?? null) : null,
        medio_pago: parsed.data.cobrado ? (parsed.data.medio_pago ?? null) : null,
        observaciones: parsed.data.observaciones ?? null,
        turnoCajaIdParaInvalidate: cajaQuery.data?.id ?? null,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos registrar el ingreso.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar otro ingreso</DialogTitle>
          <DialogDescription>
            Cargá un ingreso que NO pase por reservas/buffet/clases
            (auspicios, membresías, etc.). Atribuilo a una unidad de
            negocio. Si lo cobrás en efectivo, entra a la caja del día.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Unidad */}
          <div className="space-y-1">
            <Label htmlFor="ing-unidad">Unidad de negocio</Label>
            <select
              id="ing-unidad"
              value={state.unidad_id ?? ''}
              onChange={(e) =>
                setState({ ...state, unidad_id: e.target.value === '' ? null : Number(e.target.value) })
              }
              disabled={pending || unidadesQuery.isLoading}
              required
              aria-invalid={!!errors.unidad_id}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— Elegí una unidad —</option>
              {unidadesActivas.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({TIPO_UNIDAD_LABEL[u.tipo]})
                </option>
              ))}
            </select>
            {errors.unidad_id && (
              <p role="alert" className="text-xs text-destructive">{errors.unidad_id}</p>
            )}
          </div>

          {/* Concepto */}
          <div className="space-y-1">
            <Label htmlFor="ing-concepto">Concepto</Label>
            <Input
              id="ing-concepto"
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

          {/* Monto + fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ing-monto">Monto</Label>
              <Input
                id="ing-monto"
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
              <Label htmlFor="ing-fecha">Fecha</Label>
              <Input
                id="ing-fecha"
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

          {/* Toggle cobrado */}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="ing-cobrado" className="cursor-pointer">
                ¿Ya cobrado?
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagado, el ingreso queda pendiente de cobro.
              </p>
            </div>
            <Switch
              id="ing-cobrado"
              checked={state.cobrado}
              onCheckedChange={(v) => setState({ ...state, cobrado: v })}
              disabled={pending}
            />
          </div>

          {/* Si cobrado: medio + fecha */}
          {state.cobrado && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label>Medio de pago</Label>
                <div className="flex flex-wrap gap-1.5">
                  {MEDIOS_PAGO.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setState({ ...state, medio_pago: m })}
                      disabled={pending}
                      aria-pressed={state.medio_pago === m}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        state.medio_pago === m
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {MEDIO_PAGO_LABEL[m]}
                    </button>
                  ))}
                </div>
                {errors.medio_pago && (
                  <p role="alert" className="text-xs text-destructive">{errors.medio_pago}</p>
                )}
                {state.medio_pago === 'efectivo' && !cajaQuery.data && (
                  <p className="text-xs" style={{ color: 'hsl(var(--destructive))' }}>
                    No hay caja abierta. Abrila primero desde Caja, o usá otro medio de pago.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="ing-fecha-cobro">Fecha de cobro</Label>
                <Input
                  id="ing-fecha-cobro"
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
            <Label htmlFor="ing-obs">Observaciones (opcional)</Label>
            <textarea
              id="ing-obs"
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
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Registrando…' : 'Registrar ingreso'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
