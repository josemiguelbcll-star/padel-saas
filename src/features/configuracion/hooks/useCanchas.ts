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
import type { Cancha } from '@/types/database';

/**
 * Cache key compartido por las queries y las invalidaciones del recurso.
 * Lo exportamos por si algún componente externo (ej. el wizard) necesita
 * forzar refetch tras un alta múltiple.
 */
export const CANCHAS_QUERY_KEY = ['canchas'] as const;

/**
 * Campos que el frontend envía al crear o actualizar una cancha.
 * Omitimos `id` (lo genera la DB) y `club_id` (lo agregamos desde la
 * sesión activa, RLS valida que coincida).
 */
export type CanchaInput = Omit<Cancha, 'id' | 'club_id'>;

/**
 * Lista de canchas del club. Las pedimos ordenadas en el SERVIDOR por
 * `orden` ASC y desempate por `nombre` ASC, así la UI se limita a
 * renderizar lo que llega sin reordenar.
 */
export function useCanchas(): UseQueryResult<Cancha[], Error> {
  return useQuery<Cancha[], Error>({
    queryKey: CANCHAS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canchas')
        .select('*')
        .order('orden', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Cancha[];
    },
  });
}

export function useCreateCancha(): UseMutationResult<Cancha, Error, CanchaInput> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Cancha, Error, CanchaInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('canchas')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Cancha;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CANCHAS_QUERY_KEY });
    },
  });
}

interface UpdateCanchaArgs {
  id: number;
  changes: Partial<CanchaInput>;
}

export function useUpdateCancha(): UseMutationResult<Cancha, Error, UpdateCanchaArgs> {
  const queryClient = useQueryClient();

  return useMutation<Cancha, Error, UpdateCanchaArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('canchas')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Cancha;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CANCHAS_QUERY_KEY });
    },
  });
}

export function useDeleteCancha(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('canchas').delete().eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CANCHAS_QUERY_KEY });
    },
  });
}
