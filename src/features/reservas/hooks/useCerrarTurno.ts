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

export interface CerrarTurnoInput {
  id: number;
  /** Para invalidar la query del día correcto. */
  fecha: string;
}

/**
 * Cierra manualmente un turno vía `fn_cerrar_turno` (0055): setea
 * cerrado_en=NOW(). NO exige saldo 0 (el aviso "todos pagaron, ¿cerrás?"
 * es UX del frontend). Cerrado es terminal: la 0054 impide cargar consumos
 * después; cobrar sí se permite. Reemplaza el viejo "marcar jugada".
 */
export function useCerrarTurno(): UseMutationResult<
  Reserva,
  Error,
  CerrarTurnoInput
> {
  const queryClient = useQueryClient();
  return useMutation<Reserva, Error, CerrarTurnoInput>({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.rpc('fn_cerrar_turno', {
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
