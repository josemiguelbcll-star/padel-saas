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

/**
 * Select que trae el usuario + su club en UNA sola query.
 *
 * PostgREST detecta la FK `usuarios.club_id -> clubes(id)` y embebe la fila
 * de `clubes` como objeto (relación many-to-one). Esto evita N+1 desde el
 * primer load. Si más adelante agregamos otra FK de `usuarios` hacia
 * `clubes`, vamos a tener que desambiguar con `clubes!club_id(...)`.
 *
 * El embed de `clubes` incluye `plan_id` y `estado` desde la 0019 — el
 * SessionProvider los necesita para traer los módulos del plan y para
 * exponer `Club.estado` al frontend.
 */
const USUARIO_WITH_CLUB_SELECT =
  'id, club_id, nombre, rol, activo, fecha_alta, email, ' +
  'clubes(id, nombre, slug, direccion, ciudad, provincia, telefono, email, plan, activo, fecha_alta, config, ' +
  'hora_apertura, hora_cierre, duracion_turno_default, color_primario_hsl, logo_path, plan_id, estado, modalidad_caja, condicion_fiscal)';

type UsuarioConClub = Usuario & { clubes: Club };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(initialState);

  // Ref para preservar el motivo del signOut a través del re-load
  // que dispara `onAuthStateChange(session=null)`. Sin esto, el
  // branch `if (!session)` pisaría con error=null y se perdería el
  // motivo (la UI mostraría "sin sesión" sin explicar por qué).
  //
  // Casos cubiertos:
  //   - USUARIO_DESACTIVADO: el admin del club desactivó al usuario,
  //     o un superadmin desactivó su plataforma_admin (0018).
  //   - CLUB_SUSPENDIDO: la plataforma puso el club en estado
  //     'suspendido' (0019/0021).
  //   - CLUB_BAJA: la plataforma puso el club en estado 'baja'.
  const pendingErrorRef = useRef<SessionError | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load(session: Session | null): Promise<void> {
      if (!mounted) return;

      const isPlayerRoute = window.location.pathname.startsWith('/player') ||
                            window.location.pathname.startsWith('/club') ||
                            window.location.pathname === '/';

      if (isPlayerRoute) {
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
          // Si el logout vino de un motivo específico (usuario o
          // plataforma_admin desactivado, club suspendido o en baja),
          // levantamos el error preservado en el ref.
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

        // === 1. PLATAFORMA_ADMINS PRIMERO ===
        // Si el usuario está en plataforma_admins (y activo), entra como
        // superadmin SIN importar que también tenga fila en `usuarios`.
        // Caso real: el owner del SaaS también era admin del club Signo
        // Padel — tiene fila vieja en `usuarios` que no se puede borrar
        // por FKs (cobros/ventas), y fila nueva en `plataforma_admins`.
        // Acá decidimos que la nueva tiene precedencia.
        const { data: plataformaRow, error: plataformaError } = await supabase
          .from('plataforma_admins')
          .select('id, nombre, email, activo')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (plataformaError) {
          console.error(
            '[SessionProvider] error consultando plataforma_admins:',
            plataformaError,
          );
          setState({
            user: null,
            club: null,
            plataformaAdmin: null,
            modulosHabilitados: [],
            loading: false,
            error: { code: 'FETCH_FAILED', detail: plataformaError.message },
          });
          return;
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
          };
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
            plataformaAdmin: null,
            modulosHabilitados: [],
            loading: false,
            error: { code: 'FETCH_FAILED', detail: error.message },
          });
          return;
        }

        if (!data) {
          // Caso borde: auth.users existe pero ni `usuarios` ni
          // `plataforma_admins` tienen fila. Pantalla NO_USUARIO_ROW.
          setState({
            user: null,
            club: null,
            plataformaAdmin: null,
            modulosHabilitados: [],
            loading: false,
            error: { code: 'NO_USUARIO_ROW' },
          });
          return;
        }

        // Usuario desactivado por el admin del club (0018).
        if ((data as { activo?: boolean }).activo === false) {
          pendingErrorRef.current = { code: 'USUARIO_DESACTIVADO' };
          await supabase.auth.signOut();
          return;
        }

        // `as unknown as X` — el cliente de supabase-js no tipa joins sin
        // esquema generado. Patrón estándar de TS para shape externo
        // confiable; no estamos usando `any` (regla 5 del CLAUDE.md).
        const row = data as unknown as UsuarioConClub;
        const { clubes, ...usuario } = row;

        // Estado del club (0019/0021): si la plataforma puso el club en
        // 'suspendido' o 'baja', bloqueamos el acceso al próximo refresh.
        // El bloqueo NO es instantáneo — el JWT vivo sigue operando
        // hasta que expire (~1h) o se haga un load(). Aceptable según
        // spec; si emerge necesidad de hard-block inmediato, agregar
        // chequeo de `estado` dentro de los helpers RLS.
        //
        // El superadmin NO llega acá (su flujo retorna antes, en el
        // branch de plataforma_admins) — naturalmente no se ve afectado.
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
        // Dos queries separadas en lugar de un embed PostgREST (que
        // antes daba 400 — PostgREST no siempre detecta limpio la
        // relación plan_modulos.modulo_id → modulos cuando los nombres
        // singular/plural no son obvios). Si alguna falla, no bloquea
        // el login — modulosHabilitados queda vacío.
        //
        // En etapa 1 todos los clubes están en plan 'pro' por backfill
        // (0019) → trae los 9 módulos.
        let modulosHabilitados: string[] = [];

        const { data: pmRows, error: pmError } = await supabase
          .from('plan_modulos')
          .select('modulo_id')
          .eq('plan_id', clubes.plan_id);

        if (!mounted) return;

        if (pmError) {
          console.error(
            '[SessionProvider] error trayendo plan_modulos:',
            pmError,
          );
        } else if (pmRows && pmRows.length > 0) {
          const moduloIds = (pmRows as Array<{ modulo_id: number }>).map(
            (r) => r.modulo_id,
          );
          const { data: modRows, error: modError } = await supabase
            .from('modulos')
            .select('codigo')
            .in('id', moduloIds);

          if (!mounted) return;

          if (modError) {
            console.error(
              '[SessionProvider] error trayendo modulos:',
              modError,
            );
          } else {
            modulosHabilitados = (modRows as Array<{ codigo: string }> | null ?? [])
              .map((r) => r.codigo);
          }
        }

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

  const updateClub = useCallback((patch: Partial<Club>) => {
    setState((prev) => {
      if (!prev.club) return prev;
      return { ...prev, club: { ...prev.club, ...patch } };
    });
  }, []);

  // Marca del club (0016 — etapa 1): cuando el club se carga, aplicamos
  // su color al token CSS --primary (el --ring se propaga gratis vía
  // `var(--primary)` en globals.css). También lo cacheamos en
  // localStorage para que el bootstrap del próximo reload lo aplique
  // ANTES de que React monte (anti-flash — ver script inline en
  // index.html). El re-run al cambiar `color_primario_hsl` cubre el
  // caso de editar la marca en vivo desde la pantalla Marca.
  useEffect(() => {
    const hsl = state.club?.color_primario_hsl;
    if (!hsl) return;
    aplicarColorMarca(hsl);
    guardarColorMarcaEnCache(hsl);
  }, [state.club?.color_primario_hsl]);

  const value: SessionValue = useMemo(
    () => ({ ...state, signOut, updateClub }),
    [state, signOut, updateClub],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
