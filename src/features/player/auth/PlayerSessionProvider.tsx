import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/network';

export type PlayerPhase = 'loading' | 'auth' | 'onboarding' | 'app';

export interface CompleteOnboardingData {
  nombre:   string;
  telefono: string;
}

export interface PlayerSessionContextValue {
  phase:               PlayerPhase;
  userId:              string | null;
  completeOnboarding:  (data: CompleteOnboardingData) => Promise<void>;
  logout:              () => Promise<void>;
  login:               () => void;
}

const PlayerSessionContext = createContext<PlayerSessionContextValue | null>(null);

async function fetchPlayerPhase(userId: string): Promise<'onboarding' | 'app'> {
  try {
    const promise = supabase
      .from('jugadores_app')
      .select('nombre_display')
      .eq('auth_user_id', userId)
      .maybeSingle();

    const { data } = await (withTimeout(promise as any, 5000, 'fetchPlayerPhase:jugadores_app') as any);
    return data?.nombre_display ? 'app' : 'onboarding';
  } catch (err) {
    console.warn('[PlayerSessionProvider] fetchPlayerPhase timeout o error, asumiendo app:', err);
    return 'app';
  }
}

export function PlayerSessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<PlayerPhase>('loading');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // ── Fuente Única de Verdad: onAuthStateChange ────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        if (!session) {
          setUserId(null);
          setPhase('auth');
          return;
        }

        setUserId(session.user.id);

        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED'
        ) {
          // Desacoplar de la pila síncrona de _notifyAllSubscribers para que
          // Supabase JS SDK complete _recoverAndRefresh sin producir deadlock en PostgREST.
          setTimeout(() => {
            if (!mounted) return;
            fetchPlayerPhase(session.user.id)
              .then((nextPhase) => {
                if (mounted) setPhase(nextPhase);
              })
              .catch((err) => {
                console.warn('[PlayerSessionProvider] Error procesando fase, manteniendo app:', err);
                if (mounted) setPhase('app');
              });
          }, 0);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const completeOnboarding = async ({ nombre, telefono }: CompleteOnboardingData) => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('Sin sesión activa');

    const nombreCorto = nombre.trim().split(' ')[0] ?? nombre.trim();

    const { error } = await supabase.from('jugadores_app').upsert(
      {
        auth_user_id:   user.id,
        nombre_display: nombre.trim(),
        nombre_corto:   nombreCorto,
        telefono:       telefono.trim() || null,
      },
      { onConflict: 'auth_user_id' },
    );

    if (error) {
      console.error('[PlayerSessionProvider] completeOnboarding falló:', error.message, error);
      throw new Error('No se pudo guardar tu perfil. Verificá tu conexión e intentá de nuevo.');
    }

    setPhase('app');
  };

  const logout = async () => {
    setUserId(null);
    setPhase('auth');
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[PlayerSessionProvider] Error signing out:', err);
    }
  };

  const value: PlayerSessionContextValue = {
    phase,
    userId,
    completeOnboarding,
    logout,
    login: () => { /* no-op */ },
  };

  return (
    <PlayerSessionContext.Provider value={value}>
      {children}
    </PlayerSessionContext.Provider>
  );
}

export function usePlayerSession(): PlayerSessionContextValue {
  const ctx = useContext(PlayerSessionContext);
  if (!ctx) {
    throw new Error('usePlayerSession debe usarse dentro de un <PlayerSessionProvider>');
  }
  return ctx;
}
