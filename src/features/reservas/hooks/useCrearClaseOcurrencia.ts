import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { CLASE_OCURRENCIA_QUERY_KEY, type ClaseOcurrencia } from './useClaseOcurrencia';

interface CrearOcurrenciaParams {
  clase_id: number;
  fecha: string;
  cantidad_alumnos: number;
  monto_total: number;
}

export function useCrearClaseOcurrencia() {
  const queryClient = useQueryClient();

  return useMutation<ClaseOcurrencia, Error, CrearOcurrenciaParams>({
    mutationFn: async (params) => {
      const { data, error } = await supabase
        .from('clase_ocurrencias')
        .insert({
          clase_id: params.clase_id,
          fecha: params.fecha,
          cantidad_alumnos: params.cantidad_alumnos,
          monto_total: params.monto_total,
        })
        .select()
        .single();

      if (error) {
        throw new Error(mapPostgrestError(error));
      }

      return data as ClaseOcurrencia;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        [CLASE_OCURRENCIA_QUERY_KEY, variables.clase_id, variables.fecha],
        data,
      );
    },
  });
}
