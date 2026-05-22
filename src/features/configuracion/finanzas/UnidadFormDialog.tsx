import { useEffect, useState, type FormEvent } from 'react';
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
import { useSession } from '@/features/auth';
import {
  useCrearUnidad,
  useUpdateUnidad,
} from '@/features/finanzas/hooks/useUnidadesNegocio';
import {
  TIPOS_UNIDAD,
  TIPO_UNIDAD_LABEL,
  unidadSchema,
  type UnidadFormValues,
} from '@/features/finanzas/finanzasSchemas';
import type { TipoUnidad, UnidadNegocio } from '@/types/database';

interface UnidadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: UnidadNegocio | null;
}

interface FormState {
  nombre: string;
  tipo: TipoUnidad;
  activa: boolean;
}

const DEFAULT_STATE: FormState = {
  nombre: '',
  tipo: 'estructura',
  activa: true,
};

type FieldErrors = Partial<Record<keyof FormState | 'form', string>>;

export function UnidadFormDialog({
  open,
  onOpenChange,
  initialValue,
}: UnidadFormDialogProps) {
  const { club } = useSession();
  const crear = useCrearUnidad();
  const update = useUpdateUnidad();

  const [state, setState] = useState<FormState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = crear.isPending || update.isPending;
  const isEdit = initialValue !== null;

  useEffect(() => {
    if (open) {
      if (initialValue) {
        setState({
          nombre: initialValue.nombre,
          tipo: initialValue.tipo,
          activa: initialValue.activa,
        });
      } else {
        setState(DEFAULT_STATE);
      }
      setErrors({});
    }
  }, [open, initialValue]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = unidadSchema.safeParse(state satisfies UnidadFormValues);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'nombre' || path === 'tipo' || path === 'activa') {
          fe[path] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      if (isEdit && initialValue) {
        await update.mutateAsync({
          id: initialValue.id,
          changes: parsed.data,
        });
      } else {
        if (!club) {
          setErrors({ form: 'Sin club asignado.' });
          return;
        }
        await crear.mutateAsync({
          club_id: club.id,
          nombre: parsed.data.nombre,
          tipo: parsed.data.tipo,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos guardar la unidad.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar unidad' : 'Nueva unidad de negocio'}
          </DialogTitle>
          <DialogDescription>
            Las unidades agrupan los gastos e ingresos del club para el
            EERR. Los tipos <strong>canchas/clases/buffet/shop</strong>{' '}
            solo pueden tener UNA unidad por club (porque sus ingresos
            vienen de tablas únicas).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="unidad-nombre">Nombre</Label>
            <Input
              id="unidad-nombre"
              type="text"
              value={state.nombre}
              onChange={(e) => setState({ ...state, nombre: e.target.value })}
              disabled={pending}
              maxLength={80}
              autoFocus
              placeholder="Ej: Canchas, Auspicios Q2"
              aria-invalid={!!errors.nombre}
            />
            {errors.nombre && (
              <p role="alert" className="text-xs text-destructive">{errors.nombre}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {TIPOS_UNIDAD.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setState({ ...state, tipo: t })}
                  disabled={pending}
                  aria-pressed={state.tipo === t}
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    state.tipo === t
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {TIPO_UNIDAD_LABEL[t]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              <strong>canchas, clases, buffet, shop</strong>: unico por
              club. <strong>auspicios, membresias, estructura, otro</strong>:
              pueden tener varias.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="unidad-activa" className="cursor-pointer">
                Activa
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagada, no aparece en los selectores de gastos
                ni ingresos nuevos.
              </p>
            </div>
            <Switch
              id="unidad-activa"
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
              {pending
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : 'Crear unidad'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
