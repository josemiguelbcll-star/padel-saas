import { useEffect, useState, type FormEvent } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import {
  useHorariosClub,
  useUpdateHorariosClub,
  type HorariosClub,
} from '@/features/configuracion/hooks/useHorariosClub';
import {
  DURACIONES_TURNO_VALIDAS,
  horariosSchema,
} from './horariosSchema';

type FieldErrors = Partial<
  Record<'hora_apertura' | 'hora_cierre' | 'duracion_turno_default' | 'form', string>
>;

interface FormState {
  hora_apertura: string;
  hora_cierre: string;
  duracion_turno_default: number;
}

function horariosToForm(h: HorariosClub): FormState {
  return {
    hora_apertura: h.hora_apertura ? h.hora_apertura.slice(0, 5) : '',
    hora_cierre: h.hora_cierre ? h.hora_cierre.slice(0, 5) : '',
    duracion_turno_default: h.duracion_turno_default,
  };
}

export function HorariosPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';
  const horariosQuery = useHorariosClub();

  if (horariosQuery.isLoading) {
    return (
      <section className="space-y-4" aria-busy="true">
        <PageHeader />
        <div className="h-32 animate-pulse rounded-md border border-border bg-muted/40" />
      </section>
    );
  }

  if (horariosQuery.error) {
    return (
      <section className="space-y-4">
        <PageHeader />
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {horariosQuery.error.message}
        </div>
      </section>
    );
  }

  if (!horariosQuery.data) {
    return null;
  }

  const sinConfigurar =
    horariosQuery.data.hora_apertura === null &&
    horariosQuery.data.hora_cierre === null;

  return (
    <section className="space-y-4">
      <PageHeader />

      {sinConfigurar && (
        <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              El club todavía no tiene horarios configurados.
            </p>
            <p className="text-muted-foreground">
              Definí la hora de apertura, la hora de cierre y la duración por
              defecto del turno para que el módulo de Reservas pueda mostrar la
              grilla.
            </p>
          </div>
        </div>
      )}

      {isAdmin ? (
        <HorariosForm initial={horariosQuery.data} />
      ) : (
        <HorariosReadOnly value={horariosQuery.data} />
      )}
    </section>
  );
}

function PageHeader() {
  return (
    <header className="space-y-1">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        Horarios
      </h2>
      <p className="text-sm text-muted-foreground">
        Horario de operación del club y duración por defecto de cada turno.
        Estos valores se usan en la grilla de reservas.
      </p>
    </header>
  );
}

interface HorariosFormProps {
  initial: HorariosClub;
}

function HorariosForm({ initial }: HorariosFormProps) {
  const updateMutation = useUpdateHorariosClub();
  const [state, setState] = useState<FormState>(() => horariosToForm(initial));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Si los datos del server cambian (ej. invalidación tras guardado), re-sincronizar.
  useEffect(() => {
    setState(horariosToForm(initial));
  }, [initial]);

  const isPending = updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    setSavedAt(null);

    const toValidate = {
      hora_apertura: state.hora_apertura === '' ? null : state.hora_apertura,
      hora_cierre: state.hora_cierre === '' ? null : state.hora_cierre,
      duracion_turno_default: state.duracion_turno_default,
    };
    const parsed = horariosSchema.safeParse(toValidate);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'hora_apertura' ||
          field === 'hora_cierre' ||
          field === 'duracion_turno_default'
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
      await updateMutation.mutateAsync(parsed.data);
      setSavedAt(new Date());
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar los horarios. Probá de nuevo.',
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="hora-apertura">Apertura</Label>
          <Input
            id="hora-apertura"
            type="time"
            value={state.hora_apertura}
            onChange={(e) =>
              setState({ ...state, hora_apertura: e.target.value })
            }
            disabled={isPending}
            aria-invalid={errors.hora_apertura ? true : undefined}
          />
          {errors.hora_apertura && (
            <p className="text-xs text-destructive">{errors.hora_apertura}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="hora-cierre">Cierre</Label>
          <Input
            id="hora-cierre"
            type="time"
            value={state.hora_cierre}
            onChange={(e) =>
              setState({ ...state, hora_cierre: e.target.value })
            }
            disabled={isPending}
            aria-invalid={errors.hora_cierre ? true : undefined}
          />
          {errors.hora_cierre && (
            <p className="text-xs text-destructive">{errors.hora_cierre}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Duración del turno por defecto</Label>
        <div className="flex flex-wrap gap-1.5">
          {DURACIONES_TURNO_VALIDAS.map((min) => (
            <button
              key={min}
              type="button"
              onClick={() =>
                setState({ ...state, duracion_turno_default: min })
              }
              disabled={isPending}
              aria-pressed={state.duracion_turno_default === min}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                state.duracion_turno_default === min
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {min} min
            </button>
          ))}
        </div>
        {errors.duracion_turno_default && (
          <p className="text-xs text-destructive">
            {errors.duracion_turno_default}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Las reservas nuevas se proponen con esta duración. Más adelante vas a poder
          elegir otra al crear cada reserva.
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

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        {savedAt && !isPending && (
          <span
            className="text-xs text-muted-foreground"
            aria-live="polite"
          >
            Guardado a las{' '}
            {savedAt.toLocaleTimeString('es-AR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </form>
  );
}

interface HorariosReadOnlyProps {
  value: HorariosClub;
}

function HorariosReadOnly({ value }: HorariosReadOnlyProps) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1 rounded-md border border-border bg-card p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Apertura
          </dt>
          <dd className="text-base font-medium text-foreground">
            {value.hora_apertura ? value.hora_apertura.slice(0, 5) : '—'}
          </dd>
        </div>
        <div className="space-y-1 rounded-md border border-border bg-card p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Cierre
          </dt>
          <dd className="text-base font-medium text-foreground">
            {value.hora_cierre ? value.hora_cierre.slice(0, 5) : '—'}
          </dd>
        </div>
        <div className="space-y-1 rounded-md border border-border bg-card p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Duración del turno
          </dt>
          <dd className="text-base font-medium text-foreground">
            {value.duracion_turno_default} min
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Sólo el administrador del club puede modificar estos valores.
      </p>
    </div>
  );
}
