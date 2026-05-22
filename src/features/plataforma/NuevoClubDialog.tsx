import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, EyeOff, Info } from 'lucide-react';
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
import { useCrearClub } from './hooks/useCrearClub';
import { usePlanesDisponibles } from './hooks/usePlanesDisponibles';
import { nuevoClubSchema } from './nuevoClubSchema';

interface NuevoClubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  club: {
    nombre: string;
    plan_id: number | null;
  };
  admin: {
    nombre: string;
    email: string;
    password: string;
  };
}

const INITIAL: FormState = {
  club: { nombre: '', plan_id: null },
  admin: { nombre: '', email: '', password: '' },
};

type FieldErrors = Partial<
  Record<
    | 'club.nombre'
    | 'club.plan_id'
    | 'admin.nombre'
    | 'admin.email'
    | 'admin.password'
    | 'form',
    string
  >
>;

interface SuccessInfo {
  clubNombre: string;
  adminEmail: string;
}

/**
 * Modal de onboarding de club nuevo (panel de plataforma).
 *
 * Dos estados de UI:
 *   - Form: pide datos del club + primer admin.
 *   - Éxito: muestra "Club X creado. Su admin Y ya puede iniciar
 *     sesión." con el email visible para que el superadmin lo copie
 *     y se lo pase al admin nuevo por canal externo (el sistema NO
 *     manda email). Botón "Cerrar" controla la salida — el superadmin
 *     decide cuándo cerrar para tener tiempo de copiar.
 *
 * Llama a la Edge Function `crear-club` vía `useCrearClub`. El mensaje
 * de error ya viene en castellano de la function (gate de superadmin,
 * plan inválido, email duplicado, etc.).
 */
export function NuevoClubDialog({ open, onOpenChange }: NuevoClubDialogProps) {
  const planesQuery = usePlanesDisponibles();
  const crearMutation = useCrearClub();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);

  const pending = crearMutation.isPending;

  // Pre-seleccionar primer plan (por orden, típicamente 'basico')
  // cuando los planes terminan de cargar y el form aún no tiene plan.
  useEffect(() => {
    if (form.club.plan_id !== null) return;
    const primero = planesQuery.data?.[0];
    if (!primero) return;
    setForm((f) => ({
      ...f,
      club: { ...f.club, plan_id: primero.id },
    }));
  }, [planesQuery.data, form.club.plan_id]);

  function reset(): void {
    setForm(INITIAL);
    setErrors({});
    setShowPassword(false);
    setSuccessInfo(null);
  }

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = nuevoClubSchema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join('.');
        if (
          path === 'club.nombre' ||
          path === 'club.plan_id' ||
          path === 'admin.nombre' ||
          path === 'admin.email' ||
          path === 'admin.password'
        ) {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      const result = await crearMutation.mutateAsync(parsed.data);
      setSuccessInfo({
        clubNombre: result.club.nombre,
        adminEmail: result.admin.email,
      });
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos crear el club.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        {successInfo ? (
          <SuccessView
            info={successInfo}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nuevo club</DialogTitle>
              <DialogDescription>
                Creá un club nuevo con su primer administrador. El club
                se crea en estado <strong>Trial</strong>; podés cambiarlo
                después desde el detalle.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* ── Club ────────────────────────────────────────────── */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Club
                </h3>

                <div className="space-y-1">
                  <Label htmlFor="nuevo-club-nombre">Nombre</Label>
                  <Input
                    id="nuevo-club-nombre"
                    type="text"
                    value={form.club.nombre}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        club: { ...f.club, nombre: e.target.value },
                      }))
                    }
                    disabled={pending}
                    maxLength={120}
                    autoFocus
                    placeholder="Padel Center"
                    aria-invalid={!!errors['club.nombre']}
                  />
                  {errors['club.nombre'] && (
                    <p role="alert" className="text-xs text-destructive">
                      {errors['club.nombre']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label>Plan</Label>
                  {planesQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">
                      Cargando planes…
                    </p>
                  ) : planesQuery.error ? (
                    <p className="text-xs text-destructive">
                      {planesQuery.error.message}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(planesQuery.data ?? []).map((p) => {
                        const active = p.id === form.club.plan_id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                club: { ...f.club, plan_id: p.id },
                              }))
                            }
                            disabled={pending}
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
                            {p.nombre}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {errors['club.plan_id'] && (
                    <p role="alert" className="text-xs text-destructive">
                      {errors['club.plan_id']}
                    </p>
                  )}
                </div>
              </section>

              {/* ── Admin ───────────────────────────────────────────── */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Primer administrador
                </h3>

                <div className="space-y-1">
                  <Label htmlFor="nuevo-club-admin-nombre">Nombre</Label>
                  <Input
                    id="nuevo-club-admin-nombre"
                    type="text"
                    value={form.admin.nombre}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        admin: { ...f.admin, nombre: e.target.value },
                      }))
                    }
                    disabled={pending}
                    maxLength={120}
                    autoComplete="name"
                    placeholder="Pedro García"
                    aria-invalid={!!errors['admin.nombre']}
                  />
                  {errors['admin.nombre'] && (
                    <p role="alert" className="text-xs text-destructive">
                      {errors['admin.nombre']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="nuevo-club-admin-email">Email</Label>
                  <Input
                    id="nuevo-club-admin-email"
                    type="email"
                    value={form.admin.email}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        admin: { ...f.admin, email: e.target.value },
                      }))
                    }
                    disabled={pending}
                    maxLength={120}
                    autoComplete="email"
                    placeholder="pedro@club.com"
                    aria-invalid={!!errors['admin.email']}
                  />
                  {errors['admin.email'] && (
                    <p role="alert" className="text-xs text-destructive">
                      {errors['admin.email']}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="nuevo-club-admin-password">Contraseña</Label>
                  <div className="relative">
                    <Input
                      id="nuevo-club-admin-password"
                      type={showPassword ? 'text' : 'password'}
                      value={form.admin.password}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          admin: { ...f.admin, password: e.target.value },
                        }))
                      }
                      disabled={pending}
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      placeholder="Mínimo 8 caracteres"
                      className="pr-9"
                      aria-invalid={!!errors['admin.password']}
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
                  {errors['admin.password'] && (
                    <p role="alert" className="text-xs text-destructive">
                      {errors['admin.password']}
                    </p>
                  )}
                </div>

                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Info
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    Compartile la contraseña al admin de forma segura — el
                    sistema <strong className="font-semibold">NO la envía
                    por email</strong>. El admin va a poder cambiarla cuando
                    quiera.
                  </span>
                </div>
              </section>

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
                  {pending ? 'Creando club…' : 'Crear club'}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SuccessView
// ─────────────────────────────────────────────────────────────────────

function SuccessView({
  info,
  onClose,
}: {
  info: SuccessInfo;
  onClose: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2
            className="h-5 w-5"
            style={{ color: 'hsl(var(--estado-pagada))' }}
            aria-hidden="true"
          />
          Club creado
        </DialogTitle>
        <DialogDescription>
          El club se creó en estado Trial y su primer administrador ya
          puede iniciar sesión.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          <p className="text-foreground">
            Club <strong>{info.clubNombre}</strong> creado.
          </p>
          <p className="mt-1 text-muted-foreground">
            Su admin{' '}
            <strong className="font-medium text-foreground">
              {info.adminEmail}
            </strong>{' '}
            ya puede iniciar sesión.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Recordá pasarle la contraseña que ingresaste al admin por un
          canal seguro. Cuando entre por primera vez, va a ver el wizard
          de configuración inicial del club (canchas, horarios, tarifas).
        </p>
      </div>

      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Cerrar
        </Button>
      </DialogFooter>
    </>
  );
}
