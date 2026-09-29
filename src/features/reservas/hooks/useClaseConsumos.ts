import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { PRODUCTOS_CON_STOCK_QUERY_KEY } from '@/features/configuracion/hooks/useProductosConStock';
import type { ClaseConsumo } from '@/types/database';

export const CLASE_CONSUMOS_QUERY_KEY_BASE = 'clase_consumos';

export function claseConsumosQueryKey(claseId: number, fecha: string) {
  return [CLASE_CONSUMOS_QUERY_KEY_BASE, claseId, fecha] as const;
}

export function useClaseConsumos(
  claseId: number | null,
  fecha: string | null,
): UseQueryResult<ClaseConsumo[], Error> {
  return useQuery<ClaseConsumo[], Error>({
    queryKey: claseId !== null && fecha !== null
      ? claseConsumosQueryKey(claseId, fecha)
      : [CLASE_CONSUMOS_QUERY_KEY_BASE],
    queryFn: async () => {
      if (claseId === null || fecha === null) return [];
      const { data, error } = await supabase
        .from('clase_consumos')
        .select('*')
        .eq('clase_id', claseId)
        .eq('fecha', fecha)
        .order('fecha_hora', { ascending: true })
        .order('id', { ascending: true });

      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ClaseConsumo[];
    },
    enabled: claseId !== null && fecha !== null,
  });
}

export interface CargarConsumoClaseInput {
  clase_id: number;
  fecha: string;
  producto_id: number;
  cantidad: number;
  clase_alumno_id?: number | null;
}

export function useCargarConsumoClase(): UseMutationResult<
  ClaseConsumo,
  Error,
  CargarConsumoClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cargar_consumo_clase', {
        p_clase_id: input.clase_id,
        p_fecha: input.fecha,
        p_producto_id: input.producto_id,
        p_cantidad: input.cantidad,
        p_clase_alumno_id: input.clase_alumno_id ?? null,
      });

      if (error) throw new Error(mapPostgrestError(error));
      return data as ClaseConsumo;
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: claseConsumosQueryKey(input.clase_id, input.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}

export interface QuitarConsumoClaseInput {
  consumo_id: number;
  clase_id: number;
  fecha: string;
}

export function useQuitarConsumoClase(): UseMutationResult<
  boolean,
  Error,
  QuitarConsumoClaseInput
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_quitar_consumo_clase', {
        p_consumo_id: input.consumo_id,
      });

      if (error) throw new Error(mapPostgrestError(error));
      return !!data;
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: claseConsumosQueryKey(input.clase_id, input.fecha),
      });
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}
