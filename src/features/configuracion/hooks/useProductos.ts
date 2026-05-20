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
import type { Producto } from '@/types/database';
import { PRODUCTOS_CON_STOCK_QUERY_KEY } from './useProductosConStock';

export const PRODUCTOS_QUERY_KEY_BASE = 'productos';
export const PRODUCTOS_QUERY_KEY = [PRODUCTOS_QUERY_KEY_BASE] as const;

/**
 * Campos que el frontend envía al crear o actualizar. Omitimos `id` (DB),
 * `club_id` (sesión, RLS valida) y `fecha_alta` (DEFAULT NOW).
 */
export type ProductoInput = Omit<Producto, 'id' | 'club_id' | 'fecha_alta'>;

/**
 * Lista de productos del club ordenada por categoría → nombre.
 *
 * Esta query devuelve los productos "puros" (sin stock). Para listados
 * visuales que necesitan el stock, usar `useProductosConStock` (consume
 * la vista que joinea con la suma de movimientos en una sola query).
 *
 * Devuelve activos e inactivos; los consumidores filtran a su gusto
 * (ej. el catálogo del buffet sólo muestra activos).
 */
export function useProductos(): UseQueryResult<Producto[], Error> {
  return useQuery<Producto[], Error>({
    queryKey: PRODUCTOS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('*')
        .order('categoria', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Producto[];
    },
  });
}

export function useCreateProducto(): UseMutationResult<
  Producto,
  Error,
  ProductoInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Producto, Error, ProductoInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('productos')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      // El UNIQUE funcional sobre (club_id, lower(nombre)) puede rechazar
      // con SQLSTATE 23505. dbErrors lo mapea a "Ya existe un registro
      // con esos datos."; la UI lo muestra tal cual.
      if (error) throw new Error(mapPostgrestError(error));
      return data as Producto;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTOS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}

interface UpdateProductoArgs {
  id: number;
  changes: Partial<ProductoInput>;
}

export function useUpdateProducto(): UseMutationResult<
  Producto,
  Error,
  UpdateProductoArgs
> {
  const queryClient = useQueryClient();

  return useMutation<Producto, Error, UpdateProductoArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('productos')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Producto;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTOS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}

/**
 * Borrar un producto.
 *
 * Si el producto tiene movimientos de stock asociados, el trigger
 * `trg_productos_no_borrar_con_movimientos` (migración 0009) rechaza
 * con P0001 y mensaje accionable en castellano: "No se puede borrar el
 * producto porque tiene movimientos de stock registrados. Desactivalo
 * en su lugar (campo «Activo» en off)." dbErrors pasa P0001 directo, así
 * que el mensaje llega al usuario tal cual sin manejo extra acá.
 *
 * Si la UI quiere ofrecer la alternativa "desactivar" de un click cuando
 * el delete falla, puede capturar el throw y disparar useUpdateProducto
 * con activo=false. Capa 1 no lo automatiza.
 */
export function useDeleteProducto(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('productos').delete().eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTOS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}
