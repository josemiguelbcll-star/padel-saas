import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';

export interface AjustarStockInput {
  producto_id: number;
  /** Positivo = sumar (entrada). Negativo = restar (salida). NUNCA 0. */
  cantidad: number;
  /** Razón del ajuste (obligatoria server-side). */
  razon: string;
}

export interface MovimientoStock {
  id: number;
  club_id: number;
  producto_id: number;
  cantidad: number;
  fuente: 'compra_manual' | 'venta' | 'ajuste' | 'compra_bot_whatsapp';
  venta_id: number | null;
  observaciones: string | null;
  usuario_id: string;
  fecha_hora: string;
}

/**
 * Ajuste manual de stock via fn_ajustar_stock (0037). Gate admin
 * server-side. Razón obligatoria. Valida que el stock resultante no
 * quede negativo.
 *
 * Al éxito invalida la lista de productos para que la tabla refleje
 * el nuevo stock_actual de inmediato.
 */
export function useAjustarStock(): UseMutationResult<
  MovimientoStock,
  Error,
  AjustarStockInput
> {
  const queryClient = useQueryClient();
  return useMutation<MovimientoStock, Error, AjustarStockInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_ajustar_stock', {
        p_producto_id: input.producto_id,
        p_cantidad: input.cantidad,
        p_razon: input.razon,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('El ajuste se procesó pero no recibimos los datos.');
      }
      return data as MovimientoStock;
    },
    onSuccess: () => {
      // Invalidamos TODO el árbol ['inventario'] — los queryKeys de
      // productos, movimientos, rotación y top vendidos cuelgan de
      // este prefijo, así que un ajuste refresca todas las vistas
      // que pueden haberse desfasado (stock_actual cambia → días de
      // stock cambian; aparece un movimiento nuevo de fuente='ajuste').
      void queryClient.invalidateQueries({ queryKey: ['inventario'] });
    },
  });
}
