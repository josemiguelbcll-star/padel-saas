import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type {
  Compra,
  CompraItem,
  MedioPago,
} from '@/types/database';

export interface CompraDetalle {
  compra: Compra;
  items: CompraItem[];
  proveedor_nombre: string | null;
  proveedor_cuit: string | null;
  gasto: {
    id: number;
    fecha_pago: string | null;
    medio_pago: MedioPago | null;
  } | null;
}

export const COMPRA_DETALLE_QUERY_KEY = (id: number | null) =>
  ['compras', 'detalle', id] as const;

/**
 * Detalle de una compra. Trae cabecera + items + datos del proveedor y
 * del gasto vinculado. Solo se ejecuta cuando `id !== null` (el dialog
 * lo abre lazy al click en la fila).
 *
 * Devuelve TODOS los campos del 0041 (estado, fechas, condición de
 * pago, neto/IVA/total, condición fiscal snapshot, comprobante).
 */
export function useCompra(
  id: number | null,
): UseQueryResult<CompraDetalle, Error> {
  return useQuery<CompraDetalle, Error>({
    queryKey: COMPRA_DETALLE_QUERY_KEY(id),
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) throw new Error('Compra sin id.');

      const [cabRes, itemsRes] = await Promise.all([
        supabase
          .from('compras')
          .select(
            `
            *,
            proveedores:proveedor_id (nombre, cuit),
            gastos:gasto_id (id, fecha_pago, medio_pago)
            `,
          )
          .eq('id', id)
          .single(),
        supabase
          .from('compra_items')
          .select('*')
          .eq('compra_id', id)
          .order('id', { ascending: true }),
      ]);

      if (cabRes.error) throw new Error(mapPostgrestError(cabRes.error));
      if (itemsRes.error) throw new Error(mapPostgrestError(itemsRes.error));

      type CabRow = Compra & {
        proveedores: { nombre: string; cuit: string | null } | null;
        gastos: {
          id: number;
          fecha_pago: string | null;
          medio_pago: MedioPago | null;
        } | null;
      };

      const cab = cabRes.data as unknown as CabRow;
      const { proveedores: provEmbed, gastos: gastoEmbed, ...compra } = cab;

      return {
        compra: compra as Compra,
        items: (itemsRes.data ?? []) as CompraItem[],
        proveedor_nombre: provEmbed?.nombre ?? null,
        proveedor_cuit: provEmbed?.cuit ?? null,
        gasto: gastoEmbed
          ? {
              id: gastoEmbed.id,
              fecha_pago: gastoEmbed.fecha_pago,
              medio_pago: gastoEmbed.medio_pago,
            }
          : null,
      };
    },
  });
}
