import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ClaseCobro, MedioPago } from '@/types/database';
import { CLASE_COBROS_QUERY_KEY_BASE } from './useCobrosDelDia';

export interface CobrarClaseInput {
  clase_id: number;
  /** 'YYYY-MM-DD' — fecha puntual de la ocurrencia. */
  fecha: string;
  monto: number;
  medio_pago: MedioPago;
  observaciones: string | null;
}

/**
 * Llama a la RPC fn_cobrar_clase (migración 0007), que en una sola
 * transacción valida la ocurrencia (weekday + no-cobro-previo) e
 * inserta el registro en clase_cobros.
 *
 * Errores que el usuario puede ver (todos mapeados por dbErrors):
 *   - "La clase del 2026-05-20 ya fue cobrada."
 *   - "La clase no se dicta el 2026-05-20 — revisá los días configurados."
 *   - "El monto a cobrar debe ser mayor a 0."
 *   - "El medio de pago es obligatorio."
 *   - "La clase no existe o no pertenece a tu club."
 *   - Plus los genéricos de RLS y network.
 *
 * Al éxito invalida ['clase_cobros', fecha] → la grilla refresca el
 * tilde de "pagada" sobre el bloque de la clase cobrada.
 */
export function useCobrarClase(): UseMutationResult<
  ClaseCobro,
  Error,
  CobrarClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation<ClaseCobro, Error, CobrarClaseInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cobrar_clase', {
        p_clase_id: input.clase_id,
        p_fecha: input.fecha,
        p_monto: input.monto,
        p_medio_pago: input.medio_pago,
        p_observaciones: input.observaciones,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'El cobro se procesó pero no recibimos los datos actualizados. Refrescá la grilla.',
        );
      }
      return data as ClaseCobro;
    },
    onSuccess: (cobro) => {
      void queryClient.invalidateQueries({
        queryKey: [CLASE_COBROS_QUERY_KEY_BASE, cobro.fecha],
      });
    },
  });
}
