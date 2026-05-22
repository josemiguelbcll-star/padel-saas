import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { MedioPago, OtroIngreso } from '@/types/database';
import { OTROS_INGRESOS_QUERY_KEY } from './useOtrosIngresos';
import { CAJA_RESUMEN_QUERY_KEY } from '@/features/caja/hooks/useResumenCajaAbierta';
import { CAJA_MOVIMIENTOS_QUERY_KEY } from '@/features/caja/hooks/useMovimientosCaja';

export interface RegistrarOtroIngresoInput {
  unidad_id: number;
  concepto: string;
  monto: number;
  fecha: string;                  // YYYY-MM-DD
  fecha_cobro?: string | null;    // YYYY-MM-DD si cobró
  medio_pago?: MedioPago | null;
  observaciones?: string | null;
  turnoCajaIdParaInvalidate?: number | null;
}

/**
 * Alta de un otro_ingreso via RPC `fn_registrar_otro_ingreso` (0028).
 * Mismo patrón que useRegistrarGasto.
 */
export function useRegistrarOtroIngreso(): UseMutationResult<
  OtroIngreso,
  Error,
  RegistrarOtroIngresoInput
> {
  const queryClient = useQueryClient();
  return useMutation<OtroIngreso, Error, RegistrarOtroIngresoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_registrar_otro_ingreso', {
        p_unidad_id: input.unidad_id,
        p_concepto: input.concepto,
        p_monto: input.monto,
        p_fecha: input.fecha,
        p_fecha_cobro: input.fecha_cobro ?? null,
        p_medio_pago: input.medio_pago ?? null,
        p_observaciones: input.observaciones ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La función respondió sin datos. Refrescá la lista de ingresos.',
        );
      }
      return data as OtroIngreso;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: OTROS_INGRESOS_QUERY_KEY });
      if (
        variables.medio_pago === 'efectivo' &&
        variables.turnoCajaIdParaInvalidate
      ) {
        void queryClient.invalidateQueries({
          queryKey: CAJA_RESUMEN_QUERY_KEY(variables.turnoCajaIdParaInvalidate),
        });
        void queryClient.invalidateQueries({
          queryKey: CAJA_MOVIMIENTOS_QUERY_KEY(variables.turnoCajaIdParaInvalidate),
        });
      }
    },
  });
}
