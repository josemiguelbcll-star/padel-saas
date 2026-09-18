import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export type PlayerPhase = 'loading' | 'auth' | 'onboarding' | 'app';

export interface CompleteOnboardingData {
  nombre:   string;
  telefono: string;
}

export interface PlayerSessionContextValue {
  phase:               PlayerPhase;
  userId:              string | null;
  isClubAdmin:         boolean;
  clubNombre:          string | null;
  clubSlug:            string | null;
  completeOnboarding:  (data: CompleteOnboardingData) => Promise<void>;
  logout:              () => Promise<void>;
  login:               () => void;
}

const PlayerSessionContext = createContext<PlayerSessionContextValue | null>(null);

interface ResolvedSession {
  phase: 'onboarding' | 'app';
  isClubAdmin: boolean;
  clubNombre: string | null;
  clubSlug: string | null;
}

async function resolvePlayerSession(userId: string): Promise<ResolvedSession> {
  try {
    const [jugadorRes, usuarioRes] = await Promise.all([
      supabase
        .from('jugadores_app')
        .select('nombre_display')
        .eq('auth_user_id', userId)
        .maybeSingle(),
      supabase
        .from('usuarios')
        .select('nombre, rol, clubes(nombre, slug)')
        .eq('id', userId)
        .maybeSingle(),
    ]);

    const jugadorData = jugadorRes.data;
    const usuarioData = usuarioRes.data;

    const isClubAdmin = !!usuarioData;
    const clubInfo = (usuarioData?.clubes as unknown as { nombre?: string; slug?: string }) || null;
    const clubNombre = clubInfo?.nombre ?? null;
    const clubSlug = clubInfo?.slug ?? null;

    if (jugadorData?.nombre_display) {
      return { phase: 'app', isClubAdmin, clubNombre, clubSlug };
    }

    if (usuarioData) {
      // Es usuario de club pero todavía no tenía fila en jugadores_app.
      // Auto-creamos el perfil básico para que pueda usar la app de jugador sin onboarding forzado.
      const nombreAdmin = usuarioData.nombre || 'Administrador';
      const nombreCorto = nombreAdmin.split(' ')[0] ?? nombreAdmin;
      void supabase.from('jugadores_app').upsert(
        {
          auth_user_id: userId,
          nombre_display: nombreAdmin,
          nombre_corto: nombreCorto,
        },
        { onConflict: 'auth_user_id' }
      );
      return { phase: 'app', isClubAdmin: true, clubNombre, clubSlug };
    }

    return { phase: 'onboarding', isClubAdmin: false, clubNombre: null, clubSlug: null };
  } catch (err) {
    console.warn('[PlayerSessionProvider] resolvePlayerSession error, asumiendo app:', err);
    return { phase: 'app', isClubAdmin: false, clubNombre: null, clubSlug: null };
  }
}

export function PlayerSessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<PlayerPhase>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [isClubAdmin, setIsClubAdmin] = useState(false);
  const [clubNombre, setClubNombre] = useState<string | null>(null);
  const [clubSlug, setClubSlug] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // ── Fuente Única de Verdad: onAuthStateChange ────────────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        if (!session) {
          setUserId(null);
          setIsClubAdmin(false);
          setClubNombre(null);
          setClubSlug(null);
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
          setTimeout(() => {
            if (!mounted) return;
            resolvePlayerSession(session.user.id)
              .then((res) => {
                if (mounted) {
                  setPhase(res.phase);
                  setIsClubAdmin(res.isClubAdmin);
                  setClubNombre(res.clubNombre);
                  setClubSlug(res.clubSlug);
                }
              })
              .catch((err) => {
                console.warn('[PlayerSessionProvider] Error procesando sesión:', err);
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
    setIsClubAdmin(false);
    setClubNombre(null);
    setClubSlug(null);
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
    isClubAdmin,
    clubNombre,
    clubSlug,
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

