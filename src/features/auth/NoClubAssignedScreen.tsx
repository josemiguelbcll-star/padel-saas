import { Button } from '@/components/ui/button';
import { useSession } from './useSession';

/**
 * Pantalla que se muestra cuando el usuario está autenticado en Supabase
 * Auth pero no tiene fila correspondiente en la tabla `usuarios` (y por
 * lo tanto no está asociado a ningún club). El admin debe provisionar
 * el registro antes de que el usuario pueda operar.
 */
export function NoClubAssignedScreen() {
  const { signOut } = useSession();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">
          Tu usuario no está asociado a ningún club
        </h1>
        <p className="text-sm text-muted-foreground">
          La autenticación funcionó, pero no encontramos tu perfil en la base
          de datos del club. Esto suele pasar cuando el administrador todavía
          no terminó de darte de alta.
        </p>
        <p className="text-sm text-muted-foreground">
          Contactá al administrador del club para que asocie tu cuenta y
          volvé a iniciar sesión.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void signOut();
          }}
          className="w-full"
        >
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
