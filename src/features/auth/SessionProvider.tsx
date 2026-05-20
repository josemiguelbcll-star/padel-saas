import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Club, Usuario } from '@/types/database';
import {
  SessionContext,
  type SessionError,
  type SessionValue,
} from './useSession';

interface SessionState {
  user: Usuario | null;
  club: Club | null;
  loading: boolean;
  error: SessionError | null;
}

const initialState: SessionState = {
  user: null,
  club: null,
  loading: true,
  error: null,
};

/**
 * Select que trae el usuario + su club en UNA sola query.
 *
 * PostgREST detecta la FK `usuarios.club_id -> clubes(id)` y embebe la fila
 * de `clubes` como objeto (relación many-to-one). Esto evita N+1 desde el
 * primer load. Si más adelante agregamos otra FK de `usuarios` hacia
 * `clubes`, vamos a tener que desambiguar con `clubes!club_id(...)`.
 */
const USUARIO_WITH_CLUB_SELECT =
  'id, club_id, nombre, rol, activo, fecha_alta, ' +
  'clubes(id, nombre, slug, direccion, ciudad, provincia, telefono, email, plan, activo, fecha_alta, config)';

type UsuarioConClub = Usuario & { clubes: Club };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);

  useEffect(() => {
    let mounted = true;

    async function load(session: Session | null): Promise<void> {
      if (!mounted) return;

      if (!session) {
        setState({ user: null, club: null, loading: false, error: null });
        return;
      }

      const { data, error } = await supabase
        .from('usuarios')
        .select(USUARIO_WITH_CLUB_SELECT)
        .eq('id', session.user.id)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setState({
          user: null,
          club: null,
          loading: false,
          error: { code: 'FETCH_FAILED', detail: error.message },
        });
        return;
      }

      if (!data) {
        // Caso borde: existe el auth.users pero falta la fila en `usuarios`.
        // No rompemos: dejamos el estado en error para que la UI muestre un
        // mensaje claro y un botón de logout.
        setState({
          user: null,
          club: null,
          loading: false,
          error: { code: 'NO_USUARIO_ROW' },
        });
        return;
      }

      // El cliente de supabase-js no tipa joins sin esquema generado.
      // `as unknown as X` es el patrón estándar de TS para shape externo
      // confiable; no estamos usando `any` (regla 5 del CLAUDE.md).
      const row = data as unknown as UsuarioConClub;
      const { clubes, ...usuario } = row;
      setState({
        user: usuario as Usuario,
        club: clubes,
        loading: false,
        error: null,
      });
    }

    void supabase.auth.getSession().then(({ data }) => {
      void load(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) => ({ ...prev, loading: true }));
      void load(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value: SessionValue = useMemo(
    () => ({ ...state, signOut }),
    [state, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
