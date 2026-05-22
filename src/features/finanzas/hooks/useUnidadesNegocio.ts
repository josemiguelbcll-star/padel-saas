import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { TipoUnidad, UnidadNegocio } from '@/types/database';

export const UNIDADES_NEGOCIO_QUERY_KEY = ['unidades_negocio'] as const;

/**
 * Lista de unidades de negocio del club. Ordenadas por `orden` ASC.
 * Devuelve activas e inactivas; los consumidores filtran a su gusto.
 */
export function useUnidadesNegocio(): UseQueryResult<UnidadNegocio[], Error> {
  return useQuery<UnidadNegocio[], Error>({
    queryKey: UNIDADES_NEGOCIO_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unidades_negocio')
        .select('*')
        .order('orden', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as UnidadNegocio[];
    },
  });
}

export interface CrearUnidadInput {
  /** Club al que pertenece — viene del useSession del caller. */
  club_id: number;
  nombre: string;
  tipo: TipoUnidad;
  orden?: number;
}

/**
 * INSERT directo (sin RPC). La RLS valida server-side: solo admin del
 * propio club puede insertar. El UNIQUE parcial sobre tipos automáticos
 * (canchas/buffet/shop/clases) puede disparar 23505 →
 * mapPostgrestError lo traduce.
 */
export function useCrearUnidad(): UseMutationResult<
  UnidadNegocio,
  Error,
  CrearUnidadInput
> {
  const queryClient = useQueryClient();
  return useMutation<UnidadNegocio, Error, CrearUnidadInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase
        .from('unidades_negocio')
        .insert({
          club_id: input.club_id,
          nombre: input.nombre.trim(),
          tipo: input.tipo,
          orden: input.orden ?? 0,
        })
        .select('*')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as UnidadNegocio;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: UNIDADES_NEGOCIO_QUERY_KEY });
    },
  });
}

export interface UpdateUnidadInput {
  id: number;
  changes: Partial<Pick<UnidadNegocio, 'nombre' | 'tipo' | 'activa' | 'orden'>>;
}

export function useUpdateUnidad(): UseMutationResult<
  UnidadNegocio,
  Error,
  UpdateUnidadInput
> {
  const queryClient = useQueryClient();
  return useMutation<UnidadNegocio, Error, UpdateUnidadInput>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('unidades_negocio')
        .update({
          ...(changes.nombre !== undefined ? { nombre: changes.nombre.trim() } : {}),
          ...(changes.tipo !== undefined ? { tipo: changes.tipo } : {}),
          ...(changes.activa !== undefined ? { activa: changes.activa } : {}),
          ...(changes.orden !== undefined ? { orden: changes.orden } : {}),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as UnidadNegocio;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: UNIDADES_NEGOCIO_QUERY_KEY });
    },
  });
}
