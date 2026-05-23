import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Compra, CondicionPago, Linea } from '@/types/database';
import type { CrearOCItemInput } from './useCrearOC';

export interface ActualizarOCInput {
  compra_id: number;
  proveedor_id: number;
  linea: Linea;
  fecha_oc: string;
  items: CrearOCItemInput[];
  condicion_pago: CondicionPago;
  fecha_compromiso_pago: string | null;
  observaciones?: string | null;
}

/**
 * Edita una OC en estado='pedida' via RPC `fn_actualizar_oc` (0041).
 * Reemplaza atómicamente cabecera + items. Seguro porque la OC en
 * pedida nunca asentó movimientos / gasto / costo.
 *
 * Rechaza si la OC está recibida o cancelada — el mensaje vuelve de
 * la RPC y se muestra en el dialog.
 *
 * Al éxito invalida `['compras']` y `['compras', 'detalle', X]`.
 */
export function useActualizarOC(): UseMutationResult<
  Compra,
  Error,
  ActualizarOCInput
> {
  const queryClient = useQueryClient();

  return useMutation<Compra, Error, ActualizarOCInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_actualizar_oc', {
        p_compra_id: input.compra_id,
        p_proveedor_id: input.proveedor_id,
        p_linea: input.linea,
        p_fecha_oc: input.fecha_oc,
        p_items: input.items,
        p_condicion_pago: input.condicion_pago,
        p_fecha_compromiso_pago: input.fecha_compromiso_pago,
        p_observaciones: input.observaciones ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La OC se procesó pero no recibimos los datos. Refrescá la lista.',
        );
      }
      return data as Compra;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compras'] });
    },
  });
}
