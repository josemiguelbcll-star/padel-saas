import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSession } from './useSession';
import { NoClubAssignedScreen } from './NoClubAssignedScreen';
import { SessionFetchErrorScreen } from './SessionFetchErrorScreen';
import { UsuarioDesactivadoScreen } from './UsuarioDesactivadoScreen';
import { ClubBloqueadoScreen } from './ClubBloqueadoScreen';
import { mapAuthError } from './authErrors';

const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Ingresá tu email.')
    .email('Ingresá un email válido.'),
  password: z.string().min(1, 'Ingresá tu contraseña.'),
});

type FieldErrors = Partial<Record<'email' | 'password' | 'form', string>>;

export function LoginPage() {
  const { user, plataformaAdmin, loading, error: sessionError } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Estados para recuperación de contraseña
  const [mode, setMode] = useState<'login' | 'recover'>('login');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);

  // Orden estricto: respetar loading PRIMERO. Si decidimos redirigir o
  // mostrar el form mientras la sesión está resolviéndose, puede
  // rebotar (ej. el superadmin queda como user=null, plataformaAdmin=null
  // durante el SIGNED_IN inicial, y si chequeamos antes de tiempo
  // caemos al form aunque hay sesión activa).
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  // Caso borde: auth OK pero sin fila en `usuarios` ni en
  // `plataforma_admins`. Mostramos el mensaje también acá porque el
  // login técnicamente "funcionó" pero no podemos navegar a ningún lado.
  if (sessionError?.code === 'NO_USUARIO_ROW') {
    return <NoClubAssignedScreen />;
  }

  // Simetría con ProtectedRoute: si autenticamos pero falla la carga del
  // perfil (red caída, error de Postgres), el usuario merece ver el
  // mismo mensaje que vería navegando hacia una ruta protegida.
  if (sessionError?.code === 'FETCH_FAILED') {
    return <SessionFetchErrorScreen detail={sessionError.detail} />;
  }

  // Si el usuario fue desactivado (usuario de club o superadmin), el
  // SessionProvider hizo signOut y dejó el error específico. Lo
  // manejamos acá para coherencia con ProtectedRoute y
  // PlataformaProtectedRoute — el usuario no debería ver el form de
  // login sin saber por qué su última sesión se cortó.
  if (sessionError?.code === 'USUARIO_DESACTIVADO') {
    return <UsuarioDesactivadoScreen />;
  }

  // Club suspendido o dado de baja (0021): la plataforma bloqueó el
  // acceso del club. Mismo flujo que USUARIO_DESACTIVADO.
  if (
    sessionError?.code === 'CLUB_SUSPENDIDO' ||
    sessionError?.code === 'CLUB_BAJA'
  ) {
    return <ClubBloqueadoScreen motivo={sessionError.code} />;
  }

  // Superadmin con sesión activa → panel de plataforma.
  // IMPORTANTE: chequear plataformaAdmin ANTES que user. Un superadmin
  // puro (sólo en `plataforma_admins`, no en `usuarios`) tiene user=null
  // y plataformaAdmin set; si chequeamos user primero, el form sigue
  // visible aunque haya sesión activa, y al loguearse no hay redirect.
  // Si por algún motivo ambos estuvieran seteados, plataformaAdmin
  // tiene precedencia (mismo orden que en SessionProvider).
  if (plataformaAdmin) {
    return <Navigate to="/plataforma" replace />;
  }

  // Usuario de club con sesión activa → SaaS del club.
  if (user) {
    return <Navigate to="/app" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'email' || path === 'password') {
          fieldErrors[path] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setSubmitting(false);

    if (error) {
      setErrors({ form: mapAuthError(error) });
      return;
    }
  }

  async function handleRecoverySubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setRecoveryError(null);

    const emailTrimmed = recoveryEmail.trim();
    if (!emailTrimmed) {
      setRecoveryError('Ingresá tu email.');
      return;
    }
    if (!emailTrimmed.includes('@')) {
      setRecoveryError('Ingresá un email válido.');
      return;
    }

    setRecoverySubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailTrimmed, {
        redirectTo: `${window.location.origin}/reset-password?type=admin`,
      });
      if (error) throw error;
      setRecoverySent(true);
    } catch (err: any) {
      console.error('[LoginPage] Error recovery:', err);
      setRecoveryError(err.message || 'Error al enviar las instrucciones. Intentá de nuevo.');
    } finally {
      setRecoverySubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-4 text-center">
          <img
            src="/assets/matchgo_logo.svg"
            alt="MatchGo"
            className="mx-auto h-12 w-auto"
          />
          
          {mode === 'login' ? (
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Iniciar sesión
              </h1>
              <p className="text-sm text-muted-foreground">
                Ingresá tus credenciales para acceder al panel del club.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Recuperar contraseña
              </h1>
              <p className="text-sm text-muted-foreground">
                Te enviaremos un email con las instrucciones para reponer tu clave.
              </p>
            </div>
          )}
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
                required
              />
              {errors.email && (
                <p id="email-error" className="text-xs text-destructive">
                  {errors.email}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('recover');
                    setRecoveryError(null);
                    setRecoverySent(false);
                    setRecoveryEmail(email);
                  }}
                  className="text-xs text-primary hover:underline transition"
                  tabIndex={-1}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-xs text-destructive">
                  {errors.password}
                </p>
              )}
            </div>

            {errors.form && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {errors.form}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Ingresando…' : 'Iniciar sesión'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRecoverySubmit} className="space-y-4" noValidate>
            {recoverySent ? (
              <div className="space-y-4 text-center">
                <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  Hemos enviado un enlace de recuperación a <strong>{recoveryEmail}</strong>. Por favor, revisá tu bandeja de entrada.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setMode('login');
                    setRecoverySent(false);
                  }}
                >
                  Volver al inicio de sesión
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="recoveryEmail">Email de tu cuenta</Label>
                  <Input
                    id="recoveryEmail"
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    disabled={recoverySubmitting}
                    required
                    placeholder="tu@email.com"
                  />
                  {recoveryError && (
                    <p className="text-xs text-destructive">
                      {recoveryError}
                    </p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={recoverySubmitting}>
                  {recoverySubmitting ? 'Enviando…' : 'Enviar instrucciones'}
                </Button>

                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition underline"
                >
                  Volver al inicio de sesión
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

