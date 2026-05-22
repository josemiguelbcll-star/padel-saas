import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface ClubBloqueadoScreenProps {
  motivo: 'CLUB_SUSPENDIDO' | 'CLUB_BAJA';
}

/**
 * Pantalla que se muestra cuando el club del usuario está en estado
 * 'suspendido' o 'baja' (0019/0021). El SessionProvider hizo signOut
 * automáticamente; esta pantalla explica por qué y ofrece un link al
 * login para que pueda probar con otra cuenta.
 *
 * Activada via SessionError.code = 'CLUB_SUSPENDIDO' o 'CLUB_BAJA'
 * desde ProtectedRoute / PlataformaProtectedRoute / LoginPage.
 *
 * Diferencia semántica entre los dos motivos:
 *   - 'suspendido': temporal, reactivable por la plataforma.
 *   - 'baja': definitivo (datos conservados pero sin acceso).
 */
export function ClubBloqueadoScreen({ motivo }: ClubBloqueadoScreenProps) {
  const esSuspendido = motivo === 'CLUB_SUSPENDIDO';
  const titulo = esSuspendido
    ? 'Tu club fue suspendido'
    : 'Tu club fue dado de baja';
  const explicacion = esSuspendido
    ? 'La plataforma bloqueó temporalmente el acceso de tu club. Una vez que se resuelva la situación, el acceso se restablece automáticamente.'
    : 'Tu club fue dado de baja en la plataforma. Los datos se conservan, pero los usuarios del club ya no pueden operar.';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6 text-sm shadow-sm">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        <p className="text-muted-foreground">{explicacion}</p>
        <p className="text-muted-foreground">
          Si pensás que es un error, contactá a la plataforma. Mientras
          tanto, podés intentar con otra cuenta.
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
