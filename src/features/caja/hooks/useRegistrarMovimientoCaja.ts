import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { CajaMovimientoManual, TipoMovimientoCaja } from '@/types/database';
import { CAJA_RESUMEN_QUERY_KEY } from './useResumenCajaAbierta';
import { CAJA_MOVIMIENTOS_QUERY_KEY } from './useMovimientosCaja';

export interface RegistrarMovimientoCajaInput {
  tipo: TipoMovimientoCaja;
  monto: number;
  concepto: string;
  observaciones?: string;
  /** Para invalidar correctamente el cache de resumen y movimientos. */
  turnoCajaId: number;
}

/**
 * Registra un movimiento manual (retiro/pago_proveedor/ajuste_+/−)
 * sobre la caja abierta del caller. Invoca
 * `fn_registrar_movimiento_caja_manual` (0022) — la caja se resuelve
 * server-side con `current_club_caja_abierta()`, NO se pasa como input.
 *
 * Errores posibles:
 *   - 'No hay caja abierta. Abrí la caja del día antes de registrar movimientos.'
 *   - 'No tenés permisos para registrar movimientos en la caja.'
 *   - 'Tipo de movimiento inválido.'
 *   - 'El monto del movimiento debe ser mayor a cero.'
 *   - 'El concepto es obligatorio.'
 *
 * Al éxito invalida el resumen + la lista de movimientos.
 */
export function useRegistrarMovimientoCaja(): UseMutationResult<
  CajaMovimientoManual,
  Error,
  RegistrarMovimientoCajaInput
> {
  const queryClient = useQueryClient();
  return useMutation<CajaMovimientoManual, Error, RegistrarMovimientoCajaInput>({
    mutationFn: async ({ tipo, monto, concepto, observaciones }) => {
      const { data, error } = await supabase.rpc(
        'fn_registrar_movimiento_caja_manual',
        {
          p_tipo: tipo,
          p_monto: monto,
          p_concepto: concepto,
          p_observaciones: observaciones ?? null,
        },
      );
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('La función respondió sin datos. Refrescá el panel.');
      }
      return data as CajaMovimientoManual;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: CAJA_RESUMEN_QUERY_KEY(variables.turnoCajaId),
      });
      void queryClient.invalidateQueries({
        queryKey: CAJA_MOVIMIENTOS_QUERY_KEY(variables.turnoCajaId),
      });
    },
  });
}
