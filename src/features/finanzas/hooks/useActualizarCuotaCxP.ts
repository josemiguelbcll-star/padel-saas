import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { GastoCuota } from '@/types/database';
import { CXP_QUERY_KEY } from './useCuentasPorPagar';
import { GASTOS_QUERY_KEY } from './useGastos';

export interface ActualizarCuotaCxPInput {
  cuota_id: number;
  monto: number;
  fecha_vencimiento: string | null;
}

export function useActualizarCuotaCxP(): UseMutationResult<
  GastoCuota,
  Error,
  ActualizarCuotaCxPInput
> {
  const queryClient = useQueryClient();

  return useMutation<GastoCuota, Error, ActualizarCuotaCxPInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'fn_actualizar_cuota_cxp',
        {
          p_cuota_id: input.cuota_id,
          p_monto: input.monto,
          p_fecha_vencimiento: input.fecha_vencimiento,
        },
      );

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('No se pudo actualizar la cuota.');
      return data as GastoCuota;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CXP_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: GASTOS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['resumen_financiero'] });
      void queryClient.invalidateQueries({ queryKey: ['flujo-caja'] });
    },
  });
}
