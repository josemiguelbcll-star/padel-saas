import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { TurnoCaja } from '@/types/database';

export interface EditarArqueoCajaInput {
  turno_caja_id: number;
  nuevo_contado: number;
  nuevas_observaciones?: string | null;
}

/**
 * Corrige el arqueo de un turno de caja cerrado (solo admin) vía `fn_editar_arqueo_caja` (0159).
 */
export function useEditarArqueoCaja(): UseMutationResult<
  TurnoCaja,
  Error,
  EditarArqueoCajaInput
> {
  const queryClient = useQueryClient();

  return useMutation<TurnoCaja, Error, EditarArqueoCajaInput>({
    mutationFn: async ({ turno_caja_id, nuevo_contado, nuevas_observaciones }) => {
      const { data, error } = await supabase.rpc('fn_editar_arqueo_caja', {
        p_turno_caja_id: turno_caja_id,
        p_nuevo_contado: nuevo_contado,
        p_nuevas_observaciones: nuevas_observaciones ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('No se recibieron datos de la caja.');
      return data as TurnoCaja;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['turnos_caja'] });
      void queryClient.invalidateQueries({ queryKey: ['caja_abierta'] });
    },
  });
}

export function useReabrirTurnoCaja(): UseMutationResult<
  TurnoCaja,
  Error,
  { turno_caja_id: number }
> {
  const queryClient = useQueryClient();

  return useMutation<TurnoCaja, Error, { turno_caja_id: number }>({
    mutationFn: async ({ turno_caja_id }) => {
      const { data, error } = await supabase.rpc('fn_reabrir_turno_caja', {
        p_turno_caja_id: turno_caja_id,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('No se recibieron datos de la caja.');
      return data as TurnoCaja;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['turnos_caja'] });
      void queryClient.invalidateQueries({ queryKey: ['caja_abierta'] });
    },
  });
}
