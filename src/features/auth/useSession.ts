import { createContext, useContext } from 'react';
import type { Club, PlataformaAdmin, Usuario } from '@/types/database';

/**
 * Estados de error que la sesión puede reportar a la UI.
 *
 * - NO_USUARIO_ROW: el usuario está autenticado en Supabase Auth pero
 *   no existe su fila en la tabla `usuarios` ni en `plataforma_admins`.
 *   Caso borde real (alguien se creó en Auth sin haber sido provisionado).
 * - FETCH_FAILED: error de red o de Postgres al traer el perfil.
 * - USUARIO_DESACTIVADO: el perfil existe pero `activo=false`. El
 *   admin del club lo desactivó (o un superadmin desactivó su
 *   plataforma_admin). SessionProvider hizo signOut.
 * - CLUB_SUSPENDIDO: el club del usuario está en estado 'suspendido'
 *   (la plataforma bloqueó el acceso temporalmente). El superadmin
 *   no es afectado — no tiene club. SessionProvider hizo signOut.
 * - CLUB_BAJA: el club del usuario está en estado 'baja' (baja
 *   definitiva — datos conservados pero sin acceso). SessionProvider
 *   hizo signOut.
 */
export type SessionError =
  | { code: 'NO_USUARIO_ROW' }
  | { code: 'FETCH_FAILED'; detail: string }
  | { code: 'USUARIO_DESACTIVADO' }
  | { code: 'CLUB_SUSPENDIDO' }
  | { code: 'CLUB_BAJA' };

export interface SessionValue {
  user: Usuario | null;
  club: Club | null;
  /**
   * Superadmin de la plataforma. NOT NULL solo si el usuario logueado
   * está en `plataforma_admins` (y activo). Agregado en la 0019.
   *
   * Cuando es NOT NULL, `user` y `club` son NULL — el superadmin
   * opera el panel de plataforma, no el SaaS del club. El SessionProvider
   * chequea `plataforma_admins` PRIMERO; si está ahí y activo, entra
   * por esta ruta sin importar que tenga fila en `usuarios`.
   */
  plataformaAdmin: PlataformaAdmin | null;
  /**
   * Códigos de los módulos que el plan del club tiene habilitados
   * (ej. ['reservas', 'buffet', 'gestion_usuarios']). Vacío para
   * superadmin (no opera módulos de club). Agregado en la 0019.
   * Para checks puntuales usar el hook `useModuloHabilitado(codigo)`
   * de `src/lib/modulos.ts`.
   */
  modulosHabilitados: string[];
  loading: boolean;
  error: SessionError | null;
  signOut: () => Promise<void>;
  /**
   * Mergea cambios en el objeto `club` en memoria — para mutations que
   * editan el club (ej. cambiar nombre o color de marca) y necesitan
   * que la UI vea el nuevo valor sin esperar un reload de sesión.
   * El `useEffect` de inyección de color en el SessionProvider está
   * suscripto al campo `color_primario_hsl`, así que si el patch lo
   * incluye, el `--primary` repinta automáticamente.
   */
  updateClub: (patch: Partial<Club>) => void;
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
