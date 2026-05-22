import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';
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
import { useCrearVendedor } from '@/features/configuracion/hooks/useCrearVendedor';
import type { Rol } from '@/types/database';
import { nuevoUsuarioSchema } from './usuarioSchema';

interface NuevoVendedorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FieldErrors = Partial<
  Record<'nombre' | 'email' | 'password' | 'rol' | 'form', string>
>;

interface FormState {
  nombre: string;
  email: string;
  password: string;
  rol: Rol;
}

const INITIAL: FormState = {
  nombre: '',
  email: '',
  password: '',
  rol: 'vendedor',
};

/**
 * Modal de creación de usuario nuevo (vendedor o admin). Llama a la
 * Edge Function `crear-vendedor` via el hook `useCrearVendedor`. El
 * admin elige la contraseña y se la comparte al nuevo usuario de forma
 * externa (el sistema no manda email).
 */
export function NuevoVendedorDialog({
  open,
  onOpenChange,
}: NuevoVendedorDialogProps) {
  const crearMutation = useCrearVendedor();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);

  const pending = crearMutation.isPending;

  function reset(): void {
    setForm(INITIAL);
    setErrors({});
    setShowPassword(false);
  }

  function handleOpenChange(next: boolean): void {
    if (pending) return; // No cerrar mientras se procesa
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = nuevoUsuarioSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'nombre' || path === 'email' || path === 'password' || path === 'rol') {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      await crearMutation.mutateAsync(parsed.data);
      reset();
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos crear el usuario.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo usuario</DialogTitle>
          <DialogDescription>
            Creá un vendedor o admin del club. El nuevo usuario va a
            poder iniciar sesión con el email y la contraseña que
            ingreses acá.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div className="space-y-1">
            <Label htmlFor="nuevo-usuario-nombre">Nombre</Label>
            <Input
              id="nuevo-usuario-nombre"
              type="text"
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              disabled={pending}
              maxLength={120}
              autoComplete="name"
              autoFocus
              placeholder="Pedro García"
              aria-invalid={!!errors.nombre}
              aria-describedby={errors.nombre ? 'err-nombre' : undefined}
            />
            {errors.nombre && (
              <p id="err-nombre" role="alert" className="text-xs text-destructive">
                {errors.nombre}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="nuevo-usuario-email">Email</Label>
            <Input
              id="nuevo-usuario-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={pending}
              maxLength={120}
              autoComplete="email"
              placeholder="pedro@ejemplo.com"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'err-email' : undefined}
            />
            {errors.email && (
              <p id="err-email" role="alert" className="text-xs text-destructive">
                {errors.email}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="nuevo-usuario-password">Contraseña</Label>
            <div className="relative">
              <Input
                id="nuevo-usuario-password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                disabled={pending}
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                placeholder="Mínimo 8 caracteres"
                className="pr-9"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'err-password' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={pending}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={
                  showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p id="err-password" role="alert" className="text-xs text-destructive">
                {errors.password}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>Rol</Label>
            <div className="flex gap-2">
              <RolPill
                label="Vendedor"
                active={form.rol === 'vendedor'}
                disabled={pending}
                onClick={() => setForm((f) => ({ ...f, rol: 'vendedor' }))}
              />
              <RolPill
                label="Admin"
                active={form.rol === 'admin'}
                disabled={pending}
                onClick={() => setForm((f) => ({ ...f, rol: 'admin' }))}
              />
            </div>
            {errors.rol && (
              <p role="alert" className="text-xs text-destructive">
                {errors.rol}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Compartile la contraseña al usuario de forma segura — el sistema
              <strong className="font-semibold"> NO la envía por email</strong>.
              El usuario va a poder cambiarla cuando quiera.
            </span>
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
              {pending ? 'Creando…' : 'Crear usuario'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RolPill({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}
