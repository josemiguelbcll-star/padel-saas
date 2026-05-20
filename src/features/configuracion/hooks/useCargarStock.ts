import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { MovimientoStock } from '@/types/database';
import { PRODUCTOS_CON_STOCK_QUERY_KEY } from './useProductosConStock';

export interface CargarStockInput {
  producto_id: number;
  /** INT > 0. Entrada de inventario por compra manual. */
  cantidad: number;
  observaciones: string | null;
}

/**
 * Llama a la RPC `fn_registrar_movimiento_stock` (migración 0009) para
 * registrar una carga manual de inventario (entrada con
 * fuente='compra_manual').
 *
 * Insertar movimientos sueltos desde el cliente está prohibido por
 * diseño: toda entrada de stock pasa por esta RPC, lo que centraliza la
 * coherencia (fuente correcta + signo positivo) y deja preparado el
 * patrón para el bot de WhatsApp futuro (con su propia RPC y fuente).
 *
 * Errores que el usuario puede ver (mapeados por dbErrors):
 *   - "La cantidad a cargar debe ser mayor a 0."
 *   - "El producto no existe o no pertenece a tu club."
 *   - Plus los genéricos de RLS / network.
 *
 * Al éxito invalida la vista de productos con stock para que la tabla
 * de Configuración → Productos refleje el nuevo stock en pantalla.
 * El catálogo del buffet (bloque futuro) también la consume y se
 * refresca solo.
 */
export function useCargarStock(): UseMutationResult<
  MovimientoStock,
  Error,
  CargarStockInput
> {
  const queryClient = useQueryClient();

  return useMutation<MovimientoStock, Error, CargarStockInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'fn_registrar_movimiento_stock',
        {
          p_producto_id: input.producto_id,
          p_cantidad: input.cantidad,
          p_observaciones: input.observaciones,
        },
      );
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'El movimiento se procesó pero no recibimos los datos actualizados. Refrescá la grilla.',
        );
      }
      return data as MovimientoStock;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}
