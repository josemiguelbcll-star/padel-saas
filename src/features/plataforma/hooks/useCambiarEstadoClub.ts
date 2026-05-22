import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Club, EstadoClub } from '@/types/database';
import { CLUBES_PLATAFORMA_QUERY_KEY } from './useClubesPlataforma';

export interface CambiarEstadoClubInput {
  clubId: number;
  estado: EstadoClub;
}

/**
 * Cambia el estado del club desde el panel de plataforma. Invoca la
 * RPC `cambiar_estado_club` (0021) con gate de superadmin.
 *
 * IMPACTO de los estados (recordatorio):
 *   - 'trial', 'activo': el club opera normal.
 *   - 'suspendido', 'baja': el SessionProvider bloquea el acceso de
 *     los usuarios del club al próximo refresh (vía error codes
 *     CLUB_SUSPENDIDO / CLUB_BAJA + ClubBloqueadoScreen — bloque 2).
 *
 * Errores que el usuario puede ver:
 *   - "No autorizado." (gate)
 *   - "Estado inválido."
 *   - "Club no encontrado."
 *
 * Al éxito invalida `CLUBES_PLATAFORMA_QUERY_KEY` para refrescar la
 * lista con el badge de estado actualizado.
 */
export function useCambiarEstadoClub(): UseMutationResult<
  Club,
  Error,
  CambiarEstadoClubInput
> {
  const queryClient = useQueryClient();

  return useMutation<Club, Error, CambiarEstadoClubInput>({
    mutationFn: async ({ clubId, estado }) => {
      const { data, error } = await supabase.rpc('cambiar_estado_club', {
        p_club_id: clubId,
        p_estado: estado,
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
