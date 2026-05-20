import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ClaseCobro } from '@/types/database';

export const CLASE_COBROS_QUERY_KEY_BASE = 'clase_cobros';

/**
 * Cobros de clase registrados para una fecha puntual del día mostrado
 * en la grilla. Permite marcar visualmente cada bloque de clase como
 * "pagada" (tilde) o "impaga" sin que cada BloqueClase haga su propia
 * query — el padre indexa por clase_id y propaga.
 *
 * Volumen esperado por consulta: pocas filas (las clases que aplican
 * al día). RLS filtra por club automáticamente.
 */
export function useCobrosDelDia(
  fecha: string | null,
): UseQueryResult<ClaseCobro[], Error> {
  return useQuery<ClaseCobro[], Error>({
    queryKey: [CLASE_COBROS_QUERY_KEY_BASE, fecha],
    queryFn: async () => {
      if (fecha === null) return [];
      const { data, error } = await supabase
        .from('clase_cobros')
        .select('*')
        .eq('fecha', fecha)
        .order('fecha_hora', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ClaseCobro[];
    },
    enabled: fecha !== null,
  });
}
