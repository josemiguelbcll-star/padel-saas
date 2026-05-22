import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { TurnoCaja } from '@/types/database';
import { CAJA_ABIERTA_QUERY_KEY } from './useCajaAbierta';
import { CAJA_RESUMEN_QUERY_KEY } from './useResumenCajaAbierta';
import { CAJA_MOVIMIENTOS_QUERY_KEY } from './useMovimientosCaja';

export interface CerrarCajaInput {
  turnoCajaId: number;
  efectivoContado: number;
  observaciones?: string;
}

/**
 * Cierra la caja abierta con arqueo. Invoca `fn_cerrar_caja` (0022),
 * que server-side calcula el esperado (apertura + entradas efectivo +
 * ajustes − salidas) y guarda diferencia = contado − esperado.
 *
 * Errores posibles:
 *   - 'Esta caja ya está cerrada.'
 *   - 'No tenés permisos para cerrar la caja.'
 *   - 'El efectivo contado es obligatorio y no puede ser negativo.'
 *   - 'Caja no encontrada.'
 *
 * Al éxito invalida las queries de caja abierta + resumen + movimientos
 * para que el panel vuelva al estado "sin caja abierta".
 */
export function useCerrarCaja(): UseMutationResult<
  TurnoCaja,
  Error,
  CerrarCajaInput
> {
  const queryClient = useQueryClient();
  return useMutation<TurnoCaja, Error, CerrarCajaInput>({
    mutationFn: async ({ turnoCajaId, efectivoContado, observaciones }) => {
      const { data, error } = await supabase.rpc('fn_cerrar_caja', {
        p_turno_caja_id: turnoCajaId,
        p_efectivo_contado: efectivoContado,
        p_observaciones: observaciones ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('La función respondió sin datos. Refrescá el panel.');
      }
      return data as TurnoCaja;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: CAJA_ABIERTA_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: CAJA_RESUMEN_QUERY_KEY(variables.turnoCajaId),
      });
      void queryClient.invalidateQueries({
        queryKey: CAJA_MOVIMIENTOS_QUERY_KEY(variables.turnoCajaId),
      });
    },
  });
}
