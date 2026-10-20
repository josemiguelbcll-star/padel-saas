import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Reserva } from '@/types/database';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';
import { actividadDelDiaQueryKey } from './useActividadDelDia';
import { TURNOS_ABIERTOS_VIEJOS_QUERY_KEY } from './useTurnosAbiertosViejos';

export interface CancelarReservaInput {
  id: number;
  /** Para invalidar la query del día correcto. */
  fecha: string;
}

/**
 * Cancela una reserva vía `fn_cancelar_reserva` (0055/0138), que aplica la
 * regla de integridad server-side: conserva los pagos como ingreso de Canchas,
 * y solo rechaza turnos con consumos o ya cerrados. Setea estado='cancelada'
 * para liberar el slot vía el EXCLUDE no_overlap_reservas.
 */
export function useCancelarReserva(): UseMutationResult<
  Reserva,
  Error,
  CancelarReservaInput
> {
  const queryClient = useQueryClient();
  return useMutation<Reserva, Error, CancelarReservaInput>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.rpc('fn_cancelar_reserva', {
        p_reserva_id: id,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('La función respondió sin datos.');
      return data as Reserva;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, vars.fecha],
      });
      void queryClient.invalidateQueries({
        queryKey: actividadDelDiaQueryKey(vars.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: TURNOS_ABIERTOS_VIEJOS_QUERY_KEY,
      });
    },
  });
}
