import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Gasto, MedioPago } from '@/types/database';
import { GASTOS_QUERY_KEY } from './useGastos';
import { CXP_QUERY_KEY } from './useCuentasPorPagar';
import { GASTOS_RECURRENTES_QUERY_KEY } from './useGastosRecurrentes';
import { CUENTAS_QUERY_KEY } from '@/features/configuracion/hooks/useCuentas';

export interface ActualizarGastoInput {
  gasto_id: number;
  categoria_id: number;
  monto: number;
  fecha_gasto: string;
  fecha_pago?: string | null;
  medio_pago?: MedioPago | null;
  proveedor_id?: number | null;
  proveedor_nombre?: string | null;
  observaciones?: string | null;
  cuenta_id?: number | null;
}

export function useActualizarGasto(): UseMutationResult<
  Gasto,
  Error,
  ActualizarGastoInput
> {
  const queryClient = useQueryClient();

  return useMutation<Gasto, Error, ActualizarGastoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_actualizar_gasto', {
        p_gasto_id: input.gasto_id,
        p_categoria_id: input.categoria_id,
        p_monto: input.monto,
        p_fecha_gasto: input.fecha_gasto,
        p_fecha_pago: input.fecha_pago ?? null,
        p_medio_pago: input.medio_pago ?? null,
        p_proveedor_id: input.proveedor_id ?? null,
        p_proveedor_nombre: input.proveedor_nombre ?? null,
        p_observaciones: input.observaciones ?? null,
        p_cuenta_id: input.cuenta_id ?? null,
      });

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('No se pudo actualizar el gasto.');
      }
      return data as Gasto;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GASTOS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CXP_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: GASTOS_RECURRENTES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['resumen_financiero'] });
      void queryClient.invalidateQueries({ queryKey: ['flujo-caja'] });
      void queryClient.invalidateQueries({ queryKey: CUENTAS_QUERY_KEY });
    },
  });
}
