import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth/useSession';
import type { Usuario } from '@/types/database';

export const USUARIOS_CLUB_QUERY_KEY_BASE = 'usuarios_club';

/**
 * Lista de todos los usuarios del club actual. RLS filtra solos los
 * del propio club. Orden: activos primero, después por fecha_alta
 * ascendente (los más viejos primero, naturalmente — el primer admin
 * de un club arriba de todo).
 *
 * No hace falta admin: cualquier usuario del club puede ver la lista
 * (la policy `usuarios_select` de 0001/0002 permite SELECT a todos
 * los del club). Lo que SÍ es admin-only es editar/crear — la UI lo
 * desabilita para vendedores.
 */
export function useUsuariosClub(): UseQueryResult<Usuario[], Error> {
  const { club } = useSession();

  return useQuery<Usuario[], Error>({
    queryKey: [USUARIOS_CLUB_QUERY_KEY_BASE, club?.id],
    queryFn: async () => {
      if (!club) {
        throw new Error('No pudimos identificar tu club.');
      }
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, club_id, nombre, rol, activo, fecha_alta, email')
        .order('activo', { ascending: false })
        .order('fecha_alta', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Usuario[];
    },
    enabled: !!club,
  });
}
