import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Compra, CondicionPago, Linea } from '@/types/database';

export interface CrearOCItemInput {
  producto_id: number;
  cantidad_bultos: number;
  unidades_por_bulto: number;
  /** NETO (sin IVA — el IVA se carga al recibir). */
  costo_por_bulto: number;
}

export interface CrearOCInput {
  proveedor_id: number;
  linea: Linea;
  fecha_oc: string;                       // YYYY-MM-DD
  items: CrearOCItemInput[];
  condicion_pago: CondicionPago;
  /** YYYY-MM-DD si condicion_pago='a_plazo'. Null en los demás casos. */
  fecha_compromiso_pago: string | null;
  observaciones?: string | null;
}

/**
 * Crea una OC en estado='pedida' via RPC `fn_crear_oc` (0041). NO toca
 * stock ni costo ni gasto — la OC es solo el documento de pedido.
 *
 * Al éxito solo invalida `['compras']` (sin tocar inventario, gastos,
 * finanzas o caja porque la OC no impacta nada de eso).
 *
 * Mensajes posibles (de la RPC, vienen mapeados):
 *   - 'Solo el administrador puede crear órdenes de compra.'
 *   - 'La línea de la OC debe ser buffet o shop.'
 *   - 'Condición de pago inválida (al_dia, a_plazo o al_recibir).'
 *   - 'Si la condición es "a plazo", indicá la fecha de compromiso de pago.'
 *   - 'El proveedor no existe o no pertenece a tu club.'
 *   - 'El proveedor "X" está desactivado...'
 *   - 'Tu club no tiene una categoría marcada como mercadería para la unidad de X.'
 *   - 'Hay productos duplicados en la OC.'
 *   - 'La cantidad de bultos debe ser mayor a 0 (item X).'
 *   - 'El producto "X" es de la línea Y, no podés cargarlo en una OC de Z.'
 */
export function useCrearOC(): UseMutationResult<Compra, Error, CrearOCInput> {
  const queryClient = useQueryClient();

  return useMutation<Compra, Error, CrearOCInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_crear_oc', {
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
