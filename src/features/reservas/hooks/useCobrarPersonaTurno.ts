import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { MedioPago, ReservaPago } from '@/types/database';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';
import { RESERVA_PAGOS_QUERY_KEY_BASE } from './useReservaPagos';

export interface CobrarPersonaTurnoInput {
  /** ID en reserva_jugadores (la persona del turno, no la ficha). */
  reserva_jugador_id: number;
  /** Para invalidar ['reserva_pagos', reservaId] al éxito. */
  reserva_id: number;
  /** Para invalidar ['reservas', fecha] (la grilla refresca el bloque). */
  fecha: string;
  medio_pago: MedioPago;
  observaciones: string | null;
  /**
   * Monto que el vendedor vio en pantalla para esta persona (parte
   * total - lo ya pagado). La RPC recalcula server-side y si no
   * coincide, RECHAZA con mensaje claro pidiendo refrescar.
   * Protege contra race con cambios concurrentes (otro vendedor
   * agregó consumo o quitó persona entre el render y el cobro).
   */
  monto_esperado: number;
}

/**
 * Llama a la RPC `fn_cobrar_persona_turno` (migración 0014). En una sola
 * transacción atómica: locks per-persona + per-reserva, cálculo
 * server-side del saldo (parte calculada - lo ya pagado), validación
 * cruzada con monto_esperado, INSERT del pago con desglose
 * alquiler/consumo, UPDATE del escalar reservas.monto_pagado (sólo la
 * parte de alquiler) y UPDATE del estado de la reserva si corresponde.
 *
 * Errores que el usuario puede ver (todos mapeados por dbErrors):
 *   - "El medio de pago es obligatorio." / "Medio de pago inválido."
 *   - "La persona no existe o no pertenece a tu club."
 *   - "No se puede cobrar a personas de una reserva cancelada."
 *   - "Esta persona ya está saldada (pagó $X de $Y)."
 *   - "La cuenta del turno cambió, revisá el monto antes de cobrar
 *     (esperabas $X pero el saldo real es $Y)."
 *   - Plus los genéricos de RLS y network.
 *
 * Al éxito invalida:
 *   - ['reserva_pagos', reservaId]  → el dialog refresca pagos por
 *     persona (saldo de cada uno) y el historial.
 *   - ['reservas', fecha]           → la grilla refresca el bloque
 *     (puede cambiar el color de estado si la reserva pasa a 'pagada'
 *     o 'senada').
 */
export function useCobrarPersonaTurno(): UseMutationResult<
  ReservaPago,
  Error,
  CobrarPersonaTurnoInput
> {
  const queryClient = useQueryClient();

  return useMutation<ReservaPago, Error, CobrarPersonaTurnoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cobrar_persona_turno', {
        p_reserva_jugador_id: input.reserva_jugador_id,
        p_medio_pago: input.medio_pago,
        p_observaciones: input.observaciones,
        p_monto_esperado: input.monto_esperado,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'El cobro se procesó pero no recibimos los datos actualizados. Refrescá el turno.',
        );
      }
      return data as ReservaPago;
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: [RESERVA_PAGOS_QUERY_KEY_BASE, input.reserva_id],
      });
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, input.fecha],
      });
    },
  });
}
