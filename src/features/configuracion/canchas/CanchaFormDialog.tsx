import { useState, useMemo, type FormEvent } from 'react';
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
  useCreateCancha,
  useUpdateCancha,
} from '@/features/configuracion/hooks/useCanchas';
import { useTarifas } from '@/features/configuracion/hooks/useTarifas';
import { agruparPorLinaje } from '@/features/configuracion/tarifas/tarifaLineage';
import type { Cancha } from '@/types/database';
import {
  canchaSchema,
  type CanchaFormState,
} from './canchaSchema';
import {
  DEPORTES_CATALOGO,
  detectarDeporte,
} from '@/lib/deportes';

interface CanchaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = creando una nueva, Cancha = editando esa. */
  initialValue: Cancha | null;
}

export function CanchaFormDialog({
  open,
  onOpenChange,
  initialValue,
}: CanchaFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {/* `key` fuerza remount del form al abrir con otra cancha, así
            el estado interno arranca limpio sin tener que sincronizar
            con un useEffect. */}
        <CanchaFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<
  Record<keyof CanchaFormState | 'form', string>
>;

const defaultState: CanchaFormState = {
  nombre: '',
  tipo: '',
  deporte: 'padel',
  tarifa_id: null,
  cubierta: false,
  activa: true,
  orden: 0,
};

function canchaToFormState(c: Cancha): CanchaFormState {
  return {
    nombre: c.nombre,
    tipo: c.tipo ?? '',
    deporte: c.deporte ?? detectarDeporte(c),
    tarifa_id: c.tarifa_id ?? null,
    cubierta: c.cubierta,
    activa: c.activa,
    orden: c.orden,
  };
}

interface CanchaFormBodyProps {
  initialValue: Cancha | null;
  onDone: () => void;
}

function CanchaFormBody({ initialValue, onDone }: CanchaFormBodyProps) {
  const isEdit = initialValue !== null;
  const createMutation = useCreateCancha();
  const updateMutation = useUpdateCancha();
  const tarifasQuery = useTarifas();

  const [state, setState] = useState<CanchaFormState>(
    initialValue ? canchaToFormState(initialValue) : defaultState,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const tarifasDisponibles = useMemo(() => {
    const raw = tarifasQuery.data ?? [];
    const linajes = agruparPorLinaje(raw);
    return linajes
      .filter((l) => l.activa && l.vigenteHoy)
      .map((l) => ({
        id: l.vigenteHoy!.id,
        nombre: l.nombre,
        monto: l.vigenteHoy!.monto,
        duracion_min: l.duracion_min,
        horario:
          l.desde_hora && l.hasta_hora
            ? `${l.desde_hora.slice(0, 5)} a ${l.hasta_hora.slice(0, 5)}`
            : 'Todo el día',
      }));
  }, [tarifasQuery.data]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = canchaSchema.safeParse(state);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'nombre' ||
          field === 'tipo' ||
          field === 'deporte' ||
          field === 'tarifa_id' ||
          field === 'cubierta' ||
          field === 'activa' ||
          field === 'orden'
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
      const message =
        err instanceof Error
          ? err.message
          : 'No pudimos guardar los cambios. Probá de nuevo.';
      setErrors({ form: message });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Editar cancha' : 'Nueva cancha'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos de la cancha.'
            : 'Agregá una cancha al club. Vas a poder usarla en la grilla de reservas.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Selector de Deporte */}
        <div className="space-y-1.5">
          <Label>Deporte</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DEPORTES_CATALOGO.map((dep) => {
              const sel = (state.deporte || 'padel') === dep.id;
              return (
                <button
                  key={dep.id}
                  type="button"
                  onClick={() => setState((prev) => ({ ...prev, deporte: dep.id }))}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border p-2 text-xs font-medium transition-all text-left',
                    sel
                      ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs ring-1 ring-primary'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  <span className="text-base">{dep.icono}</span>
                  <span>{dep.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="cancha-nombre">Nombre de la cancha</Label>
          <Input
            id="cancha-nombre"
            value={state.nombre}
            onChange={(e) => setState({ ...state, nombre: e.target.value })}
            placeholder="Ej: Cancha 1, Cancha Central..."
            maxLength={60}
            disabled={isPending}
            autoFocus
            required
            aria-invalid={errors.nombre ? true : undefined}
          />
          {errors.nombre && (
            <p className="text-xs text-destructive">{errors.nombre}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="cancha-tipo">Superficie / Tipo (Opcional)</Label>
          <Input
            id="cancha-tipo"
            list="cancha-tipo-sugerencias"
            value={state.tipo}
            onChange={(e) => setState({ ...state, tipo: e.target.value })}
            maxLength={40}
            disabled={isPending}
            placeholder="Cristal, Polvo de ladrillo, Sintético, Cemento, Muro..."
            aria-invalid={errors.tipo ? true : undefined}
          />
          <datalist id="cancha-tipo-sugerencias">
            <option value="Cristal" />
            <option value="Polvo de ladrillo" />
            <option value="Césped sintético" />
            <option value="Cemento" />
            <option value="Muro" />
            <option value="Parquet" />
            <option value="Outdoor" />
            <option value="Indoor" />
          </datalist>
          {errors.tipo && <p className="text-xs text-destructive">{errors.tipo}</p>}
          <p className="text-xs text-muted-foreground">
            Podés especificar el tipo de superficie o detalle técnico.
          </p>
        </div>

        {/* Tarifa asignada */}
        <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="cancha-tarifa" className="font-semibold text-foreground text-xs sm:text-sm">
              Tarifa asignada a esta cancha
            </Label>
            {state.tarifa_id && (
              <span className="text-[11px] font-medium text-primary">Tarifa fija asignada</span>
            )}
          </div>
          <select
            id="cancha-tarifa"
            value={state.tarifa_id ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setState({
                ...state,
                tarifa_id: val ? Number(val) : null,
              });
            }}
            disabled={isPending || tarifasQuery.isLoading}
            className="flex h-9.5 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs sm:text-sm font-medium shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">
              ✨ Sin tarifa fija (Aplica tarifas dinámicas del club por horario/día)
            </option>
            {tarifasDisponibles.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre} — ${t.monto.toLocaleString('es-AR')}{t.duracion_min ? ` (${t.duracion_min} min)` : ''} [{t.horario}]
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {state.tarifa_id
              ? 'Esta cancha tendrá este precio fijo asignado para sus reservas.'
              : 'Al no asignar una tarifa fija, el sistema calculará el precio automáticamente según los horarios y días definidos en Configuración → Tarifas.'}
          </p>
          {errors.tarifa_id && (
            <p className="text-xs text-destructive">{errors.tarifa_id}</p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="cancha-cubierta" className="cursor-pointer">
              Cubierta
            </Label>
            <p className="text-xs text-muted-foreground">
              ¿Tiene techo?
            </p>
          </div>
          <Switch
            id="cancha-cubierta"
            checked={state.cubierta}
            onCheckedChange={(v) => setState({ ...state, cubierta: v })}
            disabled={isPending}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="cancha-activa" className="cursor-pointer">
              Activa
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está apagada, no aparece en la grilla de reservas.
            </p>
          </div>
          <Switch
            id="cancha-activa"
            checked={state.activa}
            onCheckedChange={(v) => setState({ ...state, activa: v })}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cancha-orden">Orden</Label>
          <Input
            id="cancha-orden"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={state.orden}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              setState({
                ...state,
                orden: Number.isNaN(v) ? 0 : Math.max(0, Math.floor(v)),
              });
            }}
            disabled={isPending}
            aria-invalid={errors.orden ? true : undefined}
          />
          {errors.orden && (
            <p className="text-xs text-destructive">{errors.orden}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Define el orden en que las canchas aparecen en la grilla. Menor número = antes.
          </p>
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
                : 'Crear cancha'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
