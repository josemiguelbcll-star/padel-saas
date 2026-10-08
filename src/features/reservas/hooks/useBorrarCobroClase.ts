import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { CLASE_COBROS_QUERY_KEY_BASE } from './useCobrosDelDia';

export interface BorrarCobroClaseInput {
  cobroId: number;
  /** Fecha de la ocurrencia ('YYYY-MM-DD') para invalidar la query correcta. */
  fecha: string;
}

/**
 * DELETE directo via supabase-js (sin RPC). La RLS
 * `clase_cobros_delete_solo_admin` gatea por rol; un vendedor que llegue
 * acá (vía consola o forzado) recibe SQLSTATE 42501, que dbErrors mapea
 * a "No tenés permisos para esta acción."
 *
 * El frontend gatea el botón "Borrar" cosméticamente con `useSession()`,
 * pero la seguridad real es la RLS.
 *
 * Al éxito invalida ['clase_cobros', fecha] → la grilla refresca el
 * tilde (si era el último pago de la ocurrencia, el tilde desaparece)
 * y el dialog refresca su lista de pagos.
 */
export function useBorrarCobroClase(): UseMutationResult<
  void,
  Error,
  BorrarCobroClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, BorrarCobroClaseInput>({
    mutationFn: async ({ cobroId }) => {
      // 1. Intentar RPC con SECURITY DEFINER (soporta admin y vendedor)
      const { error: rpcError } = await supabase.rpc('fn_borrar_cobro_clase', {
        p_cobro_id: cobroId,
      });

      if (!rpcError) return;

      // 2. Fallback a delete directo con .select() para verificar que realmente se borró
      const { data, error: delError } = await supabase
        .from('clase_cobros')
        .delete()
        .eq('id', cobroId)
        .select();

      if (delError) throw new Error(mapPostgrestError(delError));
      if (data && data.length === 0) {
        throw new Error('No se pudo eliminar el cobro. Verificá los permisos de tu usuario.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [CLASE_COBROS_QUERY_KEY_BASE],
      });
      void queryClient.invalidateQueries({
        queryKey: ['caja-abierta-resumen'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['clase_alumnos'],
      });
    },
  });
}
