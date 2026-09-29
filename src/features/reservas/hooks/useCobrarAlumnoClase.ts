import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ClaseCobro, MedioPago } from '@/types/database';
import { CLASE_COBROS_QUERY_KEY_BASE } from './useCobrosDelDia';
import { claseAlumnosQueryKey } from './useClaseAlumnos';

export interface CobrarAlumnoClaseInput {
  clase_alumno_id: number;
  clase_id: number;
  fecha: string;
  medio_pago: MedioPago;
  monto: number;
  monto_clase?: number;
  monto_consumo?: number;
  observaciones?: string | null;
  cuenta_id?: number | null;
}

export function useCobrarAlumnoClase(): UseMutationResult<
  ClaseCobro,
  Error,
  CobrarAlumnoClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cobrar_alumno_clase', {
        p_clase_alumno_id: input.clase_alumno_id,
        p_medio_pago: input.medio_pago,
        p_monto: input.monto,
        p_monto_clase: input.monto_clase ?? input.monto,
        p_monto_consumo: input.monto_consumo ?? 0,
        p_observaciones: input.observaciones ?? null,
        p_cuenta_id: input.cuenta_id ?? null,
      });

      if (error) throw new Error(mapPostgrestError(error));
      return data as ClaseCobro;
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: [CLASE_COBROS_QUERY_KEY_BASE, input.fecha],
      });
      void queryClient.invalidateQueries({
        queryKey: claseAlumnosQueryKey(input.clase_id, input.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: ['caja-abierta-resumen'],
      });
    },
  });
}
