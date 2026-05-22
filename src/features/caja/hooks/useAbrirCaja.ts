import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { TurnoCaja } from '@/types/database';
import { CAJA_ABIERTA_QUERY_KEY } from './useCajaAbierta';

export interface AbrirCajaInput {
  montoApertura: number;
}

/**
 * Abre la caja del día. Invoca `fn_abrir_caja` (0022).
 *
 * Errores posibles (mapPostgrestError los pasa directo):
 *   - 'Ya hay una caja abierta. Cerrá la actual antes de abrir una nueva.'
 *   - 'No tenés permisos para abrir la caja.'
 *   - 'El monto de apertura es obligatorio y no puede ser negativo.'
 *   - 'Sin club asignado.'
 *
 * Al éxito invalida la query de caja abierta para que el panel
 * refresque al estado "caja abierta".
 */
export function useAbrirCaja(): UseMutationResult<
  TurnoCaja,
  Error,
  AbrirCajaInput
> {
  const queryClient = useQueryClient();
  return useMutation<TurnoCaja, Error, AbrirCajaInput>({
    mutationFn: async ({ montoApertura }) => {
      const { data, error } = await supabase.rpc('fn_abrir_caja', {
        p_monto_apertura: montoApertura,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('La función respondió sin datos. Refrescá el panel.');
      }
      return data as TurnoCaja;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CAJA_ABIERTA_QUERY_KEY });
    },
  });
}
