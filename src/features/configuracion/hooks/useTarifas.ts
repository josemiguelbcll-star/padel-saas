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
import type { Tarifa } from '@/types/database';

export const TARIFAS_QUERY_KEY = ['tarifas'] as const;

/**
 * Campos que el frontend envía al crear o actualizar una tarifa.
 * `monto`, franjas y días pueden venir nulos cuando se trata de la
 * "tarifa única" del wizard.
 */
export type TarifaInput = Omit<Tarifa, 'id' | 'club_id'>;

/**
 * Lista de tarifas del club, ordenada por prioridad DESC y nombre ASC.
 * Mostrar primero las tarifas que efectivamente se aplicarían en caso
 * de superposición ayuda al admin a entender el orden de resolución.
 */
export function useTarifas(): UseQueryResult<Tarifa[], Error> {
  return useQuery<Tarifa[], Error>({
    queryKey: TARIFAS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tarifas')
        .select('*')
        .order('prioridad', { ascending: false })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Tarifa[];
    },
  });
}

export function useCreateTarifa(): UseMutationResult<Tarifa, Error, TarifaInput> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Tarifa, Error, TarifaInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('tarifas')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Tarifa;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_QUERY_KEY });
    },
  });
}

interface UpdateTarifaArgs {
  id: number;
  changes: Partial<TarifaInput>;
}

export function useUpdateTarifa(): UseMutationResult<Tarifa, Error, UpdateTarifaArgs> {
  const queryClient = useQueryClient();

  return useMutation<Tarifa, Error, UpdateTarifaArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('tarifas')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Tarifa;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_QUERY_KEY });
    },
  });
}

export function useDeleteTarifa(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('tarifas').delete().eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_QUERY_KEY });
    },
  });
}
