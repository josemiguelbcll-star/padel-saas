import { useMemo, useState, type FormEvent } from 'react';
import { Info, ShieldAlert } from 'lucide-react';
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
import { DURACIONES_TURNO_VALIDAS } from '@/features/configuracion/horarios/horariosSchema';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import {
  useCreateClase,
  useUpdateClase,
} from '@/features/configuracion/hooks/useClases';
import { useProfesores } from '@/features/configuracion/hooks/useProfesores';
import { useTarifasClases } from '@/features/configuracion/hooks/useTarifasClases';
import { resolverTarifa } from '@/features/reservas/utils/resolverTarifa';
import type { Clase } from '@/types/database';
import { claseSchema } from './claseSchema';

interface ClaseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: Clase | null;
}

export function ClaseFormDialog({
  open,
  onOpenChange,
  initialValue,
}: ClaseFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <ClaseFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FormState {
  profesor_id: number | null;
  cancha_id: number | null;
  nombre: string;
  dias_semana: number[];
  hora_inicio: string;
  duracion_min: number;
  activa: boolean;
}

type FieldErrors = Partial<
  Record<
    | 'profesor_id'
    | 'cancha_id'
    | 'nombre'
    | 'dias_semana'
    | 'hora_inicio'
    | 'duracion_min'
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

const DEFAULT_DURACION_CLASE = 60;

function defaultState(): FormState {
  return {
    profesor_id: null,
    cancha_id: null,
    nombre: '',
    dias_semana: [],
    hora_inicio: '',
    duracion_min: DEFAULT_DURACION_CLASE,
    activa: true,
  };
}

function claseToFormState(c: Clase): FormState {
  return {
    profesor_id: c.profesor_id,
    cancha_id: c.cancha_id,
    nombre: c.nombre ?? '',
    dias_semana: [...c.dias_semana],
    hora_inicio: c.hora_inicio.slice(0, 5),
    duracion_min: c.duracion_min,
    activa: c.activa,
  };
}

const DIA_NOMBRE_CORTO: Record<number, string> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábados',
  7: 'domingos',
};

/**
 * Devuelve una fecha 'YYYY-MM-DD' (próxima o igual a hoy) que cae en el
 * día de la semana ISO indicado (1=lun..7=dom). Sirve para alimentar
 * `resolverTarifa` y verificar si hay tarifa de clase para ese día+hora.
 */
function proxFechaConDiaIso(diaIso: number): string {
  const hoy = new Date();
  // JS getDay: 0=domingo..6=sábado. ISO: 1=lunes..7=domingo.
  const isoHoy = hoy.getDay() === 0 ? 7 : hoy.getDay();
  const offset = (diaIso - isoHoy + 7) % 7;
  const target = new Date(hoy);
  target.setDate(hoy.getDate() + offset);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface ClaseFormBodyProps {
  initialValue: Clase | null;
  onDone: () => void;
}

function ClaseFormBody({ initialValue, onDone }: ClaseFormBodyProps) {
  const isEdit = initialValue !== null;
  const profesoresQuery = useProfesores();
  const canchasQuery = useCanchas();
  const tarifasClasesQuery = useTarifasClases();
  const createMutation = useCreateClase();
  const updateMutation = useUpdateClase();

  const [state, setState] = useState<FormState>(
    initialValue ? claseToFormState(initialValue) : defaultState(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Aviso BLANDO: si algún día seleccionado + hora no tiene tarifa de
  // clase configurada, mostramos un pill ámbar. NO bloquea el guardado
  // — la clase se puede crear igual. El RAISE hard ocurre al cobrar
  // (fn_cobrar_clase 0035). Si el admin guarda sin tarifa, la nota le
  // recuerda configurarla antes del primer cobro.
  const diasSinTarifa = useMemo(() => {
    if (tarifasClasesQuery.isLoading) return [];
    if (state.dias_semana.length === 0 || state.hora_inicio === '') return [];
    const tarifas = tarifasClasesQuery.data ?? [];
    const sinTarifa: number[] = [];
    for (const dia of state.dias_semana) {
      const fecha = proxFechaConDiaIso(dia);
      const r = resolverTarifa({ fecha, hora: state.hora_inicio, tarifas });
      if (r.tarifa === null) sinTarifa.push(dia);
    }
    return sinTarifa;
  }, [tarifasClasesQuery.isLoading, tarifasClasesQuery.data, state.dias_semana, state.hora_inicio]);

  // Para selects: mostramos activos + (si estamos editando una clase con
  // un profesor/cancha que quedó inactivo) el actualmente seleccionado,
  // marcado como "(inactivo)" para que el admin entienda por qué aparece.
  const profesoresParaSelect = useMemo(() => {
    const todos = profesoresQuery.data ?? [];
    return todos.filter(
      (p) => p.activo || p.id === state.profesor_id,
    );
  }, [profesoresQuery.data, state.profesor_id]);

  const canchasParaSelect = useMemo(() => {
    const todas = canchasQuery.data ?? [];
    return todas.filter((c) => c.activa || c.id === state.cancha_id);
  }, [canchasQuery.data, state.cancha_id]);

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

    // Pre-validación: profesor_id y cancha_id no pueden venir null al
    // schema (la DB exige NOT NULL). Damos mensajes propios acá.
    const fieldErrors: FieldErrors = {};
    if (state.profesor_id === null) {
      fieldErrors.profesor_id = 'Elegí un profesor.';
    }
    if (state.cancha_id === null) {
      fieldErrors.cancha_id = 'Elegí una cancha.';
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    const parsed = claseSchema.safeParse({
      profesor_id: state.profesor_id,
      cancha_id: state.cancha_id,
      nombre: state.nombre,
      dias_semana: state.dias_semana,
      hora_inicio: state.hora_inicio,
      duracion_min: state.duracion_min,
      activa: state.activa,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'profesor_id' ||
          field === 'cancha_id' ||
          field === 'nombre' ||
          field === 'dias_semana' ||
          field === 'hora_inicio' ||
          field === 'duracion_min'
        ) {
          next[field] = issue.message;
        } else {
          next.form = issue.message;
        }
      }
      setErrors(next);
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
      // CLAVE: el trigger anti-overlap puede tirar P0001 con un mensaje
      // largo en castellano. Lo mostramos en el banner del form y NO
      // cerramos el dialog — el admin puede ajustar hora/días y reintentar.
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar la clase. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Editar clase' : 'Nueva clase'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos de la clase.'
            : 'Las clases son bloques rígidos que se repiten cada semana en los días que elijas.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Profesor */}
          <div className="space-y-2">
            <Label htmlFor="clase-profesor">Profesor</Label>
            <select
              id="clase-profesor"
              value={state.profesor_id ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setState({
                  ...state,
                  profesor_id: v === '' ? null : Number(v),
                });
              }}
              disabled={isPending || profesoresQuery.isLoading}
              required
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-invalid={errors.profesor_id ? true : undefined}
            >
              <option value="" disabled>
                Elegí un profesor
              </option>
              {profesoresParaSelect.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {!p.activo ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
            {errors.profesor_id && (
              <p className="text-xs text-destructive">{errors.profesor_id}</p>
            )}
          </div>

          {/* Cancha */}
          <div className="space-y-2">
            <Label htmlFor="clase-cancha">Cancha</Label>
            <select
              id="clase-cancha"
              value={state.cancha_id ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setState({
                  ...state,
                  cancha_id: v === '' ? null : Number(v),
                });
              }}
              disabled={isPending || canchasQuery.isLoading}
              required
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-invalid={errors.cancha_id ? true : undefined}
            >
              <option value="" disabled>
                Elegí una cancha
              </option>
              {canchasParaSelect.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {!c.activa ? ' (inactiva)' : ''}
                </option>
              ))}
            </select>
            {errors.cancha_id && (
              <p className="text-xs text-destructive">{errors.cancha_id}</p>
            )}
          </div>
        </div>

        {/* Nombre (opcional) */}
        <div className="space-y-2">
          <Label htmlFor="clase-nombre">Nombre (opcional)</Label>
          <Input
            id="clase-nombre"
            value={state.nombre}
            onChange={(e) => setState({ ...state, nombre: e.target.value })}
            maxLength={80}
            disabled={isPending}
            placeholder="Principiantes, Avanzado, …"
            aria-invalid={errors.nombre ? true : undefined}
          />
          {errors.nombre && (
            <p className="text-xs text-destructive">{errors.nombre}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Si lo dejás vacío, en la grilla se muestra "Clase · {'{'}Profesor{'}'}".
          </p>
        </div>

        {/* Días de la semana */}
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
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Hora de inicio */}
          <div className="space-y-2">
            <Label htmlFor="clase-hora">Hora de inicio</Label>
            <Input
              id="clase-hora"
              type="time"
              step={1800}
              value={state.hora_inicio}
              onChange={(e) =>
                setState({ ...state, hora_inicio: e.target.value })
              }
              disabled={isPending}
              required
              aria-invalid={errors.hora_inicio ? true : undefined}
            />
            {errors.hora_inicio && (
              <p className="text-xs text-destructive">{errors.hora_inicio}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Sólo horas en punto o y media.
            </p>
          </div>

          {/* Alquiler de cancha — nota informativa (modelo B, 0035). El
              valor se resuelve desde la tarifa de clase al cobrar. */}
          <div className="space-y-2">
            <Label>Alquiler de cancha</Label>
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
              <Info
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-muted-foreground">
                El alquiler de cancha lo define la tarifa de clases vigente
                para el horario. Configurala en{' '}
                <strong className="font-medium text-foreground">
                  Tarifas → Clases
                </strong>
                .
              </p>
            </div>
            {diasSinTarifa.length > 0 && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs"
              >
                <ShieldAlert
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                  aria-hidden="true"
                />
                <p>
                  Sin tarifa de clase configurada para{' '}
                  <strong className="font-medium text-foreground">
                    {diasSinTarifa.map((d) => DIA_NOMBRE_CORTO[d]).join(', ')}
                  </strong>{' '}
                  a las{' '}
                  <strong className="font-medium text-foreground">
                    {state.hora_inicio}
                  </strong>
                  . Podés guardar igual, pero no vas a poder cobrar hasta
                  que la configures.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Duración */}
        <div className="space-y-2">
          <Label>Duración</Label>
          <div className="flex flex-wrap gap-1.5">
            {DURACIONES_TURNO_VALIDAS.map((min) => (
              <button
                key={min}
                type="button"
                onClick={() =>
                  setState({ ...state, duracion_min: min })
                }
                disabled={isPending}
                aria-pressed={state.duracion_min === min}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  state.duracion_min === min
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {min} min
              </button>
            ))}
          </div>
          {errors.duracion_min && (
            <p className="text-xs text-destructive">{errors.duracion_min}</p>
          )}
        </div>

        {/* Activa */}
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="clase-activa" className="cursor-pointer">
              Activa
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está apagada, la clase no aparece en la grilla y libera
              los slots correspondientes.
            </p>
          </div>
          <Switch
            id="clase-activa"
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
                : 'Crear clase'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
