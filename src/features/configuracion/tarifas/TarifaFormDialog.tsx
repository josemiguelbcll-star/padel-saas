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
import { cn } from '@/lib/utils';
import {
  useCreateTarifa,
  useUpdateTarifa,
} from '@/features/configuracion/hooks/useTarifas';
import type { Tarifa } from '@/types/database';
import { tarifaSchema } from './tarifaSchema';

interface TarifaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: Tarifa | null;
}

export function TarifaFormDialog({
  open,
  onOpenChange,
  initialValue,
}: TarifaFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <TarifaFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type Modo = 'simple' | 'avanzado';

interface FormState {
  nombre: string;
  monto: string;
  desde_hora: string;
  hasta_hora: string;
  dias_semana: number[];
  prioridad: string;
  activa: boolean;
}

type FieldErrors = Partial<
  Record<
    | 'nombre'
    | 'monto'
    | 'desde_hora'
    | 'hasta_hora'
    | 'dias_semana'
    | 'prioridad'
    | 'form',
    string
  >
>;

const DIAS_SEMANA = [
  { value: 1, label: 'LUN', full: 'Lunes' },
  { value: 2, label: 'MAR', full: 'Martes' },
  { value: 3, label: 'MIE', full: 'Miércoles' },
  { value: 4, label: 'JUE', full: 'Jueves' },
  { value: 5, label: 'VIE', full: 'Viernes' },
  { value: 6, label: 'SAB', full: 'Sábado' },
  { value: 7, label: 'DOM', full: 'Domingo' },
] as const;

function defaultState(): FormState {
  return {
    nombre: '',
    monto: '',
    desde_hora: '',
    hasta_hora: '',
    dias_semana: [],
    prioridad: '0',
    activa: true,
  };
}

function tarifaToFormState(t: Tarifa): FormState {
  return {
    nombre: t.nombre,
    monto: t.monto.toString(),
    desde_hora: t.desde_hora ? t.desde_hora.slice(0, 5) : '',
    hasta_hora: t.hasta_hora ? t.hasta_hora.slice(0, 5) : '',
    dias_semana: t.dias_semana ?? [],
    prioridad: t.prioridad.toString(),
    activa: t.activa,
  };
}

/**
 * "simple" cuando es una tarifa que aplica siempre (sin franja, sin
 * días, sin prioridad). Si la tarifa tiene cualquiera de esas tres
 * cosas seteadas, la abrimos en modo avanzado para no perder datos.
 */
function detectarModo(t: Tarifa | null): Modo {
  if (!t) return 'simple';
  const sinFranja = t.desde_hora === null && t.hasta_hora === null;
  const sinDias = t.dias_semana === null || t.dias_semana.length === 0;
  const sinPrioridad = t.prioridad === 0;
  if (sinFranja && sinDias && sinPrioridad) return 'simple';
  return 'avanzado';
}

interface TarifaFormBodyProps {
  initialValue: Tarifa | null;
  onDone: () => void;
}

function TarifaFormBody({ initialValue, onDone }: TarifaFormBodyProps) {
  const isEdit = initialValue !== null;
  const createMutation = useCreateTarifa();
  const updateMutation = useUpdateTarifa();

  const [modo, setModo] = useState<Modo>(detectarModo(initialValue));
  const [state, setState] = useState<FormState>(
    initialValue ? tarifaToFormState(initialValue) : defaultState(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  function toggleDia(dia: number): void {
    const exists = state.dias_semana.includes(dia);
    const next = exists
      ? state.dias_semana.filter((d) => d !== dia)
      : [...state.dias_semana, dia];
    next.sort((a, b) => a - b);
    setState({ ...state, dias_semana: next });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    // En modo simple forzamos los campos avanzados a sus valores "no aplica".
    // Esto desacopla el state del form (que persiste si el admin toggle entre
    // modos) de los datos que efectivamente se guardan.
    const aValidar =
      modo === 'simple'
        ? {
            nombre: state.nombre,
            monto: state.monto,
            desde_hora: null,
            hasta_hora: null,
            dias_semana: null,
            prioridad: '0',
            activa: state.activa,
          }
        : {
            nombre: state.nombre,
            monto: state.monto,
            desde_hora: state.desde_hora === '' ? null : state.desde_hora,
            hasta_hora: state.hasta_hora === '' ? null : state.hasta_hora,
            dias_semana: state.dias_semana,
            prioridad: state.prioridad,
            activa: state.activa,
          };

    const parsed = tarifaSchema.safeParse(aValidar);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'nombre' ||
          field === 'monto' ||
          field === 'desde_hora' ||
          field === 'hasta_hora' ||
          field === 'dias_semana' ||
          field === 'prioridad'
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
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar la tarifa. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Editar tarifa' : 'Nueva tarifa'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos de la tarifa.'
            : 'Las tarifas definen cuánto cobra el club por una reserva.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Toggle de modo */}
        <div className="flex w-fit gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setModo('simple')}
            disabled={isPending}
            aria-pressed={modo === 'simple'}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              modo === 'simple'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => setModo('avanzado')}
            disabled={isPending}
            aria-pressed={modo === 'avanzado'}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              modo === 'avanzado'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Avanzado
          </button>
        </div>

        {modo === 'simple' && (
          <p className="text-xs text-muted-foreground">
            Una sola tarifa que aplica a todos los horarios y días.
            Si más adelante necesitás distintos precios por franja, pasá a Avanzado.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="tarifa-nombre">Nombre</Label>
          <Input
            id="tarifa-nombre"
            value={state.nombre}
            onChange={(e) => setState({ ...state, nombre: e.target.value })}
            maxLength={80}
            disabled={isPending}
            autoFocus
            required
            aria-invalid={errors.nombre ? true : undefined}
            placeholder={modo === 'simple' ? 'Tarifa única' : 'Finde noche, Día semana, ...'}
          />
          {errors.nombre && (
            <p className="text-xs text-destructive">{errors.nombre}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="tarifa-monto">Monto (pesos)</Label>
          <Input
            id="tarifa-monto"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={state.monto}
            onChange={(e) => setState({ ...state, monto: e.target.value })}
            disabled={isPending}
            required
            aria-invalid={errors.monto ? true : undefined}
            placeholder="0.00"
          />
          {errors.monto && (
            <p className="text-xs text-destructive">{errors.monto}</p>
          )}
        </div>

        {modo === 'avanzado' && (
          <>
            <div className="space-y-2">
              <Label>Franja horaria</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    id="tarifa-desde"
                    type="time"
                    value={state.desde_hora}
                    onChange={(e) =>
                      setState({ ...state, desde_hora: e.target.value })
                    }
                    disabled={isPending}
                    aria-invalid={errors.desde_hora ? true : undefined}
                    aria-label="Desde"
                  />
                  {errors.desde_hora && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.desde_hora}
                    </p>
                  )}
                </div>
                <div>
                  <Input
                    id="tarifa-hasta"
                    type="time"
                    value={state.hasta_hora}
                    onChange={(e) =>
                      setState({ ...state, hasta_hora: e.target.value })
                    }
                    disabled={isPending}
                    aria-invalid={errors.hasta_hora ? true : undefined}
                    aria-label="Hasta"
                  />
                  {errors.hasta_hora && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.hasta_hora}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Dejá ambas vacías si la tarifa aplica a cualquier hora.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Días de la semana</Label>
              <div className="flex flex-wrap gap-1.5">
                {DIAS_SEMANA.map((d) => {
                  const selected = state.dias_semana.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      title={d.full}
                      onClick={() => toggleDia(d.value)}
                      disabled={isPending}
                      aria-pressed={selected}
                      aria-label={d.full}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              {errors.dias_semana && (
                <p className="text-xs text-destructive">{errors.dias_semana}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Si no seleccionás ningún día acá, dejá la tarifa para "cualquier hora"
                y volvé a Simple — el formato no tiene mucho sentido sin alguna restricción.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="tarifa-prioridad">Prioridad</Label>
              </div>
              <Input
                id="tarifa-prioridad"
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                value={state.prioridad}
                onChange={(e) =>
                  setState({ ...state, prioridad: e.target.value })
                }
                disabled={isPending}
                aria-invalid={errors.prioridad ? true : undefined}
                className="w-32"
              />
              {errors.prioridad && (
                <p className="text-xs text-destructive">{errors.prioridad}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Cuando dos tarifas aplican al mismo horario, gana la de
                <strong className="font-medium text-foreground"> mayor número</strong>.
                Usá 0 si no tenés solapamientos.
              </p>
            </div>
          </>
        )}

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="tarifa-activa" className="cursor-pointer">
              Activa
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está apagada, no se ofrece al crear nuevas reservas.
            </p>
          </div>
          <Switch
            id="tarifa-activa"
            checked={state.activa}
            onCheckedChange={(v) => setState({ ...state, activa: v })}
            disabled={isPending}
          />
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
                : 'Crear tarifa'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
