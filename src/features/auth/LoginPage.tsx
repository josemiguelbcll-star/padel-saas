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
  const { user, loading, error: sessionError } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  // Caso borde: auth OK pero sin fila en `usuarios`. Lo mostramos también
  // acá porque el login técnicamente "funcionó" pero no podemos navegar
  // al dashboard. Sin esto el usuario se quedaría viendo el form sin
  // entender por qué nada cambia.
  if (sessionError?.code === 'NO_USUARIO_ROW') {
    return <NoClubAssignedScreen />;
  }

  // Simetría con ProtectedRoute: si autenticamos pero falla la carga del
  // perfil (red caída, error de Postgres), el usuario merece ver el mismo
  // mensaje que vería navegando hacia una ruta protegida.
  if (sessionError?.code === 'FETCH_FAILED') {
    return <SessionFetchErrorScreen detail={sessionError.detail} />;
  }

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
    // El SessionProvider va a tomar el SIGNED_IN, cargar usuario+club,
    // y este componente se va a re-renderizar con user != null para
    // redirigir vía <Navigate to="/" />.
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
