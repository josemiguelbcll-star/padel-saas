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
import type {
  ReservaConsumo,
  TipoRepartoConsumo,
} from '@/types/database';

export const RESERVA_CONSUMOS_QUERY_KEY_BASE = 'reserva_consumos';

function reservaConsumosQueryKey(reservaId: number) {
  return [RESERVA_CONSUMOS_QUERY_KEY_BASE, reservaId] as const;
}

/**
 * Lista de consumos del turno, ordenada cronológicamente (orden de carga).
 * La UI puede agrupar por producto_id en render pero la fuente de verdad
 * es 1 fila = 1 carga (preserva la historia: "se cargó esta Coca a las
 * 10:32 y la otra a las 10:45").
 *
 * Si `reservaId` es null no dispara la query.
 */
export function useReservaConsumos(
  reservaId: number | null,
): UseQueryResult<ReservaConsumo[], Error> {
  return useQuery<ReservaConsumo[], Error>({
    queryKey: reservaId === null
      ? [RESERVA_CONSUMOS_QUERY_KEY_BASE]
      : reservaConsumosQueryKey(reservaId),
    queryFn: async () => {
      if (reservaId === null) return [];
      const { data, error } = await supabase
        .from('reserva_consumos')
        .select('*')
        .eq('reserva_id', reservaId)
        .order('fecha_hora', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ReservaConsumo[];
    },
    enabled: reservaId !== null,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Mutaciones del paso 2
// ─────────────────────────────────────────────────────────────────────

export interface CargarConsumoTurnoInput {
  reserva_id: number;
  producto_id: number;
  /** INT > 0. La RPC valida que haya stock suficiente. */
  cantidad: number;
  /**
   * Cómo se reparte el consumo entre las personas del turno.
   * Agregado en la 0015 — REQUIRED (la RPC no tiene default).
   *   - 'partido': sólo entre jugadores (ej. tarro de pelotas).
   *   - 'general': entre todos (default operativo del catálogo —
   *     bebidas, snacks).
   */
  tipo_reparto: TipoRepartoConsumo;
}

/**
 * Llama a la RPC fn_cargar_consumo_turno (migración 0013). En una sola
 * transacción inserta el consumo (con snapshot de nombre/precio/costo)
 * + el movimiento de stock de salida (fuente='consumo_turno').
 *
 * Errores que el usuario puede ver (todos mapeados por dbErrors):
 *   - "La cantidad debe ser mayor a 0."
 *   - "La reserva no existe o no pertenece a tu club."
 *   - "No se pueden cargar consumos a una reserva cancelada."
 *   - "El producto no existe o no pertenece a tu club."
 *   - "El producto «X» está desactivado, no se puede vender."
 *   - "Stock insuficiente de «X»: hay Y unidades, querés cargar Z."
 *
 * Al éxito invalida:
 *   - ['reserva_consumos', reservaId]   → la sección Consumos del detalle.
 *   - PRODUCTOS_CON_STOCK_QUERY_KEY     → el catálogo embebido y la
 *                                          tabla de productos refrescan
 *                                          el stock real.
 */
export function useCargarConsumoTurno(): UseMutationResult<
  ReservaConsumo,
  Error,
  CargarConsumoTurnoInput
> {
  const queryClient = useQueryClient();

  return useMutation<ReservaConsumo, Error, CargarConsumoTurnoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cargar_consumo_turno', {
        p_reserva_id: input.reserva_id,
        p_producto_id: input.producto_id,
        p_cantidad: input.cantidad,
        p_tipo_reparto: input.tipo_reparto,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'El consumo se procesó pero no recibimos los datos actualizados. Refrescá la grilla.',
        );
      }
      return data as ReservaConsumo;
    },
    onSuccess: (consumo) => {
      void queryClient.invalidateQueries({
        queryKey: reservaConsumosQueryKey(consumo.reserva_id),
      });
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}

export interface QuitarConsumoTurnoInput {
  consumo_id: number;
  /** Sólo para invalidación del query key; no se manda a la RPC. */
  reserva_id: number;
}

/**
 * Llama a la RPC fn_quitar_consumo_turno (migración 0013, Modelo B). En
 * una sola transacción: inserta un movimiento de reposición
 * (fuente='reposicion_consumo', cantidad positiva, observaciones con el
 * contexto) y borra la fila de reserva_consumos. El movimiento de
 * SALIDA original NO se borra (ON DELETE SET NULL del FK preserva la
 * evidencia histórica del libro).
 *
 * Stock neto del producto: vuelve al valor previo a la carga del consumo.
 *
 * Errores que el usuario puede ver:
 *   - "El consumo no existe o no pertenece a tu club."
 *
 * Al éxito invalida las mismas dos query keys que la carga (la sección
 * Consumos refresca y el stock vuelve a verse repuesto en el catálogo).
 */
export function useQuitarConsumoTurno(): UseMutationResult<
  void,
  Error,
  QuitarConsumoTurnoInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, QuitarConsumoTurnoInput>({
    mutationFn: async ({ consumo_id }) => {
      const { error } = await supabase.rpc('fn_quitar_consumo_turno', {
        p_consumo_id: consumo_id,
      });
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: reservaConsumosQueryKey(input.reserva_id),
      });
      void queryClient.invalidateQueries({
        queryKey: PRODUCTOS_CON_STOCK_QUERY_KEY,
      });
    },
  });
}
