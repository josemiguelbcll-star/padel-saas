import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ClaseCobro, MedioPago } from '@/types/database';
import { CLASE_COBROS_QUERY_KEY_BASE } from './useCobrosDelDia';

export interface CobrarClaseInput {
  clase_id: number;
  /** 'YYYY-MM-DD' — fecha puntual de la ocurrencia. */
  fecha: string;
  monto: number;
  medio_pago: MedioPago;
  observaciones: string | null;
}

/**
 * Llama a la RPC fn_cobrar_clase
 */
export function useCobrarClase(): UseMutationResult<
  ClaseCobro,
  Error,
  CobrarClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation<ClaseCobro, Error, CobrarClaseInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cobrar_clase', {
        p_clase_id: input.clase_id,
        p_fecha: input.fecha,
        p_monto: input.monto,
        p_medio_pago: input.medio_pago,
        p_observaciones: input.observaciones,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'El cobro se procesó pero no recibimos los datos actualizados. Refrescá la grilla.',
        );
      }
      return data as ClaseCobro;
    },
    onSuccess: (cobro) => {
      void queryClient.invalidateQueries({
        queryKey: [CLASE_COBROS_QUERY_KEY_BASE, cobro.fecha],
      });
    },
  });
}
