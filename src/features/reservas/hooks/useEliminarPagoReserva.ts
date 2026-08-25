import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { RESERVA_PAGOS_QUERY_KEY_BASE } from './useReservaPagos';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';

export interface EliminarPagoReservaInput {
  pagoId: number;
  reservaId: number;
  fechaReserva: string;
}

/**
 * Hook para eliminar un pago de reserva llamando a la RPC `fn_eliminar_pago_reserva`.
 * Al éxito invalida los pagos de esa reserva y las reservas del día
 * para que la grilla y el modal se actualicen.
 */
export function useEliminarPagoReserva(): UseMutationResult<
  void,
  Error,
  EliminarPagoReservaInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, EliminarPagoReservaInput>({
    mutationFn: async ({ pagoId }) => {
      const { error } = await supabase.rpc('fn_eliminar_pago_reserva', {
        p_pago_id: pagoId,
      });

      if (error) {
        throw new Error(mapPostgrestError(error));
      }
    },
    onSuccess: (_, { reservaId, fechaReserva }) => {
      void queryClient.invalidateQueries({
        queryKey: [RESERVA_PAGOS_QUERY_KEY_BASE, reservaId],
      });
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, fechaReserva],
      });
    },
  });
}
