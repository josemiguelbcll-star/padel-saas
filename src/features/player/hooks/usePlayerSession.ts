/**
 * usePlayerSession — maneja el ciclo de vida de auth del jugador B2C.
 *
 * Fases:
 *   loading    → verificando sesión con Supabase
 *   auth       → sin sesión activa → mostrar PlayerLoginPage
 *   onboarding → sesión activa pero sin perfil completo → mostrar PlayerOnboarding
 *   app        → sesión + perfil → mostrar la app
 *
 * La transición auth→onboarding|app la gatilla onAuthStateChange automáticamente.
 * La transición onboarding→app la gatilla completeOnboarding() después de guardar.
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export type PlayerPhase = 'loading' | 'auth' | 'onboarding' | 'app';

export interface CompleteOnboardingData {
  nombre:   string;
  telefono: string;
}

export interface PlayerSessionState {
  phase:               PlayerPhase;
  completeOnboarding:  (data: CompleteOnboardingData) => Promise<void>;
  logout:              () => Promise<void>;
  /** @deprecated — solo para compatibilidad con PlayerLoginPage mock; no usarlo */
  login:               () => void;
}

async function fetchPhase(userId: string): Promise<'onboarding' | 'app'> {
  const { data } = await supabase
    .from('jugadores_app')
    .select('nombre_display')
    .eq('auth_user_id', userId)
    .maybeSingle();

  return data?.nombre_display ? 'app' : 'onboarding';
}

export function usePlayerSession(): PlayerSessionState {
  const [phase, setPhase] = useState<PlayerPhase>('loading');

  useEffect(() => {
    // ── Verificar sesión inicial ────────────────────────────────────────────
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setPhase('auth'); return; }
      setPhase(await fetchPhase(session.user.id));
    });

    // ── Escuchar cambios de auth (login, logout, OAuth callback, refresh) ──
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session) { setPhase('auth'); return; }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          setPhase(await fetchPhase(session.user.id));
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── completeOnboarding: guarda el perfil mínimo y avanza ─────────────────
  const completeOnboarding = async ({ nombre, telefono }: CompleteOnboardingData) => {
    const { data: { user } } = await supabase.auth.getUser();
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
      console.error('[completeOnboarding] upsert falló:', error.message, error);
      throw new Error('No se pudo guardar tu perfil. Verificá tu conexión e intentá de nuevo.');
    }

    setPhase('app');
  };

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    await supabase.auth.signOut();
    // onAuthStateChange detecta el SIGNED_OUT y setea 'auth'
  };

  return {
    phase,
    completeOnboarding,
    logout,
    login: () => { /* no-op: la transición la maneja onAuthStateChange */ },
  };
}
