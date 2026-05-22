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
import type { Clase } from '@/types/database';

export const CLASES_QUERY_KEY_BASE = 'clases';
export const CLASES_QUERY_KEY = [CLASES_QUERY_KEY_BASE] as const;

/**
 * Clase enriquecida con el nombre del profesor (join contra profesores).
 * Es lo que necesitan tanto la tabla de Configuración → Clases como los
 * bloques de la grilla del día, sin tener que hacer un segundo fetch ni
 * cruzar manualmente con `useProfesores`.
 */
export interface ClaseConProfesor extends Clase {
  /** Datos mínimos del profesor referenciado. La FK NOT NULL garantiza que
   *  siempre haya algo, pero tipamos nullable por defensa contra cualquier
   *  inconsistencia. */
  profesor: { nombre: string } | null;
}

/**
 * Campos que el frontend envía al crear o actualizar una clase.
 *
 * Omitimos:
 *   - `id`: DB
 *   - `club_id`: sesión, RLS valida.
 *   - `fecha_alta`: DEFAULT NOW.
 *   - `precio`: deprecated (0035, modelo B). El alquiler de cancha se
 *     resuelve via fn_resolver_tarifa_clase. La columna queda con
 *     DEFAULT 0 server-side; el frontend deja de mandarla.
 */
export type ClaseInput = Omit<Clase, 'id' | 'club_id' | 'fecha_alta' | 'precio'>;

/**
 * Lista de clases del club, con el profesor joineado.
 *
 * Ordenadas por cancha y luego por hora de inicio: agrupa visualmente
 * las clases de cada cancha, en orden cronológico. Ayuda al admin a
 * escanear la tabla de configuración.
 *
 * Devuelve todas (activas e inactivas); los consumidores filtran a su
 * gusto (ej. la grilla del día sólo renderiza activas).
 */
export function useClases(): UseQueryResult<ClaseConProfesor[], Error> {
  return useQuery<ClaseConProfesor[], Error>({
    queryKey: CLASES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clases')
        .select('*, profesor:profesor_id(nombre)')
        .order('cancha_id', { ascending: true })
        .order('hora_inicio', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as unknown as ClaseConProfesor[];
    },
  });
}

export function useCreateClase(): UseMutationResult<Clase, Error, ClaseInput> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Clase, Error, ClaseInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('clases')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      // El trigger trg_clases_no_overlap_reservas puede rechazar con
      // P0001 + mensaje en castellano ("No se puede guardar la clase:
      // choca con una reserva del ..."). dbErrors pasa P0001 directo,
      // así que el mensaje llega al usuario tal cual.
      if (error) throw new Error(mapPostgrestError(error));
      return data as Clase;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLASES_QUERY_KEY });
    },
  });
}

interface UpdateClaseArgs {
  id: number;
  changes: Partial<ClaseInput>;
}

export function useUpdateClase(): UseMutationResult<
  Clase,
  Error,
  UpdateClaseArgs
> {
  const queryClient = useQueryClient();

  return useMutation<Clase, Error, UpdateClaseArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('clases')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      // Mismo trigger que en INSERT: si el cambio hace que la clase
      // ahora choque con una reserva futura, P0001 con mensaje claro.
      if (error) throw new Error(mapPostgrestError(error));
      return data as Clase;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLASES_QUERY_KEY });
    },
  });
}

export function useDeleteClase(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('clases').delete().eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLASES_QUERY_KEY });
    },
  });
}
