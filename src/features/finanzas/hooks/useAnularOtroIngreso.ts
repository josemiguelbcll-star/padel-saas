import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { OtroIngreso } from '@/types/database';
import { OTROS_INGRESOS_QUERY_KEY } from './useOtrosIngresos';
import { INGRESOS_RECURRENTES_QUERY_KEY } from './useIngresosRecurrentes';
import { CUENTAS_QUERY_KEY } from '@/features/configuracion/hooks/useCuentas';

export interface AnularOtroIngresoInput {
  ingreso_id: number;
  motivo?: string | null;
}

export function useAnularOtroIngreso(): UseMutationResult<
  OtroIngreso,
  Error,
  AnularOtroIngresoInput
> {
  const queryClient = useQueryClient();

  return useMutation<OtroIngreso, Error, AnularOtroIngresoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_anular_otro_ingreso', {
        p_ingreso_id: input.ingreso_id,
        p_motivo: input.motivo ?? null,
      });

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('No se pudo anular el ingreso.');
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
