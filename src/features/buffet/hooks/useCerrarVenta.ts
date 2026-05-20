import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { MedioPago, Venta } from '@/types/database';
import { PRODUCTOS_CON_STOCK_QUERY_KEY } from '@/features/configuracion/hooks/useProductosConStock';

export interface CerrarVentaItem {
  producto_id: number;
  cantidad: number;
}

export interface CerrarVentaInput {
  items: CerrarVentaItem[];
  medio_pago: MedioPago;
  observaciones: string | null;
}

/**
 * Llama a la RPC `fn_cerrar_venta` (migración 0009, actualizada en 0010
 * para snapshotear costo). En una sola transacción inserta la cabecera
 * de venta, sus items (con snapshots de nombre/precio/costo) y los
 * movimientos de stock de salida.
 *
 * Errores que el usuario puede ver (todos mapeados por dbErrors):
 *   - "La venta tiene que tener al menos un producto."
 *   - "El medio de pago es obligatorio." / "Medio de pago inválido."
 *   - "La cantidad debe ser mayor a 0."
 *   - "El producto seleccionado no existe o no pertenece a tu club."
 *   - "El producto «X» está desactivado, no se puede vender."
 *   - "Stock insuficiente de «X»: hay Y unidades, querés vender Z."
 *   - Plus los genéricos de RLS y network.
 *
 * Al éxito invalida la vista de productos con stock para que el
 * catálogo refresque el stock disponible (puede haber cambiado por
 * otra venta concurrente además de la nuestra).
 *
 * No invalida nada del lado de Configuración → Productos (catálogo
 * puro): la misma `PRODUCTOS_CON_STOCK_QUERY_KEY` cubre las dos
 * pantallas porque ambas consumen `vw_productos_con_stock`.
 */
export function useCerrarVenta(): UseMutationResult<
  Venta,
  Error,
  CerrarVentaInput
> {
  const queryClient = useQueryClient();

  return useMutation<Venta, Error, CerrarVentaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cerrar_venta', {
        p_items: input.items,
        p_medio_pago: input.medio_pago,
        p_observaciones: input.observaciones,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La venta se procesó pero no recibimos los datos actualizados. Refrescá el catálogo.',
        );
      }
      return data as Venta;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}
