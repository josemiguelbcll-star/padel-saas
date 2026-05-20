import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ProductoConStock } from '@/types/database';

export const PRODUCTOS_CON_STOCK_QUERY_KEY_BASE = 'productos_con_stock';
export const PRODUCTOS_CON_STOCK_QUERY_KEY = [
  PRODUCTOS_CON_STOCK_QUERY_KEY_BASE,
] as const;

/**
 * Lista de productos del club + stock_actual (suma de movimientos),
 * leída de la vista `vw_productos_con_stock` (migración 0009).
 *
 * Una sola query trae productos y stock — evita el N+1 que tendríamos
 * si calculáramos stock por producto del cliente. La vista usa
 * `security_invoker = true` así que las RLS de productos y
 * movimientos_stock se aplican normalmente al usuario.
 *
 * Se invalida desde:
 *   - useCreateProducto / useUpdateProducto / useDeleteProducto
 *     (cuando el catálogo cambia)
 *   - useCargarStock (cuando entra inventario via fn_registrar_movimiento_stock)
 *   - useCerrarVenta (cuando una venta sale, baja el stock — bloque futuro)
 *
 * Devuelve todos los productos (activos e inactivos). Los consumidores
 * filtran a su gusto.
 */
export function useProductosConStock(): UseQueryResult<
  ProductoConStock[],
  Error
> {
  return useQuery<ProductoConStock[], Error>({
    queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vw_productos_con_stock')
        .select('*')
        .order('categoria', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ProductoConStock[];
    },
  });
}
