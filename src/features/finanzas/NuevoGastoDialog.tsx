import { useEffect, useState, type FormEvent } from 'react';
import { Receipt } from 'lucide-react';
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
import { useCategoriasGasto } from './hooks/useCategoriasGasto';
import { useRegistrarGasto } from './hooks/useRegistrarGasto';
import { useCajaAbierta } from '@/features/caja/hooks/useCajaAbierta';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import type { MedioPago } from '@/types/database';
import { MEDIO_PAGO_LABEL, MEDIOS_PAGO } from './finanzasSchemas';

export interface NuevoGastoPrefill {
  categoria_id?: number;
  monto?: number;
  proveedor?: string;
  proveedor_id?: number | null;
  proveedor_nombre?: string | null;
  concepto?: string;
  fecha_vencimiento?: string;
  gasto_recurrente_id?: number;
  observaciones?: string | null;
}

interface NuevoGastoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: NuevoGastoPrefill | null;
}

interface GastoFormState {
  categoria_id: number | null;
  monto: string;
  fecha_gasto: string;
  proveedor: string;
  observaciones: string;
  pagado: boolean;
  fecha_pago: string;
  medio_pago: MedioPago;
  cuenta_id: number | null;
  fecha_vencimiento: string;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function INITIAL_STATE(): GastoFormState {
  const hoy = todayISO();
  return {
    categoria_id: null,
    monto: '',
    fecha_gasto: hoy,
    proveedor: '',
    observaciones: '',
    pagado: false,
    fecha_pago: hoy,
    medio_pago: 'efectivo',
    cuenta_id: null,
    fecha_vencimiento: '',
  };
}

export function NuevoGastoDialog({
  open,
  onOpenChange,
  prefill,
}: NuevoGastoDialogProps) {
  const categoriasQuery = useCategoriasGasto();
  const cajaQuery = useCajaAbierta();
  const cuentasQuery = useCuentas();
  const registrarMutation = useRegistrarGasto();

  const [state, setState] = useState<GastoFormState>(INITIAL_STATE());
  const [errors, setErrors] = useState<{ [k: string]: string }>({});

  const isCargarReal = Boolean(prefill?.gasto_recurrente_id);
  const cuentas = (cuentasQuery.data ?? []).filter((c) => c.activa);

  useEffect(() => {
    if (open) {
      const base = INITIAL_STATE();
      if (prefill) {
        if (prefill.categoria_id) base.categoria_id = prefill.categoria_id;
        if (prefill.monto !== undefined) base.monto = String(prefill.monto);
        if (prefill.proveedor) base.proveedor = prefill.proveedor;
        if (prefill.fecha_vencimiento) base.fecha_vencimiento = prefill.fecha_vencimiento;
        if (prefill.observaciones) base.observaciones = prefill.observaciones;
      }
      setState(base);
      setErrors({});
    }
  }, [open, prefill]);

  function handleOpenChange(next: boolean): void {
    if (registrarMutation.isPending) return;
    onOpenChange(next);
  }

  function validate(): boolean {
    const nextErrors: { [k: string]: string } = {};

    if (!state.categoria_id) {
      nextErrors.categoria_id = 'Elegí una categoría.';
    }

    const montoNum = parseFloat(state.monto);
    if (Number.isNaN(montoNum) || montoNum <= 0) {
      nextErrors.monto = 'El monto debe ser mayor a 0.';
    }

    if (!state.fecha_gasto) {
      nextErrors.fecha_gasto = 'Ingresá la fecha del gasto.';
    }

    if (state.pagado) {
      if (!state.fecha_pago) {
        nextErrors.fecha_pago = 'Ingresá la fecha de pago.';
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
        categoria_id: state.categoria_id!,
        monto: parseFloat(state.monto),
        fecha_gasto: state.fecha_gasto,
        proveedor: state.proveedor.trim() || null,
        observaciones: state.observaciones.trim() || null,
        fecha_pago: state.pagado ? state.fecha_pago : null,
        medio_pago: state.pagado ? state.medio_pago : null,
        fecha_vencimiento: !state.pagado && state.fecha_vencimiento ? state.fecha_vencimiento : null,
        gasto_recurrente_id: prefill?.gasto_recurrente_id ?? null,
        cuenta_id: state.pagado ? state.cuenta_id : null,
        turnoCajaIdParaInvalidate: cajaQuery.data?.id ?? null,
      });

      onOpenChange(false);
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos registrar el gasto. Probá de nuevo.',
      });
    }
  }

  const categorias = (categoriasQuery.data ?? []).filter((c) => c.activa);
  const pending = registrarMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" aria-hidden="true" />
            {isCargarReal ? 'Cargar gasto del mes' : 'Nuevo gasto'}
          </DialogTitle>
          <DialogDescription>
            {isCargarReal
              ? 'Registrá el gasto real correspondiente a esta plantilla recurrente.'
              : 'Registrá un gasto operativo, compra de insumos, sueldos o servicios.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Categoría */}
          <div className="space-y-1">
            <Label htmlFor="gasto-categoria">Categoría</Label>
            <select
              id="gasto-categoria"
              value={state.categoria_id ?? ''}
              onChange={(e) =>
                setState({
                  ...state,
                  categoria_id: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              disabled={pending}
              required
              aria-invalid={!!errors.categoria_id}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— Elegí una categoría —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {errors.categoria_id && (
              <p role="alert" className="text-xs text-destructive">{errors.categoria_id}</p>
            )}
          </div>

          {/* Monto + fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="gasto-monto">Monto</Label>
              <Input
                id="gasto-monto"
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
              <Label htmlFor="gasto-fecha">Fecha del gasto</Label>
              <Input
                id="gasto-fecha"
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
            <Label htmlFor="gasto-proveedor">Proveedor (opcional)</Label>
            <Input
              id="gasto-proveedor"
              type="text"
              value={state.proveedor}
              onChange={(e) => setState({ ...state, proveedor: e.target.value })}
              disabled={pending}
              maxLength={120}
              placeholder="Ej: Distribuidora Coca, Inmobiliaria X"
            />
          </div>

          {/* Toggle ¿Pagado? */}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="gasto-pagado" className="cursor-pointer">
                ¿Ya está pagado?
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagado, el gasto queda pendiente de pago en Cuentas por pagar.
              </p>
            </div>
            <Switch
              id="gasto-pagado"
              checked={state.pagado}
              onCheckedChange={(v) => setState({ ...state, pagado: v })}
              disabled={pending}
            />
          </div>

          {/* Si NO pagado: fecha de vencimiento */}
          {!state.pagado && (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
              <Label htmlFor="gasto-fecha-vencimiento">
                Fecha de vencimiento (opcional)
              </Label>
              <Input
                id="gasto-fecha-vencimiento"
                type="date"
                value={state.fecha_vencimiento}
                onChange={(e) => setState({ ...state, fecha_vencimiento: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.fecha_vencimiento}
              />
              <p className="text-[11px] text-muted-foreground">
                Sin fecha, la cuota cae en bucket "Sin fecha" de Cuentas por pagar.
              </p>
              {errors.fecha_vencimiento && (
                <p role="alert" className="text-xs text-destructive">{errors.fecha_vencimiento}</p>
              )}
            </div>
          )}

          {/* Si pagado: medio + cuenta + fecha */}
          {state.pagado && (
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
                  <p className="text-xs text-destructive">
                    No hay caja abierta. Abrila primero desde Caja, o usá otro medio de pago.
                  </p>
                )}
              </div>

              {/* Selector de cuenta */}
              <div className="space-y-1">
                <Label htmlFor="gasto-cuenta">Cuenta de origen (opcional)</Label>
                <select
                  id="gasto-cuenta"
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
                <Label htmlFor="gasto-fecha-pago">Fecha de pago</Label>
                <Input
                  id="gasto-fecha-pago"
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
            <Label htmlFor="gasto-obs">Observaciones (opcional)</Label>
            <textarea
              id="gasto-obs"
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
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? (isCargarReal ? 'Cargando…' : 'Registrando…')
                : (isCargarReal ? 'Cargar real' : 'Registrar gasto')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
