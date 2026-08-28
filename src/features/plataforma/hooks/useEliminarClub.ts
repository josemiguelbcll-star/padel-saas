import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { CLUBES_PLATAFORMA_QUERY_KEY } from './useClubesPlataforma';

export interface EliminarClubInput {
  clubId: number;
}

/**
 * Elimina permanentemente un club y todos sus datos del sistema.
 * Invoca la RPC `fn_eliminar_club_plataforma` con gate de superadmin.
 */
export function useEliminarClub(): UseMutationResult<
  boolean,
  Error,
  EliminarClubInput
> {
  const queryClient = useQueryClient();

  return useMutation<boolean, Error, EliminarClubInput>({
    mutationFn: async ({ clubId }) => {
      const { data, error } = await supabase.rpc('fn_eliminar_club_plataforma', {
        p_club_id: clubId,
      });

      if (error) throw new Error(mapPostgrestError(error));
      return !!data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: CLUBES_PLATAFORMA_QUERY_KEY,
      });
    },
  });
}
