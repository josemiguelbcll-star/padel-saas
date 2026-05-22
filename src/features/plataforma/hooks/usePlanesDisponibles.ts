import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Plan } from '@/types/database';

export const PLANES_DISPONIBLES_QUERY_KEY = ['planes', 'disponibles'] as const;

/**
 * Lista de planes activos para el selector del panel de plataforma.
 *
 * Filtra `activo = TRUE` para que el superadmin no pueda asignar
 * planes deprecados (la RPC `cambiar_plan_club` también lo valida
 * server-side — defense in depth).
 *
 * Orden: por el campo `orden` ascendente (basico → intermedio → pro
 * según el seed de la 0019).
 *
 * RLS: SELECT abierto a `authenticated` (0019) — cualquier sesión
 * puede leer. La sensibilidad del catálogo no está en la lectura
 * sino en la escritura (que sigue cerrada).
 */
export function usePlanesDisponibles(): UseQueryResult<Plan[], Error> {
  return useQuery<Plan[], Error>({
    queryKey: PLANES_DISPONIBLES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('planes')
        .select(
          'id, codigo, nombre, descripcion, precio_mensual, orden, activo',
        )
        .eq('activo', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Plan[];
    },
  });
}
