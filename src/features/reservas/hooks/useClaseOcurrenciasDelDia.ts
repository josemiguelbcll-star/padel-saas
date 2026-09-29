import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth/useSession';
import type { ClaseOcurrencia } from './useClaseOcurrencia';

export const CLASE_OCURRENCIAS_DEL_DIA_QUERY_KEY = 'clase_ocurrencias_del_dia';

export function useClaseOcurrenciasDelDia(fecha: string) {
  const { club } = useSession();

  return useQuery<ClaseOcurrencia[], Error>({
    queryKey: [CLASE_OCURRENCIAS_DEL_DIA_QUERY_KEY, fecha, club?.id],
    queryFn: async () => {
      let query = supabase
        .from('clase_ocurrencias')
        .select('*')
        .eq('fecha', fecha);

      if (club?.id) {
        query = query.eq('club_id', club.id);
      }

      const { data, error } = await query;
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ClaseOcurrencia[];
    },
    enabled: !!fecha,
  });
}
