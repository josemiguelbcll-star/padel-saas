import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';
import { actividadDelDiaQueryKey } from './useActividadDelDia';

export function useDesbloquearTurnoFijo(): UseMutationResult<
  void,
  Error,
  { id: number; fecha: string }
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: number; fecha: string }>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.rpc('fn_desbloquear_turno_fijo', {
        p_reserva_id: id,
      });
      if (error) {
        throw new Error(mapPostgrestError(error));
      }
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, variables.fecha],
      });
      void queryClient.invalidateQueries({
        queryKey: actividadDelDiaQueryKey(variables.fecha),
      });
    },
  });
}
