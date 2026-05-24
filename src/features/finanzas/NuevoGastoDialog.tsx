import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Repeat } from 'lucide-react';
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
import { useCategoriasGasto } from './hooks/useCategoriasGasto';
import { useRegistrarGasto } from './hooks/useRegistrarGasto';
import { useUnidadesNegocio } from './hooks/useUnidadesNegocio';
import {
  MEDIO_PAGO_LABEL,
  MEDIOS_PAGO,
  registrarGastoSchema,
  type RegistrarGastoFormValues,
} from './finanzasSchemas';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Datos para pre-llenar el dialog cuando viene del flujo "Cargar real"
 * del panel de Recurrentes. Cuando viene, el dialog:
 *   - Pre-llena categoría, monto estimado, proveedor y observaciones.
 *   - Muestra un banner identificando la plantilla origen.
 *   - Bloquea el cambio de categoría (la RPC valida que coincida con
 *     la de la plantilla; si el admin la quiere cambiar, edita la
 *     plantilla primero).
 *   - Al submit, pasa `gasto_recurrente_id` para que el gasto quede
 *     vinculado.
 */
export interface NuevoGastoPrefill {
  gasto_recurrente_id: number;
  concepto: string;
  categoria_id: number;
  monto: number;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  observaciones: string | null;
  /** Fecha de vencimiento pre-calculada desde la plantilla
   *  (clampDiaAlMes(dia_vencimiento, año, mes) del mes activo del
   *  panel). El usuario puede editarla en el dialog. */
  fecha_vencimiento: string;
}

interface NuevoGastoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si viene, el dialog abre en modo "Cargar real" desde una plantilla. */
  prefill?: NuevoGastoPrefill | null;
}

interface FormState {
  categoria_id: number | null;
  monto: string;
  fecha_gasto: string;
  proveedor: string;
  observaciones: string;
  pagado: boolean;
  medio_pago: MedioPago | '';
  fecha_pago: string;
  /** YYYY-MM-DD o string vacío. Solo se usa cuando pagado=false. */
  fecha_vencimiento: string;
}

type FieldErrors = Partial<
  Record<
    | 'categoria_id'
    | 'monto'
    | 'fecha_gasto'
    | 'proveedor'
    | 'observaciones'
    | 'medio_pago'
    | 'fecha_pago'
    | 'fecha_vencimiento'
    | 'form',
    string
  >
>;

function todayISO(): string {
  // Hora local — no UTC. El usuario escribe en su calendario local.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const INITIAL_STATE = (): FormState => ({
  categoria_id: null,
  monto: '',
  fecha_gasto: todayISO(),
  proveedor: '',
  observaciones: '',
  pagado: true,
  medio_pago: '' as MedioPago | '',
  fecha_pago: todayISO(),
  fecha_vencimiento: '',
});

function stateFromPrefill(p: NuevoGastoPrefill): FormState {
  return {
    categoria_id: p.categoria_id,
    monto: String(p.monto),
    fecha_gasto: todayISO(),
    proveedor: p.proveedor_nombre ?? '',
    observaciones: p.observaciones ?? '',
    // Default a "pendiente" porque la mayoría de recurrentes (luz,
    // alquiler) se cargan al recibir la factura y se pagan después →
    // pasan por CxP. El admin puede cambiarlo si pagó al momento.
    pagado: false,
    medio_pago: '' as MedioPago | '',
    fecha_pago: todayISO(),
    // Pre-calculada desde la plantilla (día clamped al mes). Editable.
    fecha_vencimiento: p.fecha_vencimiento,
  };
}

export function NuevoGastoDialog({ open, onOpenChange, prefill }: NuevoGastoDialogProps) {
  const unidadesQuery = useUnidadesNegocio();
  const categoriasQuery = useCategoriasGasto();
  const cajaQuery = useCajaAbierta();
  const registrar = useRegistrarGasto();

  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = registrar.isPending;

  useEffect(() => {
    if (open) {
      setState(prefill ? stateFromPrefill(prefill) : INITIAL_STATE());
      setErrors({});
    }
  }, [open, prefill]);

  const isCargarReal = prefill != null;

  // Agrupa categorías activas por unidad activa para el <optgroup>.
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

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const formInput: RegistrarGastoFormValues = {
      categoria_id: state.categoria_id ?? 0,
      monto: state.monto.trim() === '' ? NaN : Number(state.monto),
      fecha_gasto: state.fecha_gasto,
      proveedor: state.proveedor.trim() === '' ? undefined : state.proveedor.trim(),
      observaciones: state.observaciones.trim() === '' ? undefined : state.observaciones.trim(),
      pagado: state.pagado,
      medio_pago: (state.pagado && state.medio_pago !== '' ? (state.medio_pago as MedioPago) : undefined),
      fecha_pago: state.pagado ? state.fecha_pago : undefined,
    };

    const parsed = registrarGastoSchema.safeParse(formInput);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (
          path === 'categoria_id' || path === 'monto' || path === 'fecha_gasto' ||
          path === 'proveedor' || path === 'observaciones' ||
          path === 'medio_pago' || path === 'fecha_pago'
        ) {
          fe[path] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      await registrar.mutateAsync({
        categoria_id: parsed.data.categoria_id,
        monto: parsed.data.monto,
        fecha_gasto: parsed.data.fecha_gasto,
        proveedor: parsed.data.proveedor ?? null,
        observaciones: parsed.data.observaciones ?? null,
        fecha_pago: parsed.data.pagado ? (parsed.data.fecha_pago ?? null) : null,
        medio_pago: parsed.data.pagado ? (parsed.data.medio_pago ?? null) : null,
        // Solo aplica si el gasto nace pendiente. Si paga al momento,
        // la RPC ignora p_fecha_vencimiento (no crea cuota).
        fecha_vencimiento: !parsed.data.pagado && state.fecha_vencimiento !== ''
          ? state.fecha_vencimiento
          : null,
        gasto_recurrente_id: prefill?.gasto_recurrente_id ?? null,
        turnoCajaIdParaInvalidate: cajaQuery.data?.id ?? null,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos registrar el gasto.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isCargarReal ? 'Cargar real de plantilla recurrente' : 'Registrar gasto'}
          </DialogTitle>
          <DialogDescription>
            {isCargarReal ? (
              <>
                Confirmá el monto real del gasto. Si queda pendiente de
                pago, va a Cuentas por Pagar automáticamente.
              </>
            ) : (
              <>
                Cargá un gasto y atribuilo a la unidad correspondiente vía la
                categoría. La fecha del gasto es el período al que pertenece
                (devengado); la fecha de pago indica cuándo salió la plata.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Banner "Cargar real" */}
        {isCargarReal && prefill && (
          <div
            className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"
            role="status"
          >
            <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                Cargando real de "{prefill.concepto}"
              </p>
              <p className="text-xs text-muted-foreground">
                Estimado de la plantilla: {currencyFmt.format(Math.round(prefill.monto))}.
                Ajustá el monto al valor exacto antes de guardar.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Categoría agrupada por unidad */}
          <div className="space-y-1">
            <Label htmlFor="gasto-categoria">Categoría</Label>
            <select
              id="gasto-categoria"
              value={state.categoria_id ?? ''}
              onChange={(e) =>
                setState({ ...state, categoria_id: e.target.value === '' ? null : Number(e.target.value) })
              }
              disabled={pending || categoriasQuery.isLoading || isCargarReal}
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
            {isCargarReal && (
              <p className="text-[11px] text-muted-foreground">
                La categoría viene de la plantilla. Para cambiarla, editá la
                plantilla primero.
              </p>
            )}
            {errors.categoria_id && (
              <p role="alert" className="text-xs text-destructive">
                {errors.categoria_id}
              </p>
            )}
            {!categoriasQuery.isLoading && categoriasAgrupadas.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay categorías cargadas. Pedile al admin que las cree en
                Configuración → Categorías de gasto.
              </p>
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
                Si está apagado, el gasto queda pendiente de pago.
              </p>
            </div>
            <Switch
              id="gasto-pagado"
              checked={state.pagado}
              onCheckedChange={(v) => setState({ ...state, pagado: v })}
              disabled={pending}
            />
          </div>

          {/* Si NO pagado: fecha de vencimiento (opcional pero recomendada
              para que la cuota aparezca con fecha en CxP). */}
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
                Sin fecha, la cuota cae en bucket "Sin fecha" de Cuentas
                por pagar. {isCargarReal && 'Vino sugerida desde la plantilla — editala si querés.'}
              </p>
              {errors.fecha_vencimiento && (
                <p role="alert" className="text-xs text-destructive">{errors.fecha_vencimiento}</p>
              )}
            </div>
          )}

          {/* Si pagado: medio + fecha */}
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
                  <p className="text-xs" style={{ color: 'hsl(var(--destructive))' }}>
                    No hay caja abierta. Abrila primero desde Caja, o usá otro medio de pago.
                  </p>
                )}
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
