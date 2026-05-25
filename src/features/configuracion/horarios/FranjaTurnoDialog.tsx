import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
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
import type { FranjaTurno } from '@/types/database';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { diaSemanaDe, fechaHoy } from '@/features/reservas/utils/fechaUtils';
import {
  useActualizarFranjaTurno,
  useCrearFranjaTurno,
} from '@/features/configuracion/hooks/useFranjasTurno';
import { DURACIONES_TURNO_VALIDAS } from './horariosSchema';
import { DIAS_SEMANA, franjaTurnoSchema } from './franjaTurnoSchema';
import { fechaDeISODOW, previsualizarInicios } from './previewFranjas';
import { VistaPreviaDia } from './VistaPreviaDia';

interface FranjaTurnoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Franja a editar, o null para alta. */
  editing: FranjaTurno | null;
  /** Franjas guardadas — la vista previa mergea el borrador con éstas. */
  franjasGuardadas: FranjaTurno[];
  horaApertura: string | null;
  horaCierre: string | null;
  duracionDefault: number;
}

interface FormState {
  nombre: string;
  desde_hora: string; // 'HH:MM' o ''
  hasta_hora: string;
  dias: number[];
  duraciones: number[];
  prioridad: number;
  cancha_id: number | null;
}

type FieldErrors = Partial<
  Record<'nombre' | 'desde_hora' | 'hasta_hora' | 'dias' | 'duraciones' | 'form', string>
>;

const TODOS_LOS_DIAS = [1, 2, 3, 4, 5, 6, 7];

function initialState(editing: FranjaTurno | null): FormState {
  if (!editing) {
    return {
      nombre: '',
      desde_hora: '',
      hasta_hora: '',
      dias: [...TODOS_LOS_DIAS],
      duraciones: [],
      prioridad: 0,
      cancha_id: null,
    };
  }
  return {
    nombre: editing.nombre,
    desde_hora: editing.desde_hora ? editing.desde_hora.slice(0, 5) : '',
    hasta_hora: editing.hasta_hora ? editing.hasta_hora.slice(0, 5) : '',
    // dias_semana NULL en DB = todos los días.
    dias: editing.dias_semana ?? [...TODOS_LOS_DIAS],
    duraciones: [...editing.duraciones_min].sort((a, b) => a - b),
    prioridad: editing.prioridad,
    cancha_id: editing.cancha_id,
  };
}

export function FranjaTurnoDialog({
  open,
  onOpenChange,
  editing,
  franjasGuardadas,
  horaApertura,
  horaCierre,
  duracionDefault,
}: FranjaTurnoDialogProps) {
  const canchasQuery = useCanchas();
  const crear = useCrearFranjaTurno();
  const actualizar = useActualizarFranjaTurno();

  const [state, setState] = useState<FormState>(() => initialState(editing));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const pending = crear.isPending || actualizar.isPending;

  useEffect(() => {
    if (open) {
      setState(initialState(editing));
      setErrors({});
      setAdvancedOpen(editing != null && (editing.prioridad !== 0 || editing.cancha_id !== null));
    }
  }, [open, editing]);

  function toggleDia(n: number): void {
    setState((s) => ({
      ...s,
      dias: s.dias.includes(n)
        ? s.dias.filter((d) => d !== n)
        : [...s.dias, n].sort((a, b) => a - b),
    }));
  }

  function toggleDuracion(min: number): void {
    setState((s) => ({
      ...s,
      duraciones: s.duraciones.includes(min)
        ? s.duraciones.filter((d) => d !== min)
        : [...s.duraciones, min].sort((a, b) => a - b),
    }));
  }

  // ── Vista previa en vivo (mergea el borrador con las guardadas) ──────
  const inicios = useMemo(() => {
    if (!horaApertura || !horaCierre) return [];
    // Día para previsualizar: uno donde el borrador aplique. Si hoy está
    // entre sus días, usamos hoy; si no, el primero seleccionado.
    const hoy = diaSemanaDe(fechaHoy());
    const diaPreview =
      state.dias.length === 0
        ? 1
        : state.dias.includes(hoy)
          ? hoy
          : Math.min(...state.dias);

    const draft: FranjaTurno = {
      id: editing?.id ?? -1,
      club_id: editing?.club_id ?? -1,
      cancha_id: state.cancha_id,
      nombre: state.nombre || '(borrador)',
      desde_hora: state.desde_hora === '' ? null : state.desde_hora,
      hasta_hora: state.hasta_hora === '' ? null : state.hasta_hora,
      dias_semana: state.dias.length === 7 ? null : state.dias,
      duraciones_min: state.duraciones,
      prioridad: state.prioridad,
      activa: true,
    };

    const base = franjasGuardadas.filter((f) => f.id !== editing?.id);
    return previsualizarInicios({
      franjas: [...base, draft],
      horaApertura,
      horaCierre,
      duracionDefault,
      fecha: fechaDeISODOW(diaPreview),
      canchaId: state.cancha_id ?? undefined,
    });
  }, [
    state,
    editing,
    franjasGuardadas,
    horaApertura,
    horaCierre,
    duracionDefault,
  ]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = franjaTurnoSchema.safeParse({
      nombre: state.nombre,
      desde_hora: state.desde_hora === '' ? null : state.desde_hora,
      hasta_hora: state.hasta_hora === '' ? null : state.hasta_hora,
      dias_semana: state.dias,
      duraciones_min: state.duraciones,
      prioridad: state.prioridad,
      cancha_id: state.cancha_id,
    });

    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const p = issue.path[0];
        if (p === 'nombre') fe.nombre = issue.message;
        else if (p === 'desde_hora') fe.desde_hora = issue.message;
        else if (p === 'hasta_hora') fe.hasta_hora = issue.message;
        else if (p === 'dias_semana') fe.dias = issue.message;
        else if (p === 'duraciones_min') fe.duraciones = issue.message;
        else fe.form = issue.message;
      }
      setErrors(fe);
      return;
    }

    // todos los días → NULL (la DB trata NULL como "todos").
    const dias_semana =
      parsed.data.dias_semana.length === 7 ? null : parsed.data.dias_semana;

    const payload = {
      cancha_id: parsed.data.cancha_id,
      nombre: parsed.data.nombre,
      desde_hora: parsed.data.desde_hora,
      hasta_hora: parsed.data.hasta_hora,
      dias_semana,
      duraciones_min: parsed.data.duraciones_min,
      prioridad: parsed.data.prioridad,
      activa: editing?.activa ?? true,
    };

    try {
      if (editing) {
        await actualizar.mutateAsync({ id: editing.id, changes: payload });
      } else {
        await crear.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos guardar la franja.',
      });
    }
  }

  const canchas = (canchasQuery.data ?? []).filter((c) => c.activa);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
            {editing ? 'Editar franja' : 'Agregar franja'}
          </DialogTitle>
          <DialogDescription>
            Definí en qué horario y días se permiten qué duraciones de turno.
            La grilla ofrece los inicios según estas reglas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Nombre */}
          <div className="space-y-1.5">
            <Label htmlFor="franja-nombre">Nombre</Label>
            <Input
              id="franja-nombre"
              value={state.nombre}
              onChange={(e) => setState({ ...state, nombre: e.target.value })}
              disabled={pending}
              maxLength={80}
              placeholder="Ej: Mañana, Tarde-noche"
              aria-invalid={!!errors.nombre}
            />
            {errors.nombre && (
              <p role="alert" className="text-xs text-destructive">{errors.nombre}</p>
            )}
          </div>

          {/* Franja horaria */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="franja-desde">De</Label>
              <Input
                id="franja-desde"
                type="time"
                value={state.desde_hora}
                onChange={(e) => setState({ ...state, desde_hora: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.desde_hora}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="franja-hasta">A</Label>
              <Input
                id="franja-hasta"
                type="time"
                value={state.hasta_hora}
                onChange={(e) => setState({ ...state, hasta_hora: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.hasta_hora}
              />
            </div>
          </div>
          {(errors.desde_hora || errors.hasta_hora) && (
            <p role="alert" className="text-xs text-destructive">
              {errors.desde_hora ?? errors.hasta_hora}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Dejá ambas vacías para que la franja aplique a toda hora.
          </p>

          {/* Días */}
          <div className="space-y-1.5">
            <Label>Días</Label>
            <div className="flex flex-wrap gap-1.5">
              {DIAS_SEMANA.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDia(d.n)}
                  disabled={pending}
                  aria-pressed={state.dias.includes(d.n)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    state.dias.includes(d.n)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {errors.dias && (
              <p role="alert" className="text-xs text-destructive">{errors.dias}</p>
            )}
          </div>

          {/* Duraciones permitidas */}
          <div className="space-y-1.5">
            <Label>Duraciones permitidas</Label>
            <div className="flex flex-wrap gap-1.5">
              {DURACIONES_TURNO_VALIDAS.map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => toggleDuracion(min)}
                  disabled={pending}
                  aria-pressed={state.duraciones.includes(min)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    state.duraciones.includes(min)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {min}&apos;
                </button>
              ))}
            </div>
            {errors.duraciones && (
              <p role="alert" className="text-xs text-destructive">{errors.duraciones}</p>
            )}
          </div>

          {/* Avanzado: prioridad + cancha específica */}
          <div className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50"
              aria-expanded={advancedOpen}
            >
              Avanzado (prioridad, cancha específica)
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
            {advancedOpen && (
              <div className="space-y-3 border-t border-border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="franja-prioridad" className="text-xs">
                    Prioridad
                  </Label>
                  <Input
                    id="franja-prioridad"
                    type="number"
                    inputMode="numeric"
                    value={state.prioridad}
                    onChange={(e) =>
                      setState({ ...state, prioridad: Number(e.target.value) || 0 })
                    }
                    disabled={pending}
                    className="w-24"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Si dos franjas se solapan, gana la de mayor prioridad.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="franja-cancha" className="text-xs">
                    Cancha
                  </Label>
                  <select
                    id="franja-cancha"
                    value={state.cancha_id ?? ''}
                    onChange={(e) =>
                      setState({
                        ...state,
                        cancha_id: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    disabled={pending}
                    className={cn(
                      'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                  >
                    <option value="">Todas las canchas</option>
                    {canchas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Por defecto aplica a todas. Una franja de cancha específica
                    gana sobre la global.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Vista previa en vivo del borrador */}
          <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Vista previa (con esta franja)
            </p>
            {horaApertura && horaCierre ? (
              <VistaPreviaDia inicios={inicios} />
            ) : (
              <p className="text-xs italic text-muted-foreground">
                Configurá apertura y cierre arriba para ver la vista previa.
              </p>
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
              {pending ? 'Guardando…' : editing ? 'Guardar franja' : 'Agregar franja'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
