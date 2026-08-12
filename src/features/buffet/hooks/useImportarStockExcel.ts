import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { PRODUCTOS_CON_STOCK_QUERY_KEY } from '@/features/configuracion/hooks/useProductosConStock';
import { PRODUCTOS_QUERY_KEY } from '@/features/configuracion/hooks/useProductos';
import type { ProductoStockExcel } from '../importarStockExcel';

export interface ResultadoImportacionStock {
  creados: number;
  actualizados: number;
  stock_ajustado: number;
  sin_cambios_stock: number;
}

export function useImportarStockExcel(): UseMutationResult<
  ResultadoImportacionStock,
  Error,
  ProductoStockExcel[]
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productos) => {
      const payload = productos.map(({ hoja: _hoja, ...producto }) => producto);
      const { data, error } = await supabase.rpc('fn_importar_stock_excel', {
        p_productos: payload,
      });
      if (error) throw new Error(mapPostgrestError(error));
      return data as ResultadoImportacionStock;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTOS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY });
    },
  });
}
