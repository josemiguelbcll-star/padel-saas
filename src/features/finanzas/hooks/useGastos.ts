import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Gasto } from '@/types/database';

export const GASTOS_QUERY_KEY = ['gastos'] as const;

/**
 * Lista de gastos del club ordenada por `fecha_gasto DESC` (más
 * recientes arriba). Por ahora trae todos los activos; cuando emerja
 * volumen, agregamos paginación o filtros server-side.
 *
 * Los snapshots (categoria_nombre, unidad_nombre, unidad_tipo) ya
 * vienen en la fila — no hace falta JOIN con catálogo para mostrar.
 */
export function useGastos(): UseQueryResult<Gasto[], Error> {
  return useQuery<Gasto[], Error>({
    queryKey: GASTOS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gastos')
        .select('*')
        .eq('activo', true)
        .order('fecha_gasto', { ascending: false })
        .order('id', { ascending: false })
        .limit(500);
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Gasto[];
    },
  });
}
