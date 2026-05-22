import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { CategoriaGasto } from '@/types/database';

export const CATEGORIAS_GASTO_QUERY_KEY = ['categorias_gasto'] as const;

/**
 * Lista de categorías de gasto del club. Ordenadas por unidad_id +
 * orden para que el agrupamiento por unidad sea consistente.
 * Devuelve activas e inactivas.
 */
export function useCategoriasGasto(): UseQueryResult<CategoriaGasto[], Error> {
  return useQuery<CategoriaGasto[], Error>({
    queryKey: CATEGORIAS_GASTO_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categorias_gasto')
        .select('*')
        .order('unidad_id', { ascending: true })
        .order('orden', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as CategoriaGasto[];
    },
  });
}

export interface CrearCategoriaInput {
  club_id: number;
  unidad_id: number;
  nombre: string;
  orden?: number;
}

/**
 * INSERT directo (sin RPC). RLS: solo admin del club. UNIQUE
 * (club_id, unidad_id, lower(nombre)) puede disparar 23505 si se
 * intenta crear duplicado dentro de la misma unidad.
 */
export function useCrearCategoria(): UseMutationResult<
  CategoriaGasto,
  Error,
  CrearCategoriaInput
> {
  const queryClient = useQueryClient();
  return useMutation<CategoriaGasto, Error, CrearCategoriaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase
        .from('categorias_gasto')
        .insert({
          club_id: input.club_id,
          unidad_id: input.unidad_id,
          nombre: input.nombre.trim(),
          orden: input.orden ?? 0,
        })
        .select('*')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as CategoriaGasto;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIAS_GASTO_QUERY_KEY });
    },
  });
}

export interface UpdateCategoriaInput {
  id: number;
  changes: Partial<
    Pick<CategoriaGasto, 'nombre' | 'unidad_id' | 'activa' | 'orden'>
  >;
}

export function useUpdateCategoria(): UseMutationResult<
  CategoriaGasto,
  Error,
  UpdateCategoriaInput
> {
  const queryClient = useQueryClient();
  return useMutation<CategoriaGasto, Error, UpdateCategoriaInput>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('categorias_gasto')
        .update({
          ...(changes.nombre !== undefined ? { nombre: changes.nombre.trim() } : {}),
          ...(changes.unidad_id !== undefined ? { unidad_id: changes.unidad_id } : {}),
          ...(changes.activa !== undefined ? { activa: changes.activa } : {}),
          ...(changes.orden !== undefined ? { orden: changes.orden } : {}),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as CategoriaGasto;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATEGORIAS_GASTO_QUERY_KEY });
    },
  });
}
