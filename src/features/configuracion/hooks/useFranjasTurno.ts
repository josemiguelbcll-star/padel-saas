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
import type { FranjaTurno } from '@/types/database';

export const FRANJAS_TURNO_QUERY_KEY = ['franjas-turno'] as const;

/**
 * Campos que el frontend envía al crear/actualizar una franja de turno.
 * Omitimos `id` (lo genera la DB) y `club_id` (se agrega desde la sesión;
 * la RLS valida que coincida). ABM admin-only via RLS (sin RPC: no hay
 * versionado ni multi-paso atómico — a diferencia de tarifas).
 */
export type FranjaTurnoInput = Omit<FranjaTurno, 'id' | 'club_id'>;

/**
 * Franjas de turno del club, ordenadas por hora de inicio. Las consume
 * la grilla (resolverDuraciones / calcularDisponibles, BLOQUE 3) y el
 * ABM de Configuración → Horarios (BLOQUE 2).
 */
export function useFranjasTurno(): UseQueryResult<FranjaTurno[], Error> {
  return useQuery<FranjaTurno[], Error>({
    queryKey: FRANJAS_TURNO_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('franjas_turno')
        .select('*')
        .order('desde_hora', { ascending: true, nullsFirst: true })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as FranjaTurno[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutos de cache en memoria
  });
}

export function useCrearFranjaTurno(): UseMutationResult<
  FranjaTurno,
  Error,
  FranjaTurnoInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<FranjaTurno, Error, FranjaTurnoInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('franjas_turno')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as FranjaTurno;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FRANJAS_TURNO_QUERY_KEY });
    },
  });
}

interface ActualizarFranjaTurnoArgs {
  id: number;
  changes: Partial<FranjaTurnoInput>;
}

export function useActualizarFranjaTurno(): UseMutationResult<
  FranjaTurno,
  Error,
  ActualizarFranjaTurnoArgs
> {
  const queryClient = useQueryClient();

  return useMutation<FranjaTurno, Error, ActualizarFranjaTurnoArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('franjas_turno')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as FranjaTurno;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FRANJAS_TURNO_QUERY_KEY });
    },
  });
}

export function useEliminarFranjaTurno(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('franjas_turno')
        .delete()
        .eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FRANJAS_TURNO_QUERY_KEY });
    },
  });
}
