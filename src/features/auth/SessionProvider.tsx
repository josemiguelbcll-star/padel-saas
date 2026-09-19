import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  aplicarColorMarca,
  guardarColorMarcaEnCache,
} from '@/lib/clubBrand';
import type { Club, PlataformaAdmin, Usuario } from '@/types/database';
import {
  SessionContext,
  type SessionError,
  type SessionValue,
} from './useSession';

interface SessionState {
  user: Usuario | null;
  club: Club | null;
  plataformaAdmin: PlataformaAdmin | null;
  modulosHabilitados: string[];
  loading: boolean;
  error: SessionError | null;
}

const initialState: SessionState = {
  user: null,
  club: null,
  plataformaAdmin: null,
  modulosHabilitados: [],
  loading: true,
  error: null,
};

const USUARIO_WITH_CLUB_SELECT =
  'id, club_id, nombre, rol, activo, fecha_alta, email, permisos, ' +
  'clubes(id, nombre, slug, direccion, ciudad, provincia, telefono, email, plan, activo, fecha_alta, config, ' +
  'hora_apertura, hora_cierre, duracion_turno_default, color_primario_hsl, logo_path, plan_id, estado, modalidad_caja, condicion_fiscal)';

const CLUB_DETAIL_SELECT =
  'id, nombre, slug, direccion, ciudad, provincia, telefono, email, plan, activo, fecha_alta, config, ' +
  'hora_apertura, hora_cierre, duracion_turno_default, color_primario_hsl, logo_path, plan_id, estado, modalidad_caja, condicion_fiscal';

type UsuarioConClub = Usuario & { clubes: Club };

async function fetchModulosDePlan(planId: number): Promise<string[]> {
  try {
    const { data: pmRows, error: pmError } = await supabase
      .from('plan_modulos')
      .select('modulo_id')
      .eq('plan_id', planId);

    if (pmError || !pmRows || pmRows.length === 0) return [];

    const moduloIds = (pmRows as Array<{ modulo_id: number }>).map((r) => r.modulo_id);
    const { data: modRows, error: modError } = await supabase
      .from('modulos')
      .select('codigo')
      .in('id', moduloIds);

    if (modError || !modRows) return [];
    return (modRows as Array<{ codigo: string }>).map((r) => r.codigo);
  } catch (err) {
    console.error('[SessionProvider] Error cargando módulos del plan:', err);
    return [];
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);

  // Ref para preservar el motivo del signOut a través del re-load
  const pendingErrorRef = useRef<SessionError | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load(session: Session | null): Promise<void> {
      if (!mounted) return;

      const isPlayerOrResetRoute =
        window.location.pathname.startsWith('/player') ||
        window.location.pathname.startsWith('/club') ||
        window.location.pathname === '/reset-password';

      if (isPlayerOrResetRoute) {
        setState({
          user: null,
          club: null,
          plataformaAdmin: null,
          modulosHabilitados: [],
          loading: false,
          error: null,
        });
        return;
      }

      try {
        if (!session) {
          const pendingError = pendingErrorRef.current;
          pendingErrorRef.current = null;
          setState({
            user: null,
            club: null,
            plataformaAdmin: null,
            modulosHabilitados: [],
            loading: false,
            error: pendingError,
          });
          return;
        }

        // === 1. PLATAFORMA_ADMINS Y USUARIOS EN PARALELO ===
        const [plataformaRes, usuarioRes] = await Promise.all([
          supabase
            .from('plataforma_admins')
            .select('id, nombre, email, activo')
            .eq('id', session.user.id)
            .maybeSingle(),
          supabase
            .from('usuarios')
            .select(USUARIO_WITH_CLUB_SELECT)
            .eq('id', session.user.id)
            .maybeSingle()
        ]);

        if (!mounted) return;

        const { data: plataformaRow, error: plataformaError } = plataformaRes;
        const { data, error } = usuarioRes;

        if (plataformaError) {
          console.warn(
            '[SessionProvider] aviso consultando plataforma_admins (no crítico):',
            plataformaError,
          );
        }

        if (plataformaRow) {
          // Superadmin desactivado → mismo flujo que usuario desactivado.
          if ((plataformaRow as { activo: boolean }).activo === false) {
            pendingErrorRef.current = { code: 'USUARIO_DESACTIVADO' };
            await supabase.auth.signOut();
            return;
          }

          const pa = plataformaRow as {
            id: string;
            nombre: string;
            email: string;
            impersonated_club_id?: number | null;
          };

          // Chequear si hay un club impersonado en sessionStorage o DB
          const storedClubId = sessionStorage.getItem('impersonated_club_id');
          const impersonatedId = storedClubId
            ? Number(storedClubId)
            : pa.impersonated_club_id ?? null;

          if (impersonatedId && !isNaN(impersonatedId)) {
            try {
              await supabase.rpc('fn_impersonar_club_plataforma', {
                p_club_id: impersonatedId,
              });
            } catch (_) {
              // RPC opcional si la migración aún no corrió
            }

            const { data: impClub } = await supabase
              .from('clubes')
              .select(CLUB_DETAIL_SELECT)
              .eq('id', impersonatedId)
              .maybeSingle();

            if (impClub && mounted) {
              const clubObj = impClub as unknown as Club;
              const modulos = await fetchModulosDePlan(clubObj.plan_id);

              const virtualUser: Usuario = {
                id: pa.id,
                club_id: clubObj.id,
                nombre: `${pa.nombre} (Superadmin)`,
                email: pa.email,
                rol: 'admin',
                activo: true,
                fecha_alta: new Date().toISOString(),
                permisos: {},
              };

              setState({
                user: virtualUser,
                club: clubObj,
                plataformaAdmin: { id: pa.id, nombre: pa.nombre, email: pa.email },
                modulosHabilitados: modulos,
                loading: false,
                error: null,
              });
              return;
            }
          }

          setState({
            user: null,
            club: null,
            plataformaAdmin: { id: pa.id, nombre: pa.nombre, email: pa.email },
            modulosHabilitados: [],
            loading: false,
            error: null,
          });
          return;
        }

        // === 2. FLUJO NORMAL — usuarios (admin/vendedor de club) ===
        if (error) {
          setState({
            user: null,
            club: null,
            plataformaAdmin: null,
            modulosHabilitados: [],
            loading: false,
            error: { code: 'FETCH_FAILED', detail: error.message },
          });
          return;
        }

        if (!data) {
          const { data: jugadorRow } = await supabase
            .from('jugadores_app')
            .select('nombre_display, nombre_corto')
            .eq('auth_user_id', session.user.id)
            .maybeSingle();

          const jugadorNombre =
            jugadorRow?.nombre_display ||
            jugadorRow?.nombre_corto ||
            session.user.user_metadata?.nombre ||
            session.user.user_metadata?.full_name ||
            session.user.email?.split('@')[0] ||
            '';

          setState({
            user: null,
            club: null,
            plataformaAdmin: null,
            modulosHabilitados: [],
            loading: false,
            error: {
              code: 'ES_JUGADOR',
              email: session.user.email ?? '',
              nombre: jugadorNombre,
            },
          });
          return;
        }

        if ((data as { activo?: boolean }).activo === false) {
          pendingErrorRef.current = { code: 'USUARIO_DESACTIVADO' };
          await supabase.auth.signOut();
          return;
        }

        const row = data as unknown as UsuarioConClub;
        const { clubes, ...usuario } = row;

        if (clubes.estado === 'suspendido') {
          pendingErrorRef.current = { code: 'CLUB_SUSPENDIDO' };
          await supabase.auth.signOut();
          return;
        }
        if (clubes.estado === 'baja') {
          pendingErrorRef.current = { code: 'CLUB_BAJA' };
          await supabase.auth.signOut();
          return;
        }

        // === 3. Módulos del plan del club ===
        const modulosHabilitados = await fetchModulosDePlan(clubes.plan_id);

        if (!mounted) return;

        setState({
          user: usuario as Usuario,
          club: clubes,
          plataformaAdmin: null,
          modulosHabilitados,
          loading: false,
          error: null,
        });
      } catch (err: unknown) {
        console.error('[SessionProvider] Error loading session:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setState({
          user: null,
          club: null,
          plataformaAdmin: null,
          modulosHabilitados: [],
          loading: false,
          error: { code: 'FETCH_FAILED', detail: errMsg },
        });
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setState({
          user: null,
          club: null,
          plataformaAdmin: null,
          modulosHabilitados: [],
          loading: false,
          error: null,
        });
        return;
      }
      if (event === 'INITIAL_SESSION' && !session) {
        setState({
          user: null,
          club: null,
          plataformaAdmin: null,
          modulosHabilitados: [],
          loading: false,
          error: null,
        });
        return;
      }
      setState((prev) => ({ ...prev, loading: true }));
      void load(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    sessionStorage.removeItem('impersonated_club_id');
    await supabase.auth.signOut();
  }, []);

  const updateClub = useCallback((patch: Partial<Club>) => {
    setState((prev) => {
      if (!prev.club) return prev;
      return { ...prev, club: { ...prev.club, ...patch } };
    });
  }, []);

  const impersonateClub = useCallback(
    async (clubId: number) => {
      if (!state.plataformaAdmin) return;
      sessionStorage.setItem('impersonated_club_id', String(clubId));

      try {
        await supabase.rpc('fn_impersonar_club_plataforma', { p_club_id: clubId });
      } catch (err) {
        console.warn('[SessionProvider] Error en RPC fn_impersonar_club_plataforma:', err);
      }

      const { data: impClub, error: clubErr } = await supabase
        .from('clubes')
        .select(CLUB_DETAIL_SELECT)
        .eq('id', clubId)
        .maybeSingle();

      if (clubErr || !impClub) {
        throw new Error('No se pudo cargar la información del club.');
      }

      const clubObj = impClub as unknown as Club;
      const modulos = await fetchModulosDePlan(clubObj.plan_id);

      const virtualUser: Usuario = {
        id: state.plataformaAdmin.id,
        club_id: clubObj.id,
        nombre: `${state.plataformaAdmin.nombre} (Superadmin)`,
        email: state.plataformaAdmin.email,
        rol: 'admin',
        activo: true,
        fecha_alta: new Date().toISOString(),
        permisos: {},
      };

      setState((prev) => ({
        ...prev,
        user: virtualUser,
        club: clubObj,
        modulosHabilitados: modulos,
      }));
    },
    [state.plataformaAdmin],
  );

  const stopImpersonating = useCallback(async () => {
    sessionStorage.removeItem('impersonated_club_id');
    try {
      await supabase.rpc('fn_dejar_de_impersonar_plataforma');
    } catch (err) {
      console.warn('[SessionProvider] Error en RPC fn_dejar_de_impersonar_plataforma:', err);
    }

    setState((prev) => ({
      ...prev,
      user: null,
      club: null,
      modulosHabilitados: [],
    }));
  }, []);

  useEffect(() => {
    const hsl = state.club?.color_primario_hsl;
    if (!hsl) return;
    aplicarColorMarca(hsl);
    guardarColorMarcaEnCache(hsl);
  }, [state.club?.color_primario_hsl]);

  const isImpersonating = !!(state.plataformaAdmin && state.club);

  const value: SessionValue = useMemo(
    () => ({
      ...state,
      isImpersonating,
      signOut,
      updateClub,
      impersonateClub,
      stopImpersonating,
    }),
    [state, isImpersonating, signOut, updateClub, impersonateClub, stopImpersonating],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
