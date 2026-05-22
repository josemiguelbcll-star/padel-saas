import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '@/features/auth/useSession';
import { SessionFetchErrorScreen } from '@/features/auth/SessionFetchErrorScreen';
import { UsuarioDesactivadoScreen } from '@/features/auth/UsuarioDesactivadoScreen';
import { ClubBloqueadoScreen } from '@/features/auth/ClubBloqueadoScreen';

interface PlataformaProtectedRouteProps {
  children: ReactNode;
}

/**
 * Guard de las rutas del panel de plataforma (`/plataforma/...`).
 *
 * Reglas (definidas para evitar loops y rebotes):
 *   - Loading: pantalla de "Cargando…" (igual que ProtectedRoute del club).
 *   - Error FETCH_FAILED o USUARIO_DESACTIVADO: pantallas dedicadas.
 *   - Si `plataformaAdmin !== null` → entra (renderiza children).
 *   - Si NO es superadmin pero hay sesión de club (`user !== null`):
 *     redirect a `/` — su flujo normal lo lleva al SaaS del club. El
 *     ProtectedRoute del club lo deja entrar (no es superadmin, no
 *     re-redirige a /plataforma).
 *   - Sin sesión (ni user ni plataformaAdmin): redirect a `/login`.
 *
 * Verificación de no-loop:
 *   - Superadmin entra a `/`: ProtectedRoute (club) lo manda a `/plataforma`.
 *   - Llega a `/plataforma`: este guard lo deja entrar. ✓
 *   - Admin de club entra a `/plataforma`: este guard lo manda a `/`.
 *   - Llega a `/`: ProtectedRoute (club) lo deja entrar. ✓
 */
export function PlataformaProtectedRoute({
  children,
}: PlataformaProtectedRouteProps) {
  const { user, plataformaAdmin, loading, error } = useSession();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Cargando…
      </div>
    );
  }

  if (error?.code === 'FETCH_FAILED') {
    return <SessionFetchErrorScreen detail={error.detail} />;
  }

  if (error?.code === 'USUARIO_DESACTIVADO') {
    return <UsuarioDesactivadoScreen />;
  }

  // Defensa en capas: aunque un superadmin NUNCA debería tener
  // CLUB_SUSPENDIDO/CLUB_BAJA (no tiene club), si por algún bug se
  // setea, mostramos la pantalla correcta en vez de renderizar el
  // panel con datos inconsistentes.
  if (error?.code === 'CLUB_SUSPENDIDO' || error?.code === 'CLUB_BAJA') {
    return <ClubBloqueadoScreen motivo={error.code} />;
  }

  if (plataformaAdmin) {
    return <>{children}</>;
  }

  // No superadmin: si hay sesión de club, mandar a la app del club;
  // si no, al login.
  if (user) {
    return <Navigate to="/" replace />;
  }

  return <Navigate to="/login" replace />;
}
