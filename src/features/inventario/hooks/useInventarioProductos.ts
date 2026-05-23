import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ProductoConStock } from '@/types/database';

export const INVENTARIO_PRODUCTOS_QUERY_KEY = ['inventario', 'productos'] as const;

/**
 * Lista completa de productos del club con su stock_actual (lectura
 * a la vista vw_productos_con_stock, que es SUM(movimientos_stock)).
 *
 * Trae TODOS los productos (activos e inactivos) — la página los filtra
 * client-side. Volumen típico en buffet/shop: < 200 productos.
 */
export function useInventarioProductos(): UseQueryResult<ProductoConStock[], Error> {
  return useQuery<ProductoConStock[], Error>({
    queryKey: INVENTARIO_PRODUCTOS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vw_productos_con_stock')
        .select('*')
        .order('linea', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ProductoConStock[];
    },
  });
}
