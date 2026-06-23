import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Tarifa } from '@/types/database';

export const TARIFAS_QUERY_KEY = ['tarifas'] as const;

/**
 * Lista de tarifas del club, ordenada por prioridad DESC y nombre ASC.
 * Devuelve TODAS las versiones de TODOS los linajes — los consumidores
 * agrupan con `agruparPorLinaje` para mostrar la franja con su historial.
 */
export function useTarifas(): UseQueryResult<Tarifa[], Error> {
  return useQuery<Tarifa[], Error>({
    queryKey: TARIFAS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tarifas')
        .select('*')
        .order('prioridad', { ascending: false })
        .order('nombre', { ascending: true })
        .order('vigente_desde', { ascending: false });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Tarifa[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutos de cache activa
    gcTime: 10 * 60 * 1000,   // 10 minutos en garbage collector
  });
}

// ─── Crear franja nueva ──────────────────────────────────────────────

export interface CrearTarifaInput {
  nombre: string;
  monto: number;
  desde_hora?: string | null;
  hasta_hora?: string | null;
  dias_semana?: number[] | null;
  prioridad?: number;
  /** YYYY-MM-DD. Opcional, default 'hoy' server-side. Permite fecha futura. */
  vigente_desde?: string | null;
  /** Duración (minutos) a la que aplica (0051). NULL/undefined = cualquier
   *  duración. Solo tarifas de TURNOS; las de clases lo ignoran. */
  duracion_min?: number | null;
}

/**
 * Crea una franja nueva via RPC `fn_crear_tarifa` (0029).
 * La RPC se encarga del patrón autoreferente (lineage_id = id propio).
 */
export function useCrearTarifa(): UseMutationResult<
  Tarifa,
  Error,
  CrearTarifaInput
> {
  const queryClient = useQueryClient();
  return useMutation<Tarifa, Error, CrearTarifaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_crear_tarifa', {
        p_nombre: input.nombre,
        p_monto: input.monto,
        p_desde_hora: input.desde_hora ?? null,
        p_hasta_hora: input.hasta_hora ?? null,
        p_dias_semana: input.dias_semana ?? null,
        p_prioridad: input.prioridad ?? 0,
        p_vigente_desde: input.vigente_desde ?? null,
        p_duracion_min: input.duracion_min ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La función respondió sin datos. Refrescá la lista de tarifas.',
        );
      }
      return data as Tarifa;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_QUERY_KEY });
    },
  });
}

// ─── Cambiar precio (versionado) ─────────────────────────────────────

export interface CambiarPrecioInput {
  lineage_id: number;
  monto_nuevo: number;
  /** YYYY-MM-DD. Hoy o futuro. NO retroactivo. */
  vigente_desde: string;
}

/**
 * Versiona el precio de un linaje via `fn_cambiar_precio_tarifa` (0029).
 * Server-side cierra la versión actual y crea una nueva atómicamente.
 *
 * Errores mapeados:
 *  - 'La fecha debe ser hoy o futura...'
 *  - 'El precio nuevo es igual al actual...'
 *  - 'Ya hay una versión vigente desde...' (chocaría con aumento programado)
 *  - 'No hay versión del linaje X vigente en la fecha Y...'
 *  - 'Solo el administrador puede cambiar precios.'
 *  - 23P01: EXCLUDE constraint (solapamiento) — mapeado en dbErrors.
 */
export function useCambiarPrecioTarifa(): UseMutationResult<
  Tarifa,
  Error,
  CambiarPrecioInput
> {
  const queryClient = useQueryClient();
  return useMutation<Tarifa, Error, CambiarPrecioInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cambiar_precio_tarifa', {
        p_lineage_id: input.lineage_id,
        p_monto_nuevo: input.monto_nuevo,
        p_vigente_desde: input.vigente_desde,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('La función respondió sin datos.');
      }
      return data as Tarifa;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_QUERY_KEY });
    },
  });
}

// ─── Actualizar metadata (nombre/franja/días/prioridad/activa) ──────

export interface ActualizarMetadataInput {
  lineage_id: number;
  nombre?: string;
  desde_hora?: string | null;
  hasta_hora?: string | null;
  dias_semana?: number[] | null;
  prioridad?: number;
  activa?: boolean;
  /** Forzar a NULL la franja horaria (`desde_hora` y `hasta_hora`). */
  clear_franja_horaria?: boolean;
  /** Forzar a NULL los días de la semana. */
  clear_dias_semana?: boolean;
  /** Duración (minutos) a setear (0051). Solo tarifas de turnos. */
  duracion_min?: number | null;
  /** Forzar a NULL la duración (= cualquier duración). */
  clear_duracion?: boolean;
}

/**
 * Actualiza metadata de TODAS las versiones del linaje via
 * `fn_actualizar_metadata_tarifa` (0029). NO toca vigencia ni monto.
 */
export function useActualizarMetadataTarifa(): UseMutationResult<
  number, // cantidad de versiones afectadas
  Error,
  ActualizarMetadataInput
> {
  const queryClient = useQueryClient();
  return useMutation<number, Error, ActualizarMetadataInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'fn_actualizar_metadata_tarifa',
        {
          p_lineage_id: input.lineage_id,
          p_nombre: input.nombre ?? null,
          p_desde_hora: input.desde_hora ?? null,
          p_hasta_hora: input.hasta_hora ?? null,
          p_dias_semana: input.dias_semana ?? null,
          p_prioridad: input.prioridad ?? null,
          p_activa: input.activa ?? null,
          p_clear_franja_horaria: input.clear_franja_horaria ?? false,
          p_clear_dias_semana: input.clear_dias_semana ?? false,
          p_duracion_min: input.duracion_min ?? null,
          p_clear_duracion: input.clear_duracion ?? false,
        },
      );
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? 0) as number;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_QUERY_KEY });
    },
  });
}
