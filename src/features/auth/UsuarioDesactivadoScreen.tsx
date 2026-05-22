import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/**
 * Pantalla que se muestra cuando el usuario logueado tiene `activo=false`
 * en `usuarios`. El SessionProvider hizo signOut automáticamente; esta
 * pantalla explica por qué y ofrece un link al login para probar con
 * otra cuenta.
 *
 * Activada via SessionError.code = 'USUARIO_DESACTIVADO' desde
 * ProtectedRoute.
 */
export function UsuarioDesactivadoScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-sm shadow-sm">
        <h2 className="text-base font-semibold text-foreground">
          Tu usuario fue desactivado
        </h2>
        <p className="text-muted-foreground">
          El administrador del club desactivó tu acceso. Si pensás que es
          un error, contactalo para que te reactive.
        </p>
        <p className="text-muted-foreground">
          Mientras tanto, podés intentar con otra cuenta.
        </p>
        <div className="pt-2">
          <Button asChild className="w-full">
            <Link to="/login">Ir al login</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
