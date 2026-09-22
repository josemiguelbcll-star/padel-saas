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
import { useUnidadesNegocio } from './hooks/useUnidadesNegocio';
import { useRegistrarOtroIngreso } from './hooks/useRegistrarOtroIngreso';
import { useCajaAbierta } from '@/features/caja/hooks/useCajaAbierta';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import type { MedioPago } from '@/types/database';
import { MEDIO_PAGO_LABEL, MEDIOS_PAGO } from './finanzasSchemas';

export interface NuevoOtroIngresoPrefill {
  unidad_id?: number;
  concepto?: string;
  monto?: number;
  ingreso_recurrente_id?: number;
  observaciones?: string;
}

interface NuevoOtroIngresoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: NuevoOtroIngresoPrefill | null;
}

interface IngresoFormState {
  unidad_id: number | null;
  concepto: string;
  monto: string;
  fecha: string;
  cobrado: boolean;
  fecha_cobro: string;
  medio_pago: MedioPago;
  cuenta_id: number | null;
  observaciones: string;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function INITIAL_STATE(): IngresoFormState {
  const hoy = todayISO();
  return {
    unidad_id: null,
    concepto: '',
    monto: '',
    fecha: hoy,
    cobrado: true,
    fecha_cobro: hoy,
    medio_pago: 'efectivo',
    cuenta_id: null,
    observaciones: '',
  };
}

export function NuevoOtroIngresoDialog({
  open,
  onOpenChange,
  prefill,
}: NuevoOtroIngresoDialogProps) {
  const unidadesQuery = useUnidadesNegocio();
  const cajaQuery = useCajaAbierta();
  const cuentasQuery = useCuentas();
  const registrarMutation = useRegistrarOtroIngreso();

  const [state, setState] = useState<IngresoFormState>(INITIAL_STATE());
  const [errors, setErrors] = useState<{ [k: string]: string }>({});

  const isCargarReal = Boolean(prefill?.ingreso_recurrente_id);
  const cuentas = (cuentasQuery.data ?? []).filter((c) => c.activa);

  useEffect(() => {
    if (open) {
      const base = INITIAL_STATE();
      if (prefill) {
        if (prefill.unidad_id) base.unidad_id = prefill.unidad_id;
        if (prefill.concepto) base.concepto = prefill.concepto;
        if (prefill.monto !== undefined) base.monto = String(prefill.monto);
        if (prefill.observaciones) base.observaciones = prefill.observaciones;
      }
      setState(base);
      setErrors({});
    }
  }, [open, prefill]);

  function validate(): boolean {
    const nextErrors: { [k: string]: string } = {};

    if (!state.unidad_id) {
      nextErrors.unidad_id = 'Elegí una unidad de negocio.';
    }

    const c = state.concepto.trim();
    if (!c) {
      nextErrors.concepto = 'El concepto es obligatorio.';
    } else if (c.length > 200) {
      nextErrors.concepto = 'El concepto puede tener hasta 200 caracteres.';
    }

    const m = parseFloat(state.monto);
    if (Number.isNaN(m) || m <= 0) {
      nextErrors.monto = 'El monto debe ser mayor a 0.';
    }

    if (!state.fecha) {
      nextErrors.fecha = 'Ingresá la fecha del ingreso.';
    }

    if (state.cobrado) {
      if (!state.fecha_cobro) {
        nextErrors.fecha_cobro = 'Ingresá la fecha de cobro.';
      }
      if (!state.medio_pago) {
        nextErrors.medio_pago = 'Elegí el medio de pago.';
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!validate()) return;

    try {
      await registrarMutation.mutateAsync({
        unidad_id: state.unidad_id!,
        concepto: state.concepto.trim(),
        monto: parseFloat(state.monto),
        fecha: state.fecha,
        fecha_cobro: state.cobrado ? state.fecha_cobro : null,
        medio_pago: state.cobrado ? state.medio_pago : null,
        observaciones: state.observaciones.trim() || null,
        cuenta_id: state.cobrado ? state.cuenta_id : null,
        ingreso_recurrente_id: prefill?.ingreso_recurrente_id ?? null,
        turnoCajaIdParaInvalidate: cajaQuery.data?.id ?? null,
      });

      onOpenChange(false);
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos registrar el ingreso. Probá de nuevo.',
      });
    }
  }

  const unidades = (unidadesQuery.data ?? []).filter((u) => u.activa);
  const pending = registrarMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isCargarReal ? 'Cargar cobro del mes' : 'Nuevo ingreso'}
          </DialogTitle>
          <DialogDescription>
            {isCargarReal
              ? 'Registrá el cobro real correspondiente a esta plantilla recurrente.'
              : 'Registrá un ingreso ajeno a turnos y buffet (auspicios, membresías, eventos, etc.).'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Unidad de negocio */}
          <div className="space-y-1">
            <Label htmlFor="ingreso-unidad">Unidad de negocio</Label>
            <select
              id="ingreso-unidad"
              value={state.unidad_id ?? ''}
              onChange={(e) =>
                setState({
                  ...state,
                  unidad_id: e.target.value === '' ? null : Number(e.target.value),
                })
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
            <Label htmlFor="ingreso-concepto">Concepto</Label>
            <Input
              id="ingreso-concepto"
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
              <Label htmlFor="ingreso-monto">Monto</Label>
              <Input
                id="ingreso-monto"
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
              <Label htmlFor="ingreso-fecha">Fecha</Label>
              <Input
                id="ingreso-fecha"
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
              <Label htmlFor="ingreso-cobrado" className="text-sm font-medium">
                ¿Ya cobrado?
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagado, el ingreso queda pendiente de cobro.
              </p>
            </div>
            <Switch
              id="ingreso-cobrado"
              checked={state.cobrado}
              onCheckedChange={(checked) =>
                setState({
                  ...state,
                  cobrado: checked,
                  fecha_cobro: checked ? state.fecha_cobro || state.fecha : '',
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

              {/* Selector de cuenta */}
              <div className="space-y-1">
                <Label htmlFor="ingreso-cuenta">Cuenta de acreditación (opcional)</Label>
                <select
                  id="ingreso-cuenta"
                  value={state.cuenta_id ?? ''}
                  onChange={(e) =>
                    setState({
                      ...state,
                      cuenta_id: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  disabled={pending}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">— Seleccionar cuenta —</option>
                  {cuentas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre} {c.detalle ? `(${c.detalle})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ingreso-fecha-cobro">Fecha de cobro</Label>
                <Input
                  id="ingreso-fecha-cobro"
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
            <Label htmlFor="ingreso-obs">Observaciones (opcional)</Label>
            <textarea
              id="ingreso-obs"
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
              {pending
                ? (isCargarReal ? 'Cargando…' : 'Registrando…')
                : (isCargarReal ? 'Cargar cobro' : 'Registrar ingreso')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
