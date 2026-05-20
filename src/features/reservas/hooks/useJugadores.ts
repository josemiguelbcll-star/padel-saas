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
import type { Jugador } from '@/types/database';

export const JUGADORES_QUERY_KEY_BASE = 'jugadores';

function jugadoresSearchKey(query: string) {
  return [JUGADORES_QUERY_KEY_BASE, 'search', query] as const;
}

/**
 * Búsqueda de jugadores para autocomplete. Usa ILIKE — el índice GIN
 * pg_trgm sobre `nombre` (migración 0004) lo acelera incluso para
 * patrones con `%algo%`.
 *
 * - Si la query está vacía o muy corta (<2 caracteres) devolvemos []
 *   sin tocar la red: el autocomplete no muestra nada hasta que el
 *   usuario escriba algo.
 * - Sólo trae jugadores activos. Limit 10 (suficiente para el dropdown).
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
    // Tiempo de cache corto: mientras el usuario escribe disparamos
    // muchas búsquedas y queremos resultados frescos tras crear nuevos.
    staleTime: 5_000,
  });
}

/**
 * Campos que el frontend envía al crear un jugador desde el modal de
 * reserva. Sólo nombre es obligatorio en la DB; el resto se enriquece
 * después desde una eventual pantalla de Jugadores (no en sprint 3a).
 */
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
      // Invalida todas las búsquedas para que el jugador nuevo aparezca
      // inmediatamente en cualquier autocomplete abierto.
      void queryClient.invalidateQueries({ queryKey: [JUGADORES_QUERY_KEY_BASE] });
    },
  });
}
