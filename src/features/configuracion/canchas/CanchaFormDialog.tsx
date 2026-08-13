import { useState, type FormEvent } from 'react';
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
import {
  useCreateCancha,
  useUpdateCancha,
} from '@/features/configuracion/hooks/useCanchas';
import type { Cancha } from '@/types/database';
import {
  canchaSchema,
  type CanchaFormState,
} from './canchaSchema';

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
      <DialogContent>
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
  cubierta: false,
  activa: true,
  orden: 0,
};

function canchaToFormState(c: Cancha): CanchaFormState {
  return {
    nombre: c.nombre,
    tipo: c.tipo ?? '',
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

  const [state, setState] = useState<CanchaFormState>(
    initialValue ? canchaToFormState(initialValue) : defaultState,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

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
        {!isEdit && (
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-muted-foreground">Deporte / Ajuste Rápido:</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    nombre: prev.nombre || 'Cancha 1 (Tenis)',
                    tipo: 'Tenis (Polvo de ladrillo)',
                  }))
                }
              >
                🎾 Tenis
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    nombre: prev.nombre || 'Cancha 1 (Pickleball)',
                    tipo: 'Pickleball (Outdoor)',
                  }))
                }
              >
                🏓 Pickleball
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    nombre: prev.nombre || 'Cancha 1 (Pádel)',
                    tipo: 'Pádel (Cristal)',
                  }))
                }
              >
                🔲 Pádel
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="cancha-nombre">Nombre</Label>
          <Input
            id="cancha-nombre"
            value={state.nombre}
            onChange={(e) => setState({ ...state, nombre: e.target.value })}
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
          <Label htmlFor="cancha-tipo">Tipo / Deporte</Label>
          <Input
            id="cancha-tipo"
            list="cancha-tipo-sugerencias"
            value={state.tipo}
            onChange={(e) => setState({ ...state, tipo: e.target.value })}
            maxLength={40}
            disabled={isPending}
            placeholder="Tenis, Pickleball, Pádel cristal, cemento…"
            aria-invalid={errors.tipo ? true : undefined}
          />
          <datalist id="cancha-tipo-sugerencias">
            <option value="Tenis (Polvo de ladrillo)" />
            <option value="Tenis (Cemento)" />
            <option value="Tenis (Césped)" />
            <option value="Pickleball (Outdoor)" />
            <option value="Pickleball (Indoor)" />
            <option value="Pádel (Cristal)" />
            <option value="Pádel (Muro)" />
            <option value="cristal" />
            <option value="cemento" />
            <option value="muro" />
          </datalist>
          {errors.tipo && <p className="text-xs text-destructive">{errors.tipo}</p>}
          <p className="text-xs text-muted-foreground">
            Podés especificar el deporte o tipo de superficie.
          </p>
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
