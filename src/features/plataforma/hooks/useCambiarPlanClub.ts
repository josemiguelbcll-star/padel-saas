import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Club } from '@/types/database';
import { CLUBES_PLATAFORMA_QUERY_KEY } from './useClubesPlataforma';

export interface CambiarPlanClubInput {
  clubId: number;
  planId: number;
}

/**
 * Asigna un plan al club desde el panel de plataforma. Invoca la RPC
 * `cambiar_plan_club` (0021) con gate `current_user_is_plataforma_admin()`
 * server-side — si el caller no es superadmin, P0001 "No autorizado.".
 *
 * Errores que el usuario puede ver (mapPostgrestError los pasa directo):
 *   - "No autorizado." (gate)
 *   - "Plan inválido o no activo."
 *   - "Club no encontrado."
 *
 * Al éxito invalida `CLUBES_PLATAFORMA_QUERY_KEY` para que la lista
 * del panel refresque el plan_codigo/plan_nombre del club.
 */
export function useCambiarPlanClub(): UseMutationResult<
  Club,
  Error,
  CambiarPlanClubInput
> {
  const queryClient = useQueryClient();

  return useMutation<Club, Error, CambiarPlanClubInput>({
    mutationFn: async ({ clubId, planId }) => {
      const { data, error } = await supabase.rpc('cambiar_plan_club', {
        p_club_id: clubId,
        p_plan_id: planId,
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
