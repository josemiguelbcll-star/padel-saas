import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { MedioPago, Reserva } from '@/types/database';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';
import { RESERVA_PAGOS_QUERY_KEY_BASE } from './useReservaPagos';

export interface CobrarReservaInput {
  reserva_id: number;
  monto: number;
  medio_pago: MedioPago;
  observaciones: string | null;
}

/**
 * Llama a la RPC fn_cobrar_reserva (migración 0006), que en una sola
 * transacción inserta el pago en reserva_pagos y actualiza los
 * escalares de la reserva (monto_pagado, monto_sena, estado).
 *
 * Errores que el usuario puede ver (todos mapeados por dbErrors):
 *   - "Esta reserva ya está paga, no hay saldo para cobrar."
 *   - "El cobro de $X supera el saldo pendiente de $Y. Ajustá el monto."
 *   - "No se puede cobrar sobre una reserva cancelada."
 *   - "El monto a cobrar debe ser mayor a 0."
 *   - "El medio de pago es obligatorio."
 *   - Plus los genéricos de RLS y network.
 *
 * Al éxito invalida:
 *   - ['reservas', fecha]                 → la grilla del día refresca el bloque
 *   - ['reserva_pagos', reserva_id]       → el historial dentro del detalle refresca
 */
export function useCobrarReserva(): UseMutationResult<
  Reserva,
  Error,
  CobrarReservaInput
> {
  const queryClient = useQueryClient();

  return useMutation<Reserva, Error, CobrarReservaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cobrar_reserva', {
        p_reserva_id: input.reserva_id,
        p_monto: input.monto,
        p_medio_pago: input.medio_pago,
        p_observaciones: input.observaciones,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'El cobro se procesó pero no recibimos los datos actualizados. Refrescá la grilla.',
        );
      }
      return data as Reserva;
    },
    onSuccess: (reserva) => {
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, reserva.fecha],
      });
      void queryClient.invalidateQueries({
        queryKey: [RESERVA_PAGOS_QUERY_KEY_BASE, reserva.id],
      });
    },
  });
}
