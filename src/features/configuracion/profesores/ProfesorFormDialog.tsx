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
  useCreateProfesor,
  useUpdateProfesor,
} from '@/features/configuracion/hooks/useProfesores';
import type { Profesor } from '@/types/database';
import {
  profesorSchema,
  type ProfesorFormState,
} from './profesorSchema';

interface ProfesorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: Profesor | null;
}

export function ProfesorFormDialog({
  open,
  onOpenChange,
  initialValue,
}: ProfesorFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ProfesorFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<
  Record<keyof ProfesorFormState | 'form', string>
>;

const defaultState: ProfesorFormState = {
  nombre: '',
  telefono: '',
  email: '',
  notas: '',
  activo: true,
};

function profesorToFormState(p: Profesor): ProfesorFormState {
  return {
    nombre: p.nombre,
    telefono: p.telefono ?? '',
    email: p.email ?? '',
    notas: p.notas ?? '',
    activo: p.activo,
  };
}

interface ProfesorFormBodyProps {
  initialValue: Profesor | null;
  onDone: () => void;
}

function ProfesorFormBody({ initialValue, onDone }: ProfesorFormBodyProps) {
  const isEdit = initialValue !== null;
  const createMutation = useCreateProfesor();
  const updateMutation = useUpdateProfesor();

  const [state, setState] = useState<ProfesorFormState>(
    initialValue ? profesorToFormState(initialValue) : defaultState,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = profesorSchema.safeParse(state);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'nombre' ||
          field === 'telefono' ||
          field === 'email' ||
          field === 'notas' ||
          field === 'activo'
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
            : 'No pudimos guardar el profesor. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? 'Editar profesor' : 'Nuevo profesor'}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos del profesor.'
            : 'Agregá un profesor al club. Sólo el nombre es obligatorio; el resto se puede completar después.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="profesor-nombre">Nombre</Label>
          <Input
            id="profesor-nombre"
            value={state.nombre}
            onChange={(e) => setState({ ...state, nombre: e.target.value })}
            maxLength={120}
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
          <Label htmlFor="profesor-telefono">Teléfono (opcional)</Label>
          <Input
            id="profesor-telefono"
            type="tel"
            inputMode="tel"
            value={state.telefono}
            onChange={(e) => setState({ ...state, telefono: e.target.value })}
            maxLength={40}
            disabled={isPending}
            aria-invalid={errors.telefono ? true : undefined}
            placeholder="+54 9 11 1234-5678"
          />
          {errors.telefono && (
            <p className="text-xs text-destructive">{errors.telefono}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="profesor-email">Email (opcional)</Label>
          <Input
            id="profesor-email"
            type="email"
            inputMode="email"
            value={state.email}
            onChange={(e) => setState({ ...state, email: e.target.value })}
            maxLength={120}
            disabled={isPending}
            aria-invalid={errors.email ? true : undefined}
            placeholder="profesor@ejemplo.com"
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="profesor-notas">Notas (opcional)</Label>
          <textarea
            id="profesor-notas"
            value={state.notas}
            onChange={(e) => setState({ ...state, notas: e.target.value })}
            disabled={isPending}
            rows={3}
            aria-invalid={errors.notas ? true : undefined}
            placeholder="Cualquier observación interna sobre el profesor…"
            className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {errors.notas && (
            <p className="text-xs text-destructive">{errors.notas}</p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="profesor-activo" className="cursor-pointer">
              Activo
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está apagado, no aparece al elegir profesor en una clase nueva.
            </p>
          </div>
          <Switch
            id="profesor-activo"
            checked={state.activo}
            onCheckedChange={(v) => setState({ ...state, activo: v })}
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
                : 'Crear profesor'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
