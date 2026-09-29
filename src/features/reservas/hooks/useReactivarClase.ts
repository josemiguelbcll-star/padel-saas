import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { CLASE_OCURRENCIA_QUERY_KEY } from './useClaseOcurrencia';
import { CLASE_OCURRENCIAS_DEL_DIA_QUERY_KEY } from './useClaseOcurrenciasDelDia';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';
import { actividadDelDiaQueryKey } from './useActividadDelDia';

export interface ReactivarClaseInput {
  claseId: number;
  fecha: string;
}

export function useReactivarClase() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, ReactivarClaseInput>({
    mutationFn: async ({ claseId, fecha }) => {
      const { error } = await supabase.rpc('fn_reactivar_clase_por_fecha', {
        p_clase_id: claseId,
        p_fecha: fecha,
      });
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: (_, { claseId, fecha }) => {
      void queryClient.invalidateQueries({
        queryKey: [CLASE_OCURRENCIAS_DEL_DIA_QUERY_KEY, fecha],
      });
      void queryClient.invalidateQueries({
        queryKey: [CLASE_OCURRENCIA_QUERY_KEY, claseId, fecha],
      });
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, fecha],
      });
      void queryClient.invalidateQueries({
        queryKey: actividadDelDiaQueryKey(fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: ['clases'],
      });
    },
  });
}
