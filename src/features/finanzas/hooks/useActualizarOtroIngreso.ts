import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { MedioPago, OtroIngreso } from '@/types/database';
import { OTROS_INGRESOS_QUERY_KEY } from './useOtrosIngresos';
import { INGRESOS_RECURRENTES_QUERY_KEY } from './useIngresosRecurrentes';
import { CUENTAS_QUERY_KEY } from '@/features/configuracion/hooks/useCuentas';

export interface ActualizarOtroIngresoInput {
  ingreso_id: number;
  unidad_id: number;
  concepto: string;
  monto: number;
  fecha: string;
  fecha_cobro?: string | null;
  medio_pago?: MedioPago | null;
  observaciones?: string | null;
  cuenta_id?: number | null;
}

export function useActualizarOtroIngreso(): UseMutationResult<
  OtroIngreso,
  Error,
  ActualizarOtroIngresoInput
> {
  const queryClient = useQueryClient();

  return useMutation<OtroIngreso, Error, ActualizarOtroIngresoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_actualizar_otro_ingreso', {
        p_ingreso_id: input.ingreso_id,
        p_unidad_id: input.unidad_id,
        p_concepto: input.concepto,
        p_monto: input.monto,
        p_fecha: input.fecha,
        p_fecha_cobro: input.fecha_cobro ?? null,
        p_medio_pago: input.medio_pago ?? null,
        p_observaciones: input.observaciones ?? null,
        p_cuenta_id: input.cuenta_id ?? null,
      });

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('No se pudo actualizar el ingreso.');
      }
      return data as OtroIngreso;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: OTROS_INGRESOS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: INGRESOS_RECURRENTES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['resumen_financiero'] });
      void queryClient.invalidateQueries({ queryKey: ['flujo-caja'] });
      void queryClient.invalidateQueries({ queryKey: CUENTAS_QUERY_KEY });
    },
  });
}
