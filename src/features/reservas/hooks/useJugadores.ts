import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type {
  EstadisticasJugador,
  Jugador,
  JugadorConEstadisticas,
} from '@/types/database';

export const JUGADORES_QUERY_KEY_BASE = 'jugadores';

function jugadoresSearchKey(query: string) {
  return [JUGADORES_QUERY_KEY_BASE, 'search', query] as const;
}

/**
 * Búsqueda de jugadores para autocomplete. Usa ILIKE — el índice GIN
 * pg_trgm sobre `nombre` (migración 0004) lo acelera incluso para
 * patrones con `%algo%`.
 */
export function useJugadoresSearch(
  query: string,
): UseQueryResult<Jugador[], Error> {
  const trimmed = query.trim();
  const minQuery = trimmed.length >= 2;

  return useQuery<Jugador[], Error>({
    queryKey: jugadoresSearchKey(trimmed),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jugadores')
        .select('*')
        .eq('activo', true)
        .ilike('nombre', `%${trimmed}%`)
        .order('nombre', { ascending: true })
        .limit(10);
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Jugador[];
    },
    enabled: minQuery,
    staleTime: 5_000,
  });
}

export type JugadorInput = Omit<Jugador, 'id' | 'club_id' | 'fecha_alta'>;

export function useCreateJugador(): UseMutationResult<
  Jugador,
  Error,
  JugadorInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Jugador, Error, JugadorInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('jugadores')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Jugador;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [JUGADORES_QUERY_KEY_BASE] });
    },
  });
}

export const JUGADORES_LIST_QUERY_KEY = [
  JUGADORES_QUERY_KEY_BASE,
  'list',
] as const;

/**
 * Lista completa de jugadores enriquecida con métricas de actividad:
 * cantidad de veces que vino (visitas), gasto en turnos, gasto en buffet
 * y ranking dentro del club.
 */
export function useJugadores(): UseQueryResult<JugadorConEstadisticas[], Error> {
  const { club } = useSession();

  return useQuery<JugadorConEstadisticas[], Error>({
    queryKey: [...JUGADORES_LIST_QUERY_KEY, club?.id],
    queryFn: async () => {
      let query = supabase
        .from('jugadores')
        .select('*')
        .order('nombre', { ascending: true });

      if (club?.id) {
        query = query.eq('club_id', club.id);
      }

      const [jugadoresRes, statsRes] = await Promise.all([
        query,
        supabase.rpc('fn_estadisticas_jugadores'),
      ]);

      if (jugadoresRes.error) {
        throw new Error(mapPostgrestError(jugadoresRes.error));
      }

      const statsMap = new Map<number, EstadisticasJugador>();
      if (statsRes.data && Array.isArray(statsRes.data)) {
        for (const s of statsRes.data) {
          statsMap.set(Number(s.jugador_id), {
            jugador_id: Number(s.jugador_id),
            visitas: Number(s.visitas) || 0,
            gasto_turnos: Number(s.gasto_turnos) || 0,
            gasto_buffet: Number(s.gasto_buffet) || 0,
            gasto_total: Number(s.gasto_total) || 0,
            ultimo_partido: s.ultimo_partido ?? null,
          });
        }
      }

      const list: JugadorConEstadisticas[] = (jugadoresRes.data ?? []).map((j) => {
        const st = statsMap.get(j.id) ?? {
          jugador_id: j.id,
          visitas: 0,
          gasto_turnos: 0,
          gasto_buffet: 0,
          gasto_total: 0,
          ultimo_partido: null,
        };
        return {
          ...j,
          visitas: st.visitas,
          gasto_turnos: st.gasto_turnos,
          gasto_buffet: st.gasto_buffet,
          gasto_total: st.gasto_total,
          ultimo_partido: st.ultimo_partido,
          ranking: 0,
        };
      });

      // Ordenar por gasto_total DESC (y desempate por visitas) para asignar posición de ranking
      const ordenadosParaRank = [...list].sort(
        (a, b) => b.gasto_total - a.gasto_total || b.visitas - a.visitas,
      );
      ordenadosParaRank.forEach((item, index) => {
        item.ranking = index + 1;
      });

      return list;
    },
    staleTime: 10_000,
  });
}

interface UpdateJugadorArgs {
  id: number;
  changes: Partial<JugadorInput>;
}

export function useUpdateJugador(): UseMutationResult<
  Jugador,
  Error,
  UpdateJugadorArgs
> {
  const queryClient = useQueryClient();

  return useMutation<Jugador, Error, UpdateJugadorArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('jugadores')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Jugador;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [JUGADORES_QUERY_KEY_BASE] });
    },
  });
}

export function useDeleteJugador(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('jugadores').delete().eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [JUGADORES_QUERY_KEY_BASE] });
    },
  });
}

export function usePagarCuentaCorriente(): UseMutationResult<
  any,
  Error,
  { jugadorId: number; monto: number; medioPago: string; observaciones: string }
> {
  const queryClient = useQueryClient();

  return useMutation<
    any,
    Error,
    { jugadorId: number; monto: number; medioPago: string; observaciones: string }
  >({
    mutationFn: async ({ jugadorId, monto, medioPago, observaciones }) => {
      const { data, error } = await supabase.rpc('fn_pagar_cuenta_corriente', {
        p_jugador_id: jugadorId,
        p_monto: monto,
        p_medio_pago: medioPago,
        p_observaciones: observaciones.trim() === '' ? null : observaciones.trim(),
      });
      if (error) throw new Error(mapPostgrestError(error));
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [JUGADORES_QUERY_KEY_BASE] });
    },
  });
}
