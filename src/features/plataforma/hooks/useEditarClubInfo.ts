import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Club } from '@/types/database';
import { CLUBES_PLATAFORMA_QUERY_KEY } from './useClubesPlataforma';

export interface EditarClubInfoInput {
  clubId: number;
  nombre: string;
  slug: string;
}

/**
 * Edita la información básica del club (nombre y slug) desde el panel
 * de plataforma. Invoca la RPC `fn_editar_club_info` con gate de superadmin.
 */
export function useEditarClubInfo(): UseMutationResult<
  Club,
  Error,
  EditarClubInfoInput
> {
  const queryClient = useQueryClient();

  return useMutation<Club, Error, EditarClubInfoInput>({
    mutationFn: async ({ clubId, nombre, slug }) => {
      const { data, error } = await supabase.rpc('fn_editar_club_info', {
        p_club_id: clubId,
        p_nombre: nombre,
        p_slug: slug,
      });

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La función respondió sin datos. Refrescá la lista de clubes.',
        );
      }
      return data as Club;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: CLUBES_PLATAFORMA_QUERY_KEY,
      });
    },
  });
}
