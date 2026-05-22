import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './useSession';
import { NoClubAssignedScreen } from './NoClubAssignedScreen';
import { SessionFetchErrorScreen } from './SessionFetchErrorScreen';
import { UsuarioDesactivadoScreen } from './UsuarioDesactivadoScreen';
import { ClubBloqueadoScreen } from './ClubBloqueadoScreen';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, plataformaAdmin, loading, error } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  if (error?.code === 'NO_USUARIO_ROW') {
    return <NoClubAssignedScreen />;
  }

  if (error?.code === 'FETCH_FAILED') {
    return <SessionFetchErrorScreen detail={error.detail} />;
  }

  if (error?.code === 'USUARIO_DESACTIVADO') {
    return <UsuarioDesactivadoScreen />;
  }

  if (error?.code === 'CLUB_SUSPENDIDO' || error?.code === 'CLUB_BAJA') {
    return <ClubBloqueadoScreen motivo={error.code} />;
  }

  // Superadmin de la plataforma (0019). NO tiene acceso al SaaS del
  // club (Reservas, Buffet, etc.) — su destino es el panel de
  // plataforma. Si ya está navegando dentro de /plataforma, no
  // redirigimos (evita loop); cualquier otra ruta lo manda allá.
  if (plataformaAdmin) {
    if (location.pathname.startsWith('/plataforma')) {
      return <>{children}</>;
    }
    return <Navigate to="/plataforma" replace />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
