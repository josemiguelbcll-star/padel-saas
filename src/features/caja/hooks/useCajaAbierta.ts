import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { TurnoCaja } from '@/types/database';

export const CAJA_ABIERTA_QUERY_KEY = ['caja', 'abierta'] as const;

/**
 * Trae la caja abierta del club para el usuario actual, o `null` si no
 * hay caja abierta.
 *
 * Usa el helper SQL `current_club_caja_abierta()` (0022), que resuelve
 * la caja según la modalidad del club:
 *   - 'por_dia': la única caja abierta del club.
 *   - 'por_vendedor': la caja abierta del vendedor logueado.
 *
 * Si retorna un id, fetcheamos la fila completa de `turnos_caja`. Dos
 * round-trips, pero la API queda simple y la modalidad la maneja el
 * server (no hace falta lógica condicional client-side).
 */
export function useCajaAbierta(): UseQueryResult<TurnoCaja | null, Error> {
  return useQuery<TurnoCaja | null, Error>({
    queryKey: CAJA_ABIERTA_QUERY_KEY,
    queryFn: async () => {
      const { data: cajaId, error: rpcError } = await supabase.rpc(
        'current_club_caja_abierta',
      );
      if (rpcError) throw new Error(mapPostgrestError(rpcError));
      if (cajaId === null || cajaId === undefined) return null;

      const { data, error } = await supabase
        .from('turnos_caja')
        .select('*')
        .eq('id', cajaId as number)
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as TurnoCaja;
    },
  });
}
