import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Compra } from '@/types/database';

export interface CancelarOCInput {
  compra_id: number;
  motivo?: string | null;
}

/**
 * Cancela una OC en estado='pedida' via RPC `fn_cancelar_oc` (0041).
 * Soft: solo cambia estado a 'cancelada' y opcionalmente concatena el
 * motivo a observaciones. NO toca stock, costo, gasto (la OC nunca los
 * impactó). Irreversible en este bloque.
 *
 * Rechaza si la OC ya está recibida o cancelada.
 */
export function useCancelarOC(): UseMutationResult<
  Compra,
  Error,
  CancelarOCInput
> {
  const queryClient = useQueryClient();

  return useMutation<Compra, Error, CancelarOCInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cancelar_oc', {
        p_compra_id: input.compra_id,
        p_motivo: input.motivo ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La OC se canceló pero no recibimos los datos. Refrescá la lista.',
        );
      }
      return data as Compra;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compras'] });
    },
  });
}
