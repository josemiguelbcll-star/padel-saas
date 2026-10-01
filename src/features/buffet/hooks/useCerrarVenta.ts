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

export interface CerrarVentaPagoItem {
  medio_pago: MedioPago;
  monto: number;
  cuenta_id?: number | null;
}

export interface CerrarVentaInput {
  items: CerrarVentaItem[];
  medio_pago: MedioPago;
  observaciones: string | null;
  cuenta_id?: number | null;
  jugador_id?: number | null;
  pagos?: CerrarVentaPagoItem[] | null;
}

/**
 * Llama a la RPC `fn_cerrar_venta` (0058/0130).
 * Soporta cobro único o cobro mixto/dividido a través de p_pagos.
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
        p_cuenta_id: input.cuenta_id ?? null,
        p_jugador_id: input.jugador_id ?? null,
        p_pagos: input.pagos && input.pagos.length > 0 ? input.pagos : null,
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
      void queryClient.invalidateQueries({
        queryKey: ['caja'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['caja-abierta-resumen'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['caja-movimientos'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['movimientos-cuenta'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['flujo-caja'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['ingresos_por_medio'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['jugadores'],
      });
    },
  });
}
