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
 * Campos que el detalle de reserva puede actualizar en sprint 3a.
 *
 * - `estado`: cancelar (→'cancelada') o marcar como jugada (→'jugada').
 *   Transiciones que NO requieren tocar reserva_pagos siguen este
 *   camino. Para "marcar como pagada" cuando hay saldo pendiente,
 *   habría que insertar un reserva_pago → eso va con la integración
 *   de Caja (sprint posterior).
 * - `observaciones`: el único campo "editable" post-creación que el
 *   doc maestro 8.3 menciona explícitamente como permitido sin
 *   romper trazabilidad.
 */
export type ActualizarReservaChanges = Partial<
  Pick<Reserva, 'estado' | 'observaciones'>
>;

export interface ActualizarReservaInput {
  id: number;
  /** Para invalidar la query del día correcto. */
  fecha: string;
  changes: ActualizarReservaChanges;
}

/**
 * Actualiza estado y/o observaciones de una reserva. Cualquier otro
 * campo (hora, cancha, jugadores, montos) NO se puede tocar in-place:
 * para reagendar se cancela y se crea nueva (decisión sprint 3a,
 * alineada con doc 8.3).
 */
export function useActualizarReserva(): UseMutationResult<
  Reserva,
  Error,
  ActualizarReservaInput
> {
  const queryClient = useQueryClient();

  return useMutation<Reserva, Error, ActualizarReservaInput>({
    mutationFn: async ({ id, changes }) => {
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
