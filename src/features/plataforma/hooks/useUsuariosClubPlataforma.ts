import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Usuario } from '@/types/database';

export const USUARIOS_CLUB_PLATAFORMA_QUERY_KEY = 'usuarios_club_plataforma';

/**
 * Consulta la lista de todos los usuarios/administradores de un club específico
 * desde el rol de superadmin de plataforma.
 */
export function useUsuariosClubPlataforma(
  clubId: number | null,
): UseQueryResult<Usuario[], Error> {
  return useQuery<Usuario[], Error>({
    queryKey: [USUARIOS_CLUB_PLATAFORMA_QUERY_KEY, clubId],
    queryFn: async () => {
      if (!clubId) return [];
      
      // Intentar primero vía RPC dedicado fn_usuarios_club_plataforma
      const { data, error } = await supabase.rpc('fn_usuarios_club_plataforma', {
        p_club_id: clubId,
      });

      if (!error && data) {
        return data as Usuario[];
      }

      // Fallback: SELECT directo a tabla usuarios (respaldado por RLS de plataforma_admin)
      const { data: directData, error: directError } = await supabase
        .from('usuarios')
        .select('id, club_id, nombre, rol, activo, fecha_alta, email')
        .eq('club_id', clubId)
        .order('activo', { ascending: false })
        .order('fecha_alta', { ascending: true });

      if (directError) throw new Error(mapPostgrestError(directError));
      return (directData ?? []) as Usuario[];
    },
    enabled: !!clubId,
  });
}
