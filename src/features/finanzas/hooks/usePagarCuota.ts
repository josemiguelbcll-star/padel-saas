import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { GastoCuota, MedioPago } from '@/types/database';
import { CAJA_RESUMEN_QUERY_KEY } from '@/features/caja/hooks/useResumenCajaAbierta';
import { CAJA_MOVIMIENTOS_QUERY_KEY } from '@/features/caja/hooks/useMovimientosCaja';
import { GASTOS_QUERY_KEY } from './useGastos';
import { CXP_QUERY_KEY } from './useCuentasPorPagar';

export interface PagarCuotaInput {
  cuota_id: number;
  fecha_pago: string;       // YYYY-MM-DD
  medio_pago: MedioPago;
  /** Para invalidar resumen/movimientos de la caja si efectivo. */
  turnoCajaIdParaInvalidate?: number | null;
}

/**
 * Marca una cuota como pagada via RPC `fn_pagar_cuota` (0045). NO
 * toca gastos.fecha_pago — el estado de la deuda madre se deriva
 * de la suma de cuotas pagadas (ver módulo CxP).
 *
 * Mensajes posibles (de la RPC, mapeados via dbErrors):
 *   - 'No tenés permisos para pagar cuotas.'
 *   - 'La cuota no existe o no pertenece a tu club.'
 *   - 'Esta cuota ya está pagada (FECHA por MEDIO).'
 *   - 'Medio de pago inválido.'
 *   - 'No hay caja abierta...' (regla de oro del efectivo)
 *
 * Al éxito invalida:
 *   - ['cxp']     — la lista de cuentas por pagar
 *   - ['gastos']  — por si se muestra estado pagado en otro lado
 *   - ['finanzas']— EERR se mantiene sin cambios, pero el resumen del
 *                   módulo financiero puede incluir cuotas pagadas en
 *                   reportes futuros
 *   - resumen + movimientos de caja si efectivo
 */
export function usePagarCuota(): UseMutationResult<
  GastoCuota,
  Error,
  PagarCuotaInput
> {
  const queryClient = useQueryClient();

  return useMutation<GastoCuota, Error, PagarCuotaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_pagar_cuota', {
        p_cuota_id: input.cuota_id,
        p_fecha_pago: input.fecha_pago,
        p_medio_pago: input.medio_pago,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La cuota se procesó pero no recibimos los datos. Refrescá la lista.',
        );
      }
      return data as GastoCuota;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: CXP_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: GASTOS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['finanzas'] });
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
