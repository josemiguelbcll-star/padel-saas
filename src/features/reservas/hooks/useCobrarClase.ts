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
  medio_pago: MedioPago;
  observaciones: string | null;
}

/**
 * Llama a la RPC fn_cobrar_clase (modelo B, 0035).
 *
 * Cambio respecto a la versión 0023:
 *   - YA NO se envía `monto` desde el frontend. El monto se RESUELVE
 *     server-side vía fn_resolver_tarifa_clase y se inserta en
 *     clase_cobros como snapshot.
 *   - Si no hay tarifa de clase configurada para el slot (fecha + hora
 *     de la clase), la RPC RAISE con mensaje accionable apuntando a
 *     Configuración → Tarifas → Clases.
 *
 * Errores que el usuario puede ver (todos mapeados por dbErrors):
 *   - "No hay tarifa de clase configurada para los {día} a las {hora}.
 *      Configurala en Configuración → Tarifas (pestaña Clases) antes
 *      de cobrar."
 *   - "La clase no se dicta el {fecha} — revisá los días configurados."
 *   - "El medio de pago es obligatorio."
 *   - "La clase no existe o no pertenece a tu club."
 *   - "No hay caja abierta..." (cuando es efectivo).
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
