import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './useSession';
import { NoClubAssignedScreen } from './NoClubAssignedScreen';
import { SessionFetchErrorScreen } from './SessionFetchErrorScreen';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, error } = useSession();
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

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
