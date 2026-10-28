import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { claseAlumnosQueryKey } from './useClaseAlumnos';
import { CLASE_OCURRENCIAS_DEL_DIA_QUERY_KEY } from './useClaseOcurrenciasDelDia';

export interface ClaseOcurrencia {
  id: number;
  club_id: number;
  clase_id: number;
  fecha: string;
  cantidad_alumnos: number;
  monto_total: number;
  estado: string;
  creado_por: string;
  creado_en: string;
  tarifa_clase_opcion_id: number | null;
  tarifa_opcion_nombre: string | null;
  tarifa_opcion_monto: number | null;
}

export const CLASE_OCURRENCIA_QUERY_KEY = 'clase_ocurrencia';

export function useClaseOcurrencia(claseId: number, fecha: string) {
  return useQuery<ClaseOcurrencia | null, Error>({
    queryKey: [CLASE_OCURRENCIA_QUERY_KEY, claseId, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clase_ocurrencias')
        .select('*')
        .eq('clase_id', claseId)
        .eq('fecha', fecha)
        .maybeSingle();
      
      if (error) {
        throw new Error(mapPostgrestError(error));
      }
      return data as ClaseOcurrencia | null;
    },
    enabled: !!claseId && !!fecha,
  });
}

interface SeleccionarTarifaClaseInput {
  clase_id: number;
  fecha: string;
  opcion_id: number;
}

export function useSeleccionarTarifaClaseOpcion(): UseMutationResult<
  ClaseOcurrencia,
  Error,
  SeleccionarTarifaClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation<ClaseOcurrencia, Error, SeleccionarTarifaClaseInput>({
    mutationFn: async ({ clase_id, fecha, opcion_id }) => {
      const { data, error } = await supabase.rpc(
        'fn_seleccionar_tarifa_clase_opcion',
        {
          p_clase_id: clase_id,
          p_fecha: fecha,
          p_opcion_id: opcion_id,
        },
      );
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('La función respondió sin datos.');
      return data as ClaseOcurrencia;
    },
    onSuccess: (data, input) => {
      queryClient.setQueryData(
        [CLASE_OCURRENCIA_QUERY_KEY, input.clase_id, input.fecha],
        data,
      );
      void queryClient.invalidateQueries({
        queryKey: claseAlumnosQueryKey(input.clase_id, input.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: [CLASE_OCURRENCIAS_DEL_DIA_QUERY_KEY, input.fecha],
      });
    },
  });
}
