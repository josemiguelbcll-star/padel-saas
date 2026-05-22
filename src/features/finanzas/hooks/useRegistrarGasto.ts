import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Gasto, MedioPago } from '@/types/database';
import { GASTOS_QUERY_KEY } from './useGastos';
import { CAJA_RESUMEN_QUERY_KEY } from '@/features/caja/hooks/useResumenCajaAbierta';
import { CAJA_MOVIMIENTOS_QUERY_KEY } from '@/features/caja/hooks/useMovimientosCaja';

export interface RegistrarGastoInput {
  categoria_id: number;
  monto: number;
  fecha_gasto: string;            // YYYY-MM-DD
  proveedor?: string | null;
  observaciones?: string | null;
  fecha_pago?: string | null;     // YYYY-MM-DD si pagó
  medio_pago?: MedioPago | null;
  /** Para invalidar el resumen/movimientos de la caja si el pago fue
   *  en efectivo. Opcional: se pasa solo si hay caja abierta. */
  turnoCajaIdParaInvalidate?: number | null;
}

/**
 * Alta de un gasto via RPC `fn_registrar_gasto` (0028).
 *
 * Mensajes que el usuario puede ver (mapeados):
 *   - 'No hay sesión activa.'
 *   - 'No tenés permisos para registrar gastos.'
 *   - 'El monto del gasto debe ser mayor a 0.'
 *   - 'La fecha del gasto es obligatoria.'
 *   - 'Si pagás el gasto, tenés que indicar fecha de pago Y medio de pago...'
 *   - 'Medio de pago inválido.'
 *   - 'La categoría no existe o no pertenece a tu club.'
 *   - 'La categoría "X" está desactivada...'
 *   - 'No hay caja abierta. Pedile a la administración que abra...' (regla de oro)
 *
 * Al éxito invalida la query de gastos. Si el pago fue en efectivo
 * (turnoCajaIdParaInvalidate seteado), también invalida el resumen
 * y los movimientos de esa caja.
 */
export function useRegistrarGasto(): UseMutationResult<
  Gasto,
  Error,
  RegistrarGastoInput
> {
  const queryClient = useQueryClient();
  return useMutation<Gasto, Error, RegistrarGastoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_registrar_gasto', {
        p_categoria_id: input.categoria_id,
        p_monto: input.monto,
        p_fecha_gasto: input.fecha_gasto,
        p_proveedor: input.proveedor ?? null,
        p_observaciones: input.observaciones ?? null,
        p_fecha_pago: input.fecha_pago ?? null,
        p_medio_pago: input.medio_pago ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La función respondió sin datos. Refrescá la lista de gastos.',
        );
      }
      return data as Gasto;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: GASTOS_QUERY_KEY });
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
