import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useActualizarMetadataTarifa } from '@/features/configuracion/hooks/useTarifas';
import type { TarifaLinaje } from './tarifaLineage';

const DIAS_SEMANA = [
  { value: 1, label: 'LUN', full: 'Lunes' },
  { value: 2, label: 'MAR', full: 'Martes' },
  { value: 3, label: 'MIE', full: 'Miércoles' },
  { value: 4, label: 'JUE', full: 'Jueves' },
  { value: 5, label: 'VIE', full: 'Viernes' },
  { value: 6, label: 'SAB', full: 'Sábado' },
  { value: 7, label: 'DOM', full: 'Domingo' },
] as const;

interface EditarMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linaje: TarifaLinaje | null;
}

interface FormState {
  nombre: string;
  desde_hora: string;
  hasta_hora: string;
  dias_semana: number[];
  prioridad: string;
  activa: boolean;
}

const schema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio.')
      .max(80, 'Máx. 80 caracteres.'),
    desde_hora: z.string().default(''),
    hasta_hora: z.string().default(''),
    dias_semana: z.array(z.number().int().min(1).max(7)),
    prioridad: z.number().int().min(0),
    activa: z.boolean(),
  })
  .refine(
    (d) =>
      (d.desde_hora === '' && d.hasta_hora === '') ||
      (d.desde_hora !== '' && d.hasta_hora !== ''),
    {
      message: 'Llená ambas horas o dejá ambas vacías.',
      path: ['desde_hora'],
    },
  )
  .refine(
    (d) =>
      d.desde_hora === '' ||
      d.hasta_hora === '' ||
      d.desde_hora < d.hasta_hora,
    {
      message: 'Hasta debe ser posterior a desde.',
      path: ['hasta_hora'],
    },
  );

type FieldErrors = Partial<Record<keyof FormState | 'form', string>>;

/**
 * Edita la metadata de TODAS las versiones del linaje (nombre, franja,
 * días, prioridad, activa). NO toca monto ni vigencia — eso lo hace
 * CambiarPrecioDialog.
 *
 * El warning principal: cambios afectan también las versiones históricas.
 * Si la franja "Hora pico" se renombra a "Punta noche", la versión vieja
 * también pasa a llamarse "Punta noche" — mantiene la coherencia
 * conceptual (es la misma franja a través del tiempo).
 */
export function EditarMetadataDialog({
  open,
  onOpenChange,
  linaje,
}: EditarMetadataDialogProps) {
  const actualizar = useActualizarMetadataTarifa();
  const [state, setState] = useState<FormState>({
    nombre: '',
    desde_hora: '',
    hasta_hora: '',
    dias_semana: [],
    prioridad: '0',
    activa: true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = actualizar.isPending;

  useEffect(() => {
    if (open && linaje) {
      setState({
        nombre: linaje.nombre,
        desde_hora: linaje.desde_hora ? linaje.desde_hora.slice(0, 5) : '',
        hasta_hora: linaje.hasta_hora ? linaje.hasta_hora.slice(0, 5) : '',
        dias_semana: linaje.dias_semana ?? [],
        prioridad: linaje.prioridad.toString(),
        activa: linaje.activa,
      });
      setErrors({});
    }
  }, [open, linaje]);

  function toggleDia(dia: number): void {
    const exists = state.dias_semana.includes(dia);
    const next = exists
      ? state.dias_semana.filter((d) => d !== dia)
      : [...state.dias_semana, dia];
    next.sort((a, b) => a - b);
    setState({ ...state, dias_semana: next });
  }

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});
    if (!linaje) return;

    const parsed = schema.safeParse({
      nombre: state.nombre,
      desde_hora: state.desde_hora,
      hasta_hora: state.hasta_hora,
      dias_semana: state.dias_semana,
      prioridad: state.prioridad.trim() === '' ? 0 : Number(state.prioridad),
      activa: state.activa,
    });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (
          p === 'nombre' || p === 'desde_hora' || p === 'hasta_hora' ||
          p === 'dias_semana' || p === 'prioridad' || p === 'activa'
        ) {
          fe[p] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      // La RPC usa flags clear_* para diferenciar "no tocar" de "limpiar".
      const tieneFranja =
        parsed.data.desde_hora !== '' && parsed.data.hasta_hora !== '';
      const tieneDias = parsed.data.dias_semana.length > 0;

      await actualizar.mutateAsync({
        lineage_id: linaje.lineage_id,
        nombre: parsed.data.nombre,
        desde_hora: tieneFranja ? parsed.data.desde_hora : undefined,
        hasta_hora: tieneFranja ? parsed.data.hasta_hora : undefined,
        dias_semana: tieneDias ? parsed.data.dias_semana : undefined,
        prioridad: parsed.data.prioridad,
        activa: parsed.data.activa,
        clear_franja_horaria: !tieneFranja,
        clear_dias_semana: !tieneDias,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos guardar los cambios.',
      });
    }
  }

  if (!linaje) return null;

  const tieneHistorial = linaje.versiones.length > 1;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar franja · {linaje.nombre}</DialogTitle>
          <DialogDescription>
            Cambiá nombre, horario, días o prioridad. <strong>No tocás el
            precio</strong> acá (para eso usá "Cambiar precio").
          </DialogDescription>
        </DialogHeader>

        {tieneHistorial && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
              aria-hidden="true"
            />
            <p>
              Esta franja tiene <strong>{linaje.versiones.length} versiones
              de precio</strong>. Los cambios de metadata aplican a TODAS
              (incluso las históricas), para mantener consistencia
              conceptual.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="meta-nombre">Nombre</Label>
            <Input
              id="meta-nombre"
              type="text"
              value={state.nombre}
              onChange={(e) => setState({ ...state, nombre: e.target.value })}
              disabled={pending}
              maxLength={80}
              autoFocus
              aria-invalid={!!errors.nombre}
            />
            {errors.nombre && (
              <p role="alert" className="text-xs text-destructive">{errors.nombre}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Franja horaria</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="time"
                value={state.desde_hora}
                onChange={(e) => setState({ ...state, desde_hora: e.target.value })}
                disabled={pending}
                aria-label="Desde"
                aria-invalid={!!errors.desde_hora}
              />
              <Input
                type="time"
                value={state.hasta_hora}
                onChange={(e) => setState({ ...state, hasta_hora: e.target.value })}
                disabled={pending}
                aria-label="Hasta"
                aria-invalid={!!errors.hasta_hora}
              />
            </div>
            {(errors.desde_hora || errors.hasta_hora) && (
              <p role="alert" className="text-xs text-destructive">
                {errors.desde_hora ?? errors.hasta_hora}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Vacías = aplica a cualquier hora.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Días de la semana</Label>
            <div className="flex flex-wrap gap-1">
              {DIAS_SEMANA.map((d) => {
                const selected = state.dias_semana.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleDia(d.value)}
                    disabled={pending}
                    title={d.full}
                    aria-pressed={selected}
                    aria-label={d.full}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
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
            <p className="text-[11px] text-muted-foreground">
              Sin selección = aplica todos los días.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="meta-prioridad">Prioridad</Label>
            <Input
              id="meta-prioridad"
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              value={state.prioridad}
              onChange={(e) => setState({ ...state, prioridad: e.target.value })}
              disabled={pending}
              className="w-28"
              aria-invalid={!!errors.prioridad}
            />
            {errors.prioridad && (
              <p role="alert" className="text-xs text-destructive">{errors.prioridad}</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="meta-activa" className="cursor-pointer">
                Activa
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagada, no se ofrece al crear reservas nuevas.
              </p>
            </div>
            <Switch
              id="meta-activa"
              checked={state.activa}
              onCheckedChange={(v) => setState({ ...state, activa: v })}
              disabled={pending}
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
              {pending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
