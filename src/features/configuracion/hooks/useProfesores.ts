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
import type { Profesor } from '@/types/database';
import { CLASES_QUERY_KEY_BASE } from './useClases';

export const PROFESORES_QUERY_KEY = ['profesores'] as const;

/**
 * Campos que el frontend envía al crear o actualizar un profesor.
 * Omitimos `id` (lo genera la DB), `club_id` (se inyecta desde la sesión,
 * RLS valida), y `fecha_alta` (DEFAULT NOW).
 */
export type ProfesorInput = Omit<Profesor, 'id' | 'club_id' | 'fecha_alta'>;

/**
 * Lista de profesores del club, ordenada alfabéticamente. Devuelve
 * todos (activos e inactivos); las pantallas filtran a su gusto
 * (ej. el dropdown de "elegir profesor" en ClaseFormDialog muestra
 * sólo activos).
 */
export function useProfesores(): UseQueryResult<Profesor[], Error> {
  return useQuery<Profesor[], Error>({
    queryKey: PROFESORES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profesores')
        .select('*')
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Profesor[];
    },
  });
}

export function useCreateProfesor(): UseMutationResult<
  Profesor,
  Error,
  ProfesorInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Profesor, Error, ProfesorInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('profesores')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Profesor;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFESORES_QUERY_KEY });
    },
  });
}

interface UpdateProfesorArgs {
  id: number;
  changes: Partial<ProfesorInput>;
}

export function useUpdateProfesor(): UseMutationResult<
  Profesor,
  Error,
  UpdateProfesorArgs
> {
  const queryClient = useQueryClient();

  return useMutation<Profesor, Error, UpdateProfesorArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('profesores')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Profesor;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFESORES_QUERY_KEY });
      // El join de useClases trae profesor.nombre. Si el admin renombró
      // un profesor, refrescamos la lista de clases también para que la
      // tabla de configuración y los bloques de la grilla muestren el
      // nombre actualizado.
      void queryClient.invalidateQueries({ queryKey: [CLASES_QUERY_KEY_BASE] });
    },
  });
}

export function useDeleteProfesor(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('profesores').delete().eq('id', id);
      // Si el profesor tiene clases asociadas, la FK (sin CASCADE) hace
      // que Postgres rechace con 23503. dbErrors lo traduce a "No se
      // puede completar la operación porque hay registros vinculados."
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFESORES_QUERY_KEY });
    },
  });
}
