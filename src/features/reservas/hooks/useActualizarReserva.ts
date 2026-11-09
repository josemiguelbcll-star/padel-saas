import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Reserva } from '@/types/database';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';

/**
 * Campos que el detalle de reserva puede actualizar.
 *
 * - `estado`: cancelar (→'cancelada') o marcar como jugada (→'jugada').
 *   Transiciones que NO requieren tocar reserva_pagos siguen este
 *   camino. Para "marcar como pagada" cuando hay saldo pendiente,
 *   habría que insertar un reserva_pago → eso va con la integración
 *   de Caja (sprint posterior).
 * - `observaciones`: campo editable post-creación.
 * - `duracion_min`: excepción para turnos abiertos; una RPC valida
 *   disponibilidad y tarifa, sin modificar pagos ni consumos.
 */
export type ActualizarReservaChanges = Partial<
  Pick<Reserva, 'estado' | 'observaciones' | 'monto_total' | 'tarifa_id' | 'duracion_min'>
>;

export interface ActualizarReservaInput {
  id: number;
  /** Para invalidar la query del día correcto. */
  fecha: string;
  changes: ActualizarReservaChanges;
}

/**
 * La duración se cambia mediante RPC atómica; el resto de actualizaciones
 * simples continúa usando RLS sobre la tabla de reservas.
 */
export function useActualizarReserva(): UseMutationResult<
  Reserva,
  Error,
  ActualizarReservaInput
> {
  const queryClient = useQueryClient();

  return useMutation<Reserva, Error, ActualizarReservaInput>({
    mutationFn: async ({ id, changes }) => {
      if (changes.duracion_min !== undefined) {
        const { data, error } = await supabase.rpc('fn_actualizar_duracion_reserva', {
          p_reserva_id: id,
          p_duracion_min: changes.duracion_min,
        });
        if (error) throw new Error(mapPostgrestError(error));
        if (!data) throw new Error('La función respondió sin datos.');
        return data as Reserva;
      }

      const { data, error } = await supabase
        .from('reservas')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Reserva;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, vars.fecha],
      });
    },
  });
}
