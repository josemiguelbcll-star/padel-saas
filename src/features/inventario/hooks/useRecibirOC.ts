import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Compra, MedioPago } from '@/types/database';
import { CAJA_RESUMEN_QUERY_KEY } from '@/features/caja/hooks/useResumenCajaAbierta';
import { CAJA_MOVIMIENTOS_QUERY_KEY } from '@/features/caja/hooks/useMovimientosCaja';
import { GASTOS_QUERY_KEY } from '@/features/finanzas/hooks/useGastos';

export interface RecibirOCItemInput {
  producto_id: number;
  cantidad_bultos: number;
  unidades_por_bulto: number;
  /** NETO (sin IVA — el IVA va aparte en tasa_iva). */
  costo_por_bulto: number;
  /** Porcentaje 0-100. Si no aplica IVA, mandar 0. */
  tasa_iva: number;
}

export interface RecibirOCInput {
  compra_id: number;
  fecha_recepcion: string;                // YYYY-MM-DD
  items: RecibirOCItemInput[];
  comprobante_tipo?: string | null;
  comprobante_numero?: string | null;
  fecha_pago?: string | null;
  medio_pago?: MedioPago | null;
  /** Para invalidar resumen/movimientos de caja si se pagó en efectivo. */
  turnoCajaIdParaInvalidate?: number | null;
}

/**
 * Recibe una OC en estado='pedida' via RPC `fn_recibir_oc` (0041).
 * Permite ajustar items contra la factura real (agregar/quitar/
 * modificar productos, costos, IVA por item). Snapshotea
 * condicion_fiscal_club, lockea productos ASC, sube stock, recalcula
 * PPP según condición fiscal (NETO si RI, TOTAL con IVA si
 * monotributo), crea el gasto via fn_registrar_gasto.
 *
 * Atómica: si fn_registrar_gasto falla (caja cerrada + efectivo),
 * ROLLBACK total — la OC sigue en 'pedida' sin cambios.
 *
 * Al éxito invalida:
 *   - ['compras']       — lista + detalle (estado cambió)
 *   - ['inventario']    — stock + productos.costo cambiaron
 *   - ['gastos']        — el gasto nuevo
 *   - ['finanzas']      — EERR / resumen mes
 *   - resumen + movimientos de caja si efectivo
 */
export function useRecibirOC(): UseMutationResult<
  Compra,
  Error,
  RecibirOCInput
> {
  const queryClient = useQueryClient();

  return useMutation<Compra, Error, RecibirOCInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_recibir_oc', {
        p_compra_id: input.compra_id,
        p_fecha_recepcion: input.fecha_recepcion,
        p_items_recepcion: input.items,
        p_comprobante_tipo: input.comprobante_tipo ?? null,
        p_comprobante_numero: input.comprobante_numero ?? null,
        p_fecha_pago: input.fecha_pago ?? null,
        p_medio_pago: input.medio_pago ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La recepción se procesó pero no recibimos los datos. Refrescá la lista.',
        );
      }
      return data as Compra;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['compras'] });
      void queryClient.invalidateQueries({ queryKey: ['inventario'] });
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
