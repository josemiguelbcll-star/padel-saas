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
import { CACHE_TIEMPO_ESTATICO } from '@/lib/queryClient';
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
  const { club } = useSession();

  return useQuery<Cancha[], Error>({
    queryKey: [...CANCHAS_QUERY_KEY, club?.id],
    queryFn: async () => {
      let query = supabase
        .from('canchas')
        .select('*, tarifa:tarifas(id, nombre, monto)')
        .order('orden', { ascending: true })
        .order('nombre', { ascending: true });

      if (club?.id) {
        query = query.eq('club_id', club.id);
      }

      let { data, error } = await query;

      if (error) {
        // Fallback si la relación no está disponible
        let fallbackQuery = supabase
          .from('canchas')
          .select('*')
          .order('orden', { ascending: true })
          .order('nombre', { ascending: true });

        if (club?.id) {
          fallbackQuery = fallbackQuery.eq('club_id', club.id);
        }

        const fallbackRes = await fallbackQuery;
        if (fallbackRes.error) throw new Error(mapPostgrestError(fallbackRes.error));
        return (fallbackRes.data ?? []) as Cancha[];
      }

      return (data ?? []) as Cancha[];
    },
    staleTime: CACHE_TIEMPO_ESTATICO,
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
      const payload: Record<string, any> = { ...input, club_id: club.id };
      let { data, error } = await supabase
        .from('canchas')
        .insert(payload)
        .select('*, tarifa:tarifas(id, nombre, monto)')
        .single();

      // Si la columna `tarifa_id` o `deporte` aún no fue agregada en Supabase (PGRST204), hacemos fallback progresivo
      if (error && (error.code === 'PGRST204' || error.message?.includes('tarifa_id') || error.message?.includes('deporte'))) {
        const cleanPayload = { ...payload };
        if (error.message?.includes('tarifa_id') || error.code === 'PGRST204') {
          delete cleanPayload.tarifa_id;
        }
        if (error.message?.includes('deporte') || error.code === 'PGRST204') {
          const dep = cleanPayload.deporte;
          delete cleanPayload.deporte;
          if (dep && dep !== 'padel') {
            cleanPayload.tipo = cleanPayload.tipo ? `${dep} (${cleanPayload.tipo})` : dep;
          }
        }
        const fallbackRes = await supabase
          .from('canchas')
          .insert(cleanPayload)
          .select()
          .single();
        data = fallbackRes.data;
        error = fallbackRes.error;
      }

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
      let { data, error } = await supabase
        .from('canchas')
        .update(changes)
        .eq('id', id)
        .select('*, tarifa:tarifas(id, nombre, monto)')
        .single();

      // Si la columna `tarifa_id` o `deporte` falla por schema
      if (error && (error.code === 'PGRST204' || error.message?.includes('tarifa_id') || error.message?.includes('deporte'))) {
        const cleanChanges = { ...changes } as Record<string, any>;
        if (error.message?.includes('tarifa_id') || error.code === 'PGRST204') {
          delete cleanChanges.tarifa_id;
        }
        if (error.message?.includes('deporte') || error.code === 'PGRST204') {
          const dep = cleanChanges.deporte;
          delete cleanChanges.deporte;
          if (dep && dep !== 'padel') {
            cleanChanges.tipo = cleanChanges.tipo ? `${dep} (${cleanChanges.tipo})` : dep;
          }
        }
        const fallbackRes = await supabase
          .from('canchas')
          .update(cleanChanges)
          .eq('id', id)
          .select()
          .single();
        data = fallbackRes.data;
        error = fallbackRes.error;
      }

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
