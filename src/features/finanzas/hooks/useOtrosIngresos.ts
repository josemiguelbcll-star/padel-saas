import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { OtroIngreso } from '@/types/database';

export const OTROS_INGRESOS_QUERY_KEY = ['otros_ingresos'] as const;

/**
 * Lista de otros ingresos del club (auspicios, membresías, etc.).
 * Ordenados por `fecha DESC` (más recientes arriba). Solo activos.
 */
export function useOtrosIngresos(): UseQueryResult<OtroIngreso[], Error> {
  return useQuery<OtroIngreso[], Error>({
    queryKey: OTROS_INGRESOS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('otros_ingresos')
        .select('*')
        .eq('activo', true)
        .order('fecha', { ascending: false })
        .order('id', { ascending: false })
        .limit(500);
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as OtroIngreso[];
    },
  });
}
