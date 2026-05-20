import { createContext, useContext } from 'react';
import type { Club, Usuario } from '@/types/database';

/**
 * Estados de error que la sesión puede reportar a la UI.
 *
 * - NO_USUARIO_ROW: el usuario está autenticado en Supabase Auth pero
 *   no existe su fila en la tabla `usuarios`. Caso borde real (alguien
 *   se creó en Auth sin haber sido provisionado).
 * - FETCH_FAILED: error de red o de Postgres al traer el perfil.
 */
export type SessionError =
  | { code: 'NO_USUARIO_ROW' }
  | { code: 'FETCH_FAILED'; detail: string };

export interface SessionValue {
  user: Usuario | null;
  club: Club | null;
  loading: boolean;
  error: SessionError | null;
  signOut: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | undefined>(undefined);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error(
      'useSession() debe llamarse dentro de un <SessionProvider>. Revisá el árbol de providers en main.tsx.',
    );
  }
  return ctx;
}
