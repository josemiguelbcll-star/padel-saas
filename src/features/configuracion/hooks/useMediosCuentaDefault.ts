import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { MedioCuentaDefault, MedioPago } from '@/types/database';

export const MEDIOS_CUENTA_DEFAULT_QUERY_KEY = ['medios-cuenta-default'] as const;

/**
 * Mapeo medio→cuenta por defecto del club. La ausencia de fila para un
 * medio = ese medio no tiene cuenta por defecto.
 */
export function useMediosCuentaDefault(): UseQueryResult<
  MedioCuentaDefault[],
  Error
> {
  return useQuery<MedioCuentaDefault[], Error>({
    queryKey: MEDIOS_CUENTA_DEFAULT_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medio_cuenta_default')
        .select('*');
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as MedioCuentaDefault[];
    },
  });
}

export interface SetMedioCuentaDefaultInput {
  medio_pago: MedioPago;
  cuenta_id: number;
}

/**
 * Asigna (o re-asigna) la cuenta por defecto de un medio. Upsert sobre la
 * PK (club_id, medio_pago): si ya había default, lo reemplaza.
 */
export function useSetMedioCuentaDefault(): UseMutationResult<
  MedioCuentaDefault,
  Error,
  SetMedioCuentaDefaultInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<MedioCuentaDefault, Error, SetMedioCuentaDefaultInput>({
    mutationFn: async ({ medio_pago, cuenta_id }) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('medio_cuenta_default')
        .upsert(
          { club_id: club.id, medio_pago, cuenta_id },
          { onConflict: 'club_id,medio_pago' },
        )
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as MedioCuentaDefault;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: MEDIOS_CUENTA_DEFAULT_QUERY_KEY,
      });
    },
  });
}

/**
 * Quita el default de un medio (vuelve a "sin asignar" → en Etapa 2 el
 * operador elige la cuenta al cobrar).
 */
export function useQuitarMedioCuentaDefault(): UseMutationResult<
  void,
  Error,
  MedioPago
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<void, Error, MedioPago>({
    mutationFn: async (medio_pago) => {
      if (!club) {
        throw new Error('No pudimos identificar tu club.');
      }
      const { error } = await supabase
        .from('medio_cuenta_default')
        .delete()
        .eq('club_id', club.id)
        .eq('medio_pago', medio_pago);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: MEDIOS_CUENTA_DEFAULT_QUERY_KEY,
      });
    },
  });
}
