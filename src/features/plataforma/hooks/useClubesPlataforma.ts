import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { EstadoClub } from '@/types/database';

/**
 * Resumen de un club para el panel de plataforma (etapa 2). Lo
 * devuelve la RPC `clubes_resumen_plataforma` (migración 0020).
 *
 * `cantidad_usuarios` cuenta SOLO los usuarios activos del club —
 * conecta con el futuro límite de usuarios por plan.
 * `cantidad_canchas` cuenta todas las canchas del club.
 */
export interface ClubResumen {
  id: number;
  nombre: string;
  logo_path: string | null;
  estado: EstadoClub;
  plan_id: number;
  plan_codigo: string;
  plan_nombre: string;
  fecha_alta: string;
  cantidad_usuarios: number;
  cantidad_canchas: number;
}

export const CLUBES_PLATAFORMA_QUERY_KEY = ['clubes_plataforma'] as const;

/**
 * Lista de TODOS los clubes para el panel del superadmin.
 *
 * Invoca la RPC `clubes_resumen_plataforma` (0020), que tiene un gate
 * `current_user_is_plataforma_admin()` server-side: si el caller no
 * es superadmin activo, devuelve P0001 "No autorizado." (mapPostgrestError
 * lo pasa directo al banner de error).
 *
 * Sin paginación todavía. TODO para cuando emerja:
 *   - >200 clubes o lentitud notable: agregar parámetros LIMIT/OFFSET
 *     a la RPC y consumir con useInfiniteQuery, o agregar filtros
 *     server-side (por estado, plan, búsqueda por nombre) que es lo
 *     primero que probablemente se necesite.
 *
 * Orden: alfabético por nombre del club (definido en la RPC con
 * ORDER BY c.nombre ASC).
 */
export function useClubesPlataforma(): UseQueryResult<ClubResumen[], Error> {
  return useQuery<ClubResumen[], Error>({
    queryKey: CLUBES_PLATAFORMA_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('clubes_resumen_plataforma');
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ClubResumen[];
    },
  });
}
