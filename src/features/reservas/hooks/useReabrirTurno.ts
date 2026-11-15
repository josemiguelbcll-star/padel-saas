import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Reserva } from '@/types/database';
import { reservasDelDiaQueryKey } from './useReservasDelDia';
import { actividadDelDiaQueryKey } from './useActividadDelDia';
import { TURNOS_ABIERTOS_VIEJOS_QUERY_KEY } from './useTurnosAbiertosViejos';

export interface ReabrirTurnoInput {
  id: number;
  fecha: string;
}

/**
 * Reabre un turno cerrado vía `fn_reabrir_turno` (0158). Solo admin.
 */
export function useReabrirTurno(): UseMutationResult<
  Reserva,
  Error,
  ReabrirTurnoInput
> {
  const queryClient = useQueryClient();
  return useMutation<Reserva, Error, ReabrirTurnoInput>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.rpc('fn_reabrir_turno', {
        p_reserva_id: id,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('La función respondió sin datos.');
      return data as Reserva;
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: reservasDelDiaQueryKey(vars.fecha),
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
