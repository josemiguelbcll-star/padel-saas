import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Repeat } from 'lucide-react';
import { z } from 'zod';
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
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { JugadorAutocomplete } from '@/features/reservas/JugadorAutocomplete';
import type { JugadorSeleccionado } from '@/features/reservas/JugadorAutocomplete';
import { useCrearTurnoFijo } from './hooks/useTurnosFijos';

const DIAS_SEMANA = [
  { value: 1, label: 'LUN', full: 'Lunes' },
  { value: 2, label: 'MAR', full: 'Martes' },
  { value: 3, label: 'MIE', full: 'Miércoles' },
  { value: 4, label: 'JUE', full: 'Jueves' },
  { value: 5, label: 'VIE', full: 'Viernes' },
  { value: 6, label: 'SAB', full: 'Sábado' },
  { value: 7, label: 'DOM', full: 'Domingo' },
] as const;

const DURACIONES = [60, 90, 120, 150, 180, 240] as const;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface FormState {
  cancha_id: string;
  titular: JugadorSeleccionado | null;
  dia_semana: number | null;
  hora_inicio: string;
  duracion_min: number;
  fecha_desde: string;
  fecha_hasta: string;
  observaciones: string;
}

const INITIAL = (): FormState => ({
  cancha_id: '',
  titular: null,
  dia_semana: null,
  hora_inicio: '',
  duracion_min: 90,
  fecha_desde: todayISO(),
  fecha_hasta: '',
  observaciones: '',
});

const schema = z.object({
  cancha_id: z.coerce.number().int().positive('Elegí una cancha.'),
  dia_semana: z.number().int().min(1).max(7),
  hora_inicio: z.string().min(1, 'Elegí la hora de inicio.'),
  duracion_min: z.number().int().refine((v) => DURACIONES.includes(v as 60), {
    message: 'Duración inválida.',
  }),
  fecha_desde: z.string().min(1, 'La fecha desde es obligatoria.'),
  fecha_hasta: z.string().nullable(),
  observaciones: z.string().nullable(),
});

type FieldErrors = Partial<Record<
  | 'cancha_id'
  | 'titular'
  | 'dia_semana'
  | 'hora_inicio'
  | 'duracion_min'
  | 'fecha_desde'
  | 'fecha_hasta'
  | 'form',
  string
>>;

interface NuevoTurnoFijoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SubmitMode = 'cerrar' | 'seguir';

/**
 * Alta de turno fijo. UX optimizada para carga masiva en onboarding:
 * dos botones — "Guardar y cerrar" y "Guardar y seguir agregando"
 * (este conserva cancha + día + duración + fechas, resetea cliente +
 * hora — el patrón típico es "los miércoles de la cancha 1 los tengo
 * así: 19h Juan, 20:30h María, 22h Pedro").
 */
export function NuevoTurnoFijoDialog({
  open,
  onOpenChange,
}: NuevoTurnoFijoDialogProps) {
  const crear = useCrearTurnoFijo();
  const canchasQuery = useCanchas();
  const [state, setState] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [ultimoCreado, setUltimoCreado] = useState<string | null>(null);
  const submitModeRef = useRef<SubmitMode>('cerrar');

  const pending = crear.isPending;

  useEffect(() => {
    if (open) {
      setState(INITIAL());
      setErrors({});
      setUltimoCreado(null);
    }
  }, [open]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  function resetParaSeguir(prev: FormState): FormState {
    return {
      ...prev,
      titular: null,
      hora_inicio: '',
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    if (!state.titular) {
      setErrors({ titular: 'Elegí un cliente o un nombre.' });
      return;
    }
    if (state.dia_semana === null) {
      setErrors({ dia_semana: 'Elegí el día de la semana.' });
      return;
    }

    const parsed = schema.safeParse({
      cancha_id: state.cancha_id,
      dia_semana: state.dia_semana,
      hora_inicio: state.hora_inicio,
      duracion_min: state.duracion_min,
      fecha_desde: state.fecha_desde,
      fecha_hasta: state.fecha_hasta === '' ? null : state.fecha_hasta,
      observaciones: state.observaciones === '' ? null : state.observaciones,
    });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (
          p === 'cancha_id' || p === 'dia_semana' || p === 'hora_inicio' ||
          p === 'duracion_min' || p === 'fecha_desde' || p === 'fecha_hasta'
        ) {
          fe[p] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    const titular = state.titular;
    const jugador_id = titular.kind === 'jugador' ? titular.jugadorId : null;
    const nombre_libre = titular.kind === 'libre' ? titular.nombre : null;
    const mode = submitModeRef.current;

    try {
      await crear.mutateAsync({
        cancha_id: parsed.data.cancha_id,
        jugador_id,
        nombre_libre,
        dia_semana: parsed.data.dia_semana,
        hora_inicio: parsed.data.hora_inicio,
        duracion_min: parsed.data.duracion_min,
        fecha_desde: parsed.data.fecha_desde,
        fecha_hasta: parsed.data.fecha_hasta,
        observaciones: parsed.data.observaciones,
      });

      if (mode === 'seguir') {
        const titularNombre = titular.kind === 'jugador' ? titular.nombre : titular.nombre;
        setUltimoCreado(`✓ ${titularNombre} agregado. Siguiente:`);
        setState((prev) => resetParaSeguir(prev));
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos crear el turno fijo.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-primary" aria-hidden="true" />
            Nuevo turno fijo
          </DialogTitle>
          <DialogDescription>
            Acuerdo recurrente: cliente + cancha + día + hora. Después se
            materializan las reservas semana a semana.
          </DialogDescription>
        </DialogHeader>

        {ultimoCreado && (
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
            <Check
              className="h-3.5 w-3.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>{ultimoCreado}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Cliente */}
          <div className="space-y-1">
            <Label htmlFor="tf-titular">Cliente</Label>
            <JugadorAutocomplete
              id="tf-titular"
              value={state.titular}
              onChange={(v) => setState({ ...state, titular: v })}
              permitirNombreLibre={true}
              disabled={pending}
              placeholder="Buscá un jugador o tipeá un nombre"
              aria-label="Cliente del turno fijo"
            />
            {errors.titular && (
              <p role="alert" className="text-xs text-destructive">{errors.titular}</p>
            )}
          </div>

          {/* Cancha + Día */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tf-cancha">Cancha</Label>
              <select
                id="tf-cancha"
                value={state.cancha_id}
                onChange={(e) => setState({ ...state, cancha_id: e.target.value })}
                disabled={pending || canchasQuery.isLoading}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
                aria-invalid={!!errors.cancha_id}
              >
                <option value="">— Elegí —</option>
                {(canchasQuery.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
              {errors.cancha_id && (
                <p role="alert" className="text-xs text-destructive">{errors.cancha_id}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Día de la semana</Label>
              <div className="flex flex-wrap gap-1">
                {DIAS_SEMANA.map((d) => {
                  const sel = state.dia_semana === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setState({ ...state, dia_semana: d.value })}
                      disabled={pending}
                      title={d.full}
                      aria-pressed={sel}
                      aria-label={d.full}
                      className={cn(
                        'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        sel
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              {errors.dia_semana && (
                <p role="alert" className="text-xs text-destructive">{errors.dia_semana}</p>
              )}
            </div>
          </div>

          {/* Hora + Duración */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tf-hora">Hora de inicio</Label>
              <Input
                id="tf-hora"
                type="time"
                value={state.hora_inicio}
                onChange={(e) => setState({ ...state, hora_inicio: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.hora_inicio}
              />
              {errors.hora_inicio && (
                <p role="alert" className="text-xs text-destructive">{errors.hora_inicio}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="tf-duracion">Duración</Label>
              <select
                id="tf-duracion"
                value={state.duracion_min}
                onChange={(e) => setState({ ...state, duracion_min: Number(e.target.value) })}
                disabled={pending}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {DURACIONES.map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
          </div>

          {/* Vigencia */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tf-desde">Vigente desde</Label>
              <Input
                id="tf-desde"
                type="date"
                value={state.fecha_desde}
                onChange={(e) => setState({ ...state, fecha_desde: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.fecha_desde}
              />
              {errors.fecha_desde && (
                <p role="alert" className="text-xs text-destructive">{errors.fecha_desde}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="tf-hasta">Hasta (opcional)</Label>
              <Input
                id="tf-hasta"
                type="date"
                value={state.fecha_hasta}
                min={state.fecha_desde || undefined}
                onChange={(e) => setState({ ...state, fecha_hasta: e.target.value })}
                disabled={pending}
              />
              <p className="text-[11px] text-muted-foreground">
                Vacío = indefinido.
              </p>
            </div>
          </div>

          {/* Observaciones */}
          <div className="space-y-1">
            <Label htmlFor="tf-obs">Observaciones (opcional)</Label>
            <textarea
              id="tf-obs"
              value={state.observaciones}
              onChange={(e) => setState({ ...state, observaciones: e.target.value })}
              disabled={pending}
              rows={2}
              className={cn(
                'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
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

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
              onClick={() => { submitModeRef.current = 'seguir'; }}
              title="Conserva cancha, día, duración y fechas — limpia cliente y hora"
            >
              {pending && submitModeRef.current === 'seguir'
                ? 'Guardando…'
                : 'Guardar y seguir'}
            </Button>
            <Button
              type="submit"
              disabled={pending}
              onClick={() => { submitModeRef.current = 'cerrar'; }}
            >
              {pending && submitModeRef.current === 'cerrar'
                ? 'Guardando…'
                : 'Guardar y cerrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
