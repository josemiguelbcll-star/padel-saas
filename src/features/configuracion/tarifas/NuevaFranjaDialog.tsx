import { useEffect, useState, type FormEvent } from 'react';
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
import { useCrearTarifa } from '@/features/configuracion/hooks/useTarifas';

const DIAS_SEMANA = [
  { value: 1, label: 'LUN', full: 'Lunes' },
  { value: 2, label: 'MAR', full: 'Martes' },
  { value: 3, label: 'MIE', full: 'Miércoles' },
  { value: 4, label: 'JUE', full: 'Jueves' },
  { value: 5, label: 'VIE', full: 'Viernes' },
  { value: 6, label: 'SAB', full: 'Sábado' },
  { value: 7, label: 'DOM', full: 'Domingo' },
] as const;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface NuevaFranjaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  nombre: string;
  monto: string;
  desde_hora: string;
  hasta_hora: string;
  dias_semana: number[];
  prioridad: string;
  vigente_desde: string;
}

const INITIAL = (): FormState => ({
  nombre: '',
  monto: '',
  desde_hora: '',
  hasta_hora: '',
  dias_semana: [],
  prioridad: '0',
  vigente_desde: todayISO(),
});

const schema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio.')
      .max(80, 'Máx. 80 caracteres.'),
    monto: z
      .number({ invalid_type_error: 'Ingresá un monto válido.' })
      .positive('El monto debe ser mayor a 0.'),
    desde_hora: z.string().default(''),
    hasta_hora: z.string().default(''),
    dias_semana: z.array(z.number().int().min(1).max(7)),
    prioridad: z.number().int().min(0),
    vigente_desde: z.string().min(1, 'La fecha es obligatoria.'),
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
 * Crea una franja nueva (= linaje nuevo, versión 0). El usuario define
 * nombre, monto inicial, opcionalmente franja horaria y días, prioridad,
 * y la fecha desde la que rige el precio (default hoy, permite futuro).
 *
 * El alta inicial usa fn_crear_tarifa server-side (patrón autoreferente).
 */
export function NuevaFranjaDialog({
  open,
  onOpenChange,
}: NuevaFranjaDialogProps) {
  const crear = useCrearTarifa();
  const [state, setState] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = crear.isPending;

  useEffect(() => {
    if (open) {
      setState(INITIAL());
      setErrors({});
    }
  }, [open]);

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

    const parsed = schema.safeParse({
      nombre: state.nombre,
      monto: state.monto.trim() === '' ? NaN : Number(state.monto),
      desde_hora: state.desde_hora,
      hasta_hora: state.hasta_hora,
      dias_semana: state.dias_semana,
      prioridad:
        state.prioridad.trim() === '' ? 0 : Number(state.prioridad),
      vigente_desde: state.vigente_desde,
    });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (
          p === 'nombre' || p === 'monto' || p === 'desde_hora' ||
          p === 'hasta_hora' || p === 'dias_semana' || p === 'prioridad' ||
          p === 'vigente_desde'
        ) {
          fe[p] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      await crear.mutateAsync({
        nombre: parsed.data.nombre,
        monto: parsed.data.monto,
        desde_hora: parsed.data.desde_hora === '' ? null : parsed.data.desde_hora,
        hasta_hora: parsed.data.hasta_hora === '' ? null : parsed.data.hasta_hora,
        dias_semana:
          parsed.data.dias_semana.length === 0 ? null : parsed.data.dias_semana,
        prioridad: parsed.data.prioridad,
        vigente_desde: parsed.data.vigente_desde,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos crear la franja.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva franja de tarifa</DialogTitle>
          <DialogDescription>
            Definí cuándo aplica esta franja (días/horario) y el precio
            inicial. Después podés cambiar el precio sin perder el
            historial.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="franja-nombre">Nombre</Label>
            <Input
              id="franja-nombre"
              type="text"
              value={state.nombre}
              onChange={(e) => setState({ ...state, nombre: e.target.value })}
              disabled={pending}
              maxLength={80}
              autoFocus
              placeholder="Ej: Punta noche, Tarifa única"
              aria-invalid={!!errors.nombre}
            />
            {errors.nombre && (
              <p role="alert" className="text-xs text-destructive">{errors.nombre}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="franja-monto">Precio inicial</Label>
              <Input
                id="franja-monto"
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
              <Label htmlFor="franja-vigente">Vigente desde</Label>
              <Input
                id="franja-vigente"
                type="date"
                value={state.vigente_desde}
                onChange={(e) =>
                  setState({ ...state, vigente_desde: e.target.value })
                }
                disabled={pending}
                aria-invalid={!!errors.vigente_desde}
              />
              {errors.vigente_desde && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.vigente_desde}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Franja horaria (opcional)</Label>
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
            <Label>Días de la semana (opcional)</Label>
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
            <Label htmlFor="franja-prioridad">Prioridad</Label>
            <Input
              id="franja-prioridad"
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
            <p className="text-[11px] text-muted-foreground">
              Cuando dos franjas aplican al mismo slot, gana la de
              <strong className="font-medium text-foreground"> mayor</strong>.
            </p>
            {errors.prioridad && (
              <p role="alert" className="text-xs text-destructive">{errors.prioridad}</p>
            )}
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
              {pending ? 'Creando…' : 'Crear franja'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
