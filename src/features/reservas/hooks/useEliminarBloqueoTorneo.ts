import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { reservasDelDiaQueryKey } from './useReservasDelDia';
import { actividadDelDiaQueryKey } from './useActividadDelDia';
import { TURNOS_ABIERTOS_VIEJOS_QUERY_KEY } from './useTurnosAbiertosViejos';

export interface EliminarBloqueoTorneoInput {
  fecha: string;
  nombre_torneo: string;
}

/**
 * Hook de react-query para eliminar todos los bloqueos de un torneo en una fecha específica.
 */
export function useEliminarBloqueoTorneo(): UseMutationResult<
  void,
  Error,
  EliminarBloqueoTorneoInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, EliminarBloqueoTorneoInput>({
    mutationFn: async ({ fecha, nombre_torneo }) => {
      const { error } = await supabase.rpc('fn_eliminar_bloqueo_torneo', {
        p_fecha: fecha,
        p_nombre_torneo: nombre_torneo.trim(),
      });

      if (error) {
        throw new Error(mapPostgrestError(error));
      }
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: reservasDelDiaQueryKey(variables.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: actividadDelDiaQueryKey(variables.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: TURNOS_ABIERTOS_VIEJOS_QUERY_KEY,
      });
    },
  });
}
