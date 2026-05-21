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
  useCreateJugador,
  useUpdateJugador,
} from '@/features/reservas/hooks/useJugadores';
import type {
  CategoriaJugador,
  GeneroJugador,
  Jugador,
  PosicionJugador,
} from '@/types/database';
import {
  CATEGORIAS,
  CATEGORIA_LABEL,
  GENEROS,
  GENERO_LABEL,
  POSICIONES,
  POSICION_LABEL,
  jugadorSchema,
  type JugadorFormState,
} from './jugadorSchema';

interface JugadorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: Jugador | null;
}

export function JugadorFormDialog({
  open,
  onOpenChange,
  initialValue,
}: JugadorFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <JugadorFormBody
          key={initialValue?.id ?? 'new'}
          initialValue={initialValue}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<
  Record<keyof JugadorFormState | 'form', string>
>;

const defaultState: JugadorFormState = {
  nombre: '',
  telefono: '',
  email: '',
  notas: '',
  genero: '',
  categoria: '',
  posicion: '',
  activo: true,
};

function jugadorToFormState(j: Jugador): JugadorFormState {
  return {
    nombre: j.nombre,
    telefono: j.telefono ?? '',
    email: j.email ?? '',
    notas: j.notas ?? '',
    genero: j.genero ?? '',
    categoria: j.categoria ?? '',
    posicion: j.posicion ?? '',
    activo: j.activo,
  };
}

// Orden visible de las categorías en el select: 1ra → 8va (de mayor a
// menor nivel, como típicamente se publican los rankings).
const CATEGORIAS_DISPLAY_ORDER = [
  'primera',
  'segunda',
  'tercera',
  'cuarta',
  'quinta',
  'sexta',
  'septima',
  'octava',
] as const satisfies readonly typeof CATEGORIAS[number][];

interface JugadorFormBodyProps {
  initialValue: Jugador | null;
  onDone: () => void;
}

function JugadorFormBody({ initialValue, onDone }: JugadorFormBodyProps) {
  const isEdit = initialValue !== null;
  const createMutation = useCreateJugador();
  const updateMutation = useUpdateJugador();

  const [state, setState] = useState<JugadorFormState>(
    initialValue ? jugadorToFormState(initialValue) : defaultState,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = jugadorSchema.safeParse(state);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'nombre' ||
          field === 'telefono' ||
          field === 'email' ||
          field === 'notas' ||
          field === 'genero' ||
          field === 'categoria' ||
          field === 'posicion' ||
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
          changes: {
            ...parsed.data,
            // `nivel` viejo (texto libre legacy) NO se toca desde esta
            // pantalla. Si el jugador venía con valor, queda igual.
            nivel: initialValue.nivel,
          },
        });
      } else {
        await createMutation.mutateAsync({
          ...parsed.data,
          // Jugadores nuevos arrancan con `nivel: null` (deprecado).
          nivel: null,
        });
      }
      onDone();
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos guardar el jugador. Probá de nuevo.',
      });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? 'Editar jugador' : 'Nuevo jugador'}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Modificá los datos del jugador. El nombre es lo único obligatorio; el resto se puede completar después.'
            : 'Agregá un jugador al club. Sólo el nombre es obligatorio; el resto se completa con el uso.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Nombre */}
        <div className="space-y-2">
          <Label htmlFor="jugador-nombre">Nombre</Label>
          <Input
            id="jugador-nombre"
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

        {/* Teléfono + Email */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="jugador-telefono">Teléfono (opcional)</Label>
            <Input
              id="jugador-telefono"
              type="tel"
              inputMode="tel"
              value={state.telefono}
              onChange={(e) =>
                setState({ ...state, telefono: e.target.value })
              }
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
            <Label htmlFor="jugador-email">Email (opcional)</Label>
            <Input
              id="jugador-email"
              type="email"
              inputMode="email"
              value={state.email}
              onChange={(e) => setState({ ...state, email: e.target.value })}
              maxLength={120}
              disabled={isPending}
              aria-invalid={errors.email ? true : undefined}
              placeholder="jugador@ejemplo.com"
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>
        </div>

        {/* Género (pills con "Sin especificar") */}
        <div className="space-y-2">
          <Label>Género</Label>
          <div className="flex flex-wrap gap-1.5">
            <PillButton
              active={state.genero === ''}
              onClick={() => setState({ ...state, genero: '' })}
              disabled={isPending}
            >
              Sin especificar
            </PillButton>
            {GENEROS.map((g) => (
              <PillButton
                key={g}
                active={state.genero === g}
                onClick={() =>
                  setState({ ...state, genero: g as GeneroJugador })
                }
                disabled={isPending}
              >
                {GENERO_LABEL[g]}
              </PillButton>
            ))}
          </div>
          {errors.genero && (
            <p className="text-xs text-destructive">{errors.genero}</p>
          )}
        </div>

        {/* Categoría (select nativo) */}
        <div className="space-y-2">
          <Label htmlFor="jugador-categoria">Categoría</Label>
          <select
            id="jugador-categoria"
            value={state.categoria}
            onChange={(e) =>
              setState({
                ...state,
                categoria: e.target.value as CategoriaJugador | '',
              })
            }
            disabled={isPending}
            aria-invalid={errors.categoria ? true : undefined}
            className={cn(
              'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <option value="">Sin especificar</option>
            {CATEGORIAS_DISPLAY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_LABEL[c]}
              </option>
            ))}
          </select>
          {errors.categoria && (
            <p className="text-xs text-destructive">{errors.categoria}</p>
          )}
        </div>

        {/* Posición (pills con "Sin especificar") */}
        <div className="space-y-2">
          <Label>Posición</Label>
          <div className="flex flex-wrap gap-1.5">
            <PillButton
              active={state.posicion === ''}
              onClick={() => setState({ ...state, posicion: '' })}
              disabled={isPending}
            >
              Sin especificar
            </PillButton>
            {POSICIONES.map((p) => (
              <PillButton
                key={p}
                active={state.posicion === p}
                onClick={() =>
                  setState({ ...state, posicion: p as PosicionJugador })
                }
                disabled={isPending}
              >
                {POSICION_LABEL[p]}
              </PillButton>
            ))}
          </div>
          {errors.posicion && (
            <p className="text-xs text-destructive">{errors.posicion}</p>
          )}
        </div>

        {/* Notas */}
        <div className="space-y-2">
          <Label htmlFor="jugador-notas">Notas (opcional)</Label>
          <textarea
            id="jugador-notas"
            value={state.notas}
            onChange={(e) => setState({ ...state, notas: e.target.value })}
            disabled={isPending}
            rows={3}
            aria-invalid={errors.notas ? true : undefined}
            placeholder="Observaciones internas sobre el jugador…"
            className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {errors.notas && (
            <p className="text-xs text-destructive">{errors.notas}</p>
          )}
        </div>

        {/* Activo */}
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="jugador-activo" className="cursor-pointer">
              Activo
            </Label>
            <p className="text-xs text-muted-foreground">
              Si está apagado, no aparece en el autocomplete de reservas.
              Los datos históricos se preservan.
            </p>
          </div>
          <Switch
            id="jugador-activo"
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
                : 'Crear jugador'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

interface PillButtonProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function PillButton({ active, onClick, disabled, children }: PillButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
