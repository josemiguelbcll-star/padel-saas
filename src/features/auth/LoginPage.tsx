import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

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
    return <Navigate to="/" replace />;
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
    // El SessionProvider va a tomar el SIGNED_IN y cargar el perfil
    // (plataforma_admins primero, después usuarios+club). Este
    // componente se re-renderiza con plataformaAdmin o user seteado y
    // redirige al destino correcto (/plataforma o /).
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Iniciar sesión
          </h1>
          <p className="text-sm text-muted-foreground">
            Ingresá tus credenciales para acceder al panel del club.
          </p>
        </div>

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
              required
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              aria-invalid={errors.password ? true : undefined}
              required
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password}</p>
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
      </div>
    </div>
  );
}
