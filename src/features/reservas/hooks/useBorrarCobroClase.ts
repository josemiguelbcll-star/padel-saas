import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { CLASE_COBROS_QUERY_KEY_BASE } from './useCobrosDelDia';
import { claseAlumnosQueryKey } from './useClaseAlumnos';
import { CLASE_OCURRENCIA_QUERY_KEY } from './useClaseOcurrencia';

export interface BorrarCobroClaseInput {
  cobroId: number;
  claseId: number;
  /** Fecha de la ocurrencia ('YYYY-MM-DD') para invalidar la query correcta. */
  fecha: string;
}

export function useBorrarCobroClase(): UseMutationResult<
  void,
  Error,
  BorrarCobroClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, BorrarCobroClaseInput>({
    mutationFn: async ({ cobroId }) => {
      const { error: rpcError } = await supabase.rpc('fn_borrar_cobro_clase', {
        p_cobro_id: cobroId,
      });

      if (rpcError) throw new Error(mapPostgrestError(rpcError));
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: [CLASE_COBROS_QUERY_KEY_BASE],
      });
      void queryClient.invalidateQueries({
        queryKey: ['caja-abierta-resumen'],
      });
      void queryClient.invalidateQueries({
        queryKey: claseAlumnosQueryKey(input.claseId, input.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: [CLASE_OCURRENCIA_QUERY_KEY, input.claseId, input.fecha],
      });
    },
  });
}
