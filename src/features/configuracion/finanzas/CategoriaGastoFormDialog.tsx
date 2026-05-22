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
import { useSession } from '@/features/auth';
import {
  useCrearCategoria,
  useUpdateCategoria,
} from '@/features/finanzas/hooks/useCategoriasGasto';
import { useUnidadesNegocio } from '@/features/finanzas/hooks/useUnidadesNegocio';
import {
  categoriaGastoSchema,
  TIPO_UNIDAD_LABEL,
} from '@/features/finanzas/finanzasSchemas';
import type { CategoriaGasto } from '@/types/database';

interface CategoriaGastoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: CategoriaGasto | null;
}

interface FormState {
  nombre: string;
  unidad_id: number | null;
  activa: boolean;
}

type FieldErrors = Partial<Record<'nombre' | 'unidad_id' | 'activa' | 'form', string>>;

const DEFAULT_STATE: FormState = {
  nombre: '',
  unidad_id: null,
  activa: true,
};

export function CategoriaGastoFormDialog({
  open,
  onOpenChange,
  initialValue,
}: CategoriaGastoFormDialogProps) {
  const { club } = useSession();
  const unidadesQuery = useUnidadesNegocio();
  const crear = useCrearCategoria();
  const update = useUpdateCategoria();

  const [state, setState] = useState<FormState>(DEFAULT_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});

  const pending = crear.isPending || update.isPending;
  const isEdit = initialValue !== null;

  useEffect(() => {
    if (open) {
      if (initialValue) {
        setState({
          nombre: initialValue.nombre,
          unidad_id: initialValue.unidad_id,
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

    const parsed = categoriaGastoSchema.safeParse({
      nombre: state.nombre,
      unidad_id: state.unidad_id ?? 0,
      activa: state.activa,
    });
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'nombre' || path === 'unidad_id' || path === 'activa') {
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
          unidad_id: parsed.data.unidad_id,
          nombre: parsed.data.nombre,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos guardar la categoría.',
      });
    }
  }

  const unidadesActivas = (unidadesQuery.data ?? []).filter((u) => u.activa);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar categoría de gasto' : 'Nueva categoría de gasto'}
          </DialogTitle>
          <DialogDescription>
            Cada categoría pertenece a una unidad. Si Buffet y Shop
            ambos tienen "Mercadería", son dos categorías distintas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="cat-nombre">Nombre</Label>
            <Input
              id="cat-nombre"
              type="text"
              value={state.nombre}
              onChange={(e) => setState({ ...state, nombre: e.target.value })}
              disabled={pending}
              maxLength={80}
              autoFocus
              placeholder="Ej: Mercadería, Alquiler local"
              aria-invalid={!!errors.nombre}
            />
            {errors.nombre && (
              <p role="alert" className="text-xs text-destructive">{errors.nombre}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cat-unidad">Unidad de negocio</Label>
            <select
              id="cat-unidad"
              value={state.unidad_id ?? ''}
              onChange={(e) =>
                setState({
                  ...state,
                  unidad_id: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              disabled={pending}
              required
              aria-invalid={!!errors.unidad_id}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">— Elegí una unidad —</option>
              {unidadesActivas.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({TIPO_UNIDAD_LABEL[u.tipo]})
                </option>
              ))}
            </select>
            {errors.unidad_id && (
              <p role="alert" className="text-xs text-destructive">{errors.unidad_id}</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="cat-activa" className="cursor-pointer">
                Activa
              </Label>
              <p className="text-xs text-muted-foreground">
                Si está apagada, no aparece para cargar gastos nuevos.
              </p>
            </div>
            <Switch
              id="cat-activa"
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
              {pending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear categoría'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
