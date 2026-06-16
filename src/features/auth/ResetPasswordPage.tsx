import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const userType = searchParams.get('type') || 'admin'; // 'admin' o 'player'

  useEffect(() => {
    // Verificar si ya hay una sesión establecida (caso común cuando Supabase procesa el link de recovery)
    async function checkSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setHasSession(true);
          setLoading(false);
        } else {
          // Escuchar cambios de auth por si se demora un instante en procesar el hash de la URL
          const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) {
              setHasSession(true);
              setLoading(false);
              subscription.unsubscribe();
            }
          });

          // Timeout de 2 segundos para dar tiempo a Supabase a parsear el hash. Si no, mostramos error.
          const timer = setTimeout(() => {
            subscription.unsubscribe();
            setLoading(false);
          }, 2000);

          return () => {
            clearTimeout(timer);
            subscription.unsubscribe();
          };
        }
      } catch (err) {
        console.error('[ResetPasswordPage] Error checkSession:', err);
        setLoading(false);
      }
    }
    void checkSession();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
    } catch (err: any) {
      console.error('[ResetPasswordPage] Error al cambiar clave:', err);
      setError(err.message || 'No se pudo restablecer la contraseña. Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoBack() {
    // Cerramos sesión para limpiar el estado de recovery actual
    await supabase.auth.signOut();
    if (userType === 'player') {
      navigate('/player');
    } else {
      navigate('/login');
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Verificando enlace de recuperación…
      </div>
    );
  }

  if (!hasSession && !success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Enlace inválido o expirado
            </h1>
            <p className="text-sm text-muted-foreground">
              El enlace para reponer tu clave no es válido o ya caducó. Por favor, solicitá uno nuevo.
            </p>
          </div>
          <Button onClick={handleGoBack} className="w-full">
            Volver al inicio de sesión
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Contraseña actualizada
            </h1>
            <p className="text-sm text-muted-foreground">
              Tu clave se actualizó correctamente. Ya podés iniciar sesión con tu nueva contraseña.
            </p>
          </div>
          <Button onClick={handleGoBack} className="w-full">
            Iniciar sesión
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Establecer nueva contraseña
          </h1>
          <p className="text-sm text-muted-foreground">
            Ingresá tu nueva contraseña para tu cuenta de {userType === 'player' ? 'Jugador' : 'Club'}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="password">Nueva contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
                className="pr-10"
                placeholder="Mínimo 6 caracteres"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <Input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
              required
              placeholder="Confirmar nueva contraseña"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Actualizando…' : 'Actualizar contraseña'}
          </Button>

          <button
            type="button"
            onClick={handleGoBack}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition underline"
          >
            Cancelar y volver al login
          </button>
        </form>
      </div>
    </div>
  );
}
