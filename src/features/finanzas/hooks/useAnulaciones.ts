import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Anulacion, MotivoAnulacionTipo } from '@/types/database';
import { CAJA_RESUMEN_QUERY_KEY } from '@/features/caja/hooks/useResumenCajaAbierta';
import { CAJA_MOVIMIENTOS_QUERY_KEY } from '@/features/caja/hooks/useMovimientosCaja';
import { GASTOS_QUERY_KEY } from './useGastos';
import { GASTOS_RECURRENTES_QUERY_KEY } from './useGastosRecurrentes';
import { CXP_QUERY_KEY, CXP_PAGOS_RECIENTES_QUERY_KEY } from './useCuentasPorPagar';

/**
 * Invalidaciones comunes a toda anulación: gastos, CxP (pendientes y
 * pagos recientes), panel de recurrentes y el resumen financiero.
 */
function invalidarFinanzas(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: GASTOS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: CXP_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: CXP_PAGOS_RECIENTES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: GASTOS_RECURRENTES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ['finanzas'] });
}

// ─────────────────────────────────────────────────────────────────────
// useAnularGasto
// ─────────────────────────────────────────────────────────────────────

export interface AnularGastoInput {
  gasto_id: number;
  motivo_tipo: MotivoAnulacionTipo;
  motivo_detalle?: string | null;
}

/**
 * Anula un gasto via RPC `fn_anular_gasto` (0048): activo=FALSE + rastro
 * en `anulaciones`. NO toca caja (el gasto anulado por este flujo está
 * pendiente y sin pagos).
 *
 * Mensajes posibles (de la RPC, mapeados):
 *   - 'Solo el administrador puede anular gastos.'
 *   - 'El gasto no existe o no pertenece a tu club.'
 *   - 'Este gasto ya está anulado.'
 *   - 'Este gasto tiene cuotas pagadas. Anulá primero el/los pagos...'
 *   - 'Este gasto proviene de una orden de compra...'
 *   - 'Si el motivo es "otro", contá brevemente qué pasó en el detalle.'
 */
export function useAnularGasto(): UseMutationResult<
  Anulacion,
  Error,
  AnularGastoInput
> {
  const queryClient = useQueryClient();
  return useMutation<Anulacion, Error, AnularGastoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_anular_gasto', {
        p_gasto_id: input.gasto_id,
        p_motivo_tipo: input.motivo_tipo,
        p_motivo_detalle: input.motivo_detalle ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La anulación se procesó pero no recibimos los datos. Refrescá la lista.',
        );
      }
      return data as Anulacion;
    },
    onSuccess: () => {
      invalidarFinanzas(queryClient);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// useAnularPagoCuota
// ─────────────────────────────────────────────────────────────────────

export interface AnularPagoCuotaInput {
  cuota_id: number;
  motivo_tipo: MotivoAnulacionTipo;
  motivo_detalle?: string | null;
  /** Caja abierta de hoy. Si la anulación genera un ajuste (pago en
   *  efectivo de una caja ya cerrada), invalidamos su resumen y
   *  movimientos. */
  turnoCajaIdParaInvalidate?: number | null;
}

/**
 * Anula el pago de una cuota via RPC `fn_anular_pago_cuota` (0048): la
 * cuota vuelve a pendiente. Si el pago fue en efectivo de una caja YA
 * CERRADA, la RPC registra un ajuste_positivo en la caja de hoy; el
 * `Anulacion` devuelto trae `caja_movimiento_id` seteado en ese caso.
 *
 * Mensajes posibles (de la RPC, mapeados):
 *   - 'No tenés permisos para anular pagos.'
 *   - 'La cuota no existe o no pertenece a tu club.'
 *   - 'Esta cuota no está pagada — no hay pago para anular.'
 *   - 'Anular un pago en efectivo de una caja ya cerrada requiere administrador...'
 *   - 'No hay caja abierta para registrar el ajuste de esta anulación...'
 */
export function useAnularPagoCuota(): UseMutationResult<
  Anulacion,
  Error,
  AnularPagoCuotaInput
> {
  const queryClient = useQueryClient();
  return useMutation<Anulacion, Error, AnularPagoCuotaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_anular_pago_cuota', {
        p_cuota_id: input.cuota_id,
        p_motivo_tipo: input.motivo_tipo,
        p_motivo_detalle: input.motivo_detalle ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La anulación se procesó pero no recibimos los datos. Refrescá la lista.',
        );
      }
      return data as Anulacion;
    },
    onSuccess: (data, variables) => {
      invalidarFinanzas(queryClient);
      // Si generó un ajuste en la caja de hoy (caja_movimiento_id),
      // refrescar su resumen y movimientos.
      if (data.caja_movimiento_id !== null && variables.turnoCajaIdParaInvalidate) {
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
