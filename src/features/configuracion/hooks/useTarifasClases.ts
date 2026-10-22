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
import type {
  ActualizarMetadataInput,
  CambiarPrecioInput,
  CrearTarifaInput,
} from './useTarifas';

/**
 * Hooks para tarifas de CLASES (0034). Espejo exacto de useTarifas.ts
 * apuntando a la tabla `tarifas_clases` y a las RPCs `fn_*_tarifa_clase`.
 *
 * Las tarifas de clases se filtran por profesor cuando la pantalla de
 * configuración lo indica. Sin argumento se listan todas para resolver
 * tarifas en clases; `null` representa que todavía no se eligió profesor.
 */
export const TARIFAS_CLASES_QUERY_KEY = ['tarifas_clases'] as const;

/**
 * Lista de tarifas de clases del club, ordenada igual que tarifas de
 * turnos (prioridad DESC, nombre ASC, vigente_desde DESC).
 */
export function useTarifasClases(
  profesorId?: number | null,
): UseQueryResult<Tarifa[], Error> {
  return useQuery<Tarifa[], Error>({
    queryKey: [...TARIFAS_CLASES_QUERY_KEY, profesorId],
    queryFn: async () => {
      if (profesorId === null) return [];

      const query =
        profesorId === undefined
          ? supabase
              .from('tarifas_clases')
              .select('*')
              .order('prioridad', { ascending: false })
              .order('nombre', { ascending: true })
              .order('vigente_desde', { ascending: false })
          : supabase
              .from('tarifas_clases')
              .select('*')
              .eq('profesor_id', profesorId)
              .order('prioridad', { ascending: false })
              .order('nombre', { ascending: true })
              .order('vigente_desde', { ascending: false });
      const { data: tarifas, error: queryError } = await query;
      if (queryError) throw new Error(mapPostgrestError(queryError));
      return (tarifas ?? []) as Tarifa[];
    },
  });
}

export function useTarifasClasesSinProfesor(): UseQueryResult<Tarifa[], Error> {
  return useQuery<Tarifa[], Error>({
    queryKey: [...TARIFAS_CLASES_QUERY_KEY, 'sin-profesor'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tarifas_clases')
        .select('*')
        .is('profesor_id', null)
        .order('prioridad', { ascending: false })
        .order('nombre', { ascending: true })
        .order('vigente_desde', { ascending: false });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Tarifa[];
    },
  });
}

export function useAsignarTarifaClaseAProfesor(): UseMutationResult<
  number,
  Error,
  { lineage_id: number; profesor_id: number }
> {
  const queryClient = useQueryClient();

  return useMutation<
    number,
    Error,
    { lineage_id: number; profesor_id: number }
  >({
    mutationFn: async ({ lineage_id, profesor_id }) => {
      const { data, error } = await supabase
        .from('tarifas_clases')
        .update({ profesor_id })
        .eq('lineage_id', lineage_id)
        .is('profesor_id', null)
        .select('id');
      if (error) throw new Error(mapPostgrestError(error));
      if (!data || data.length === 0) {
        throw new Error(
          'La tarifa ya fue asignada o no está disponible. Actualizá la pantalla e intentá nuevamente.',
        );
      }
      return data.length;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_CLASES_QUERY_KEY });
    },
  });
}

// ─── Crear franja nueva ──────────────────────────────────────────────

/**
 * Crea una franja nueva via RPC `fn_crear_tarifa_clase`, asociada al
 * profesor seleccionado. La RPC se encarga del lineage_id autoreferente.
 */
export function useCrearTarifaClase(
  profesorId?: number | null,
): UseMutationResult<
  Tarifa,
  Error,
  CrearTarifaInput
> {
  const queryClient = useQueryClient();
  return useMutation<Tarifa, Error, CrearTarifaInput>({
    mutationFn: async (input) => {
      if (profesorId === null || profesorId === undefined) {
        throw new Error('Elegí un profesor antes de crear una tarifa de clases.');
      }
      const { data, error } = await supabase.rpc('fn_crear_tarifa_clase', {
        p_profesor_id: profesorId,
        p_nombre: input.nombre,
        p_monto: input.monto,
        p_desde_hora: input.desde_hora ?? null,
        p_hasta_hora: input.hasta_hora ?? null,
        p_dias_semana: input.dias_semana ?? null,
        p_prioridad: input.prioridad ?? 0,
        p_vigente_desde: input.vigente_desde ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error(
          'La función respondió sin datos. Refrescá la lista de tarifas de clases.',
        );
      }
      return data as Tarifa;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_CLASES_QUERY_KEY });
    },
  });
}

// ─── Cambiar precio (versionado) ─────────────────────────────────────

/**
 * Versiona el precio de un linaje via `fn_cambiar_precio_tarifa_clase`
 * (0034). Server-side cierra la versión actual y crea una nueva
 * atómicamente. Idéntico comportamiento a `useCambiarPrecioTarifa` pero
 * sobre tarifas_clases.
 */
export function useCambiarPrecioTarifaClase(): UseMutationResult<
  Tarifa,
  Error,
  CambiarPrecioInput
> {
  const queryClient = useQueryClient();
  return useMutation<Tarifa, Error, CambiarPrecioInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'fn_cambiar_precio_tarifa_clase',
        {
          p_lineage_id: input.lineage_id,
          p_monto_nuevo: input.monto_nuevo,
          p_vigente_desde: input.vigente_desde,
        },
      );
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        throw new Error('La función respondió sin datos.');
      }
      return data as Tarifa;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_CLASES_QUERY_KEY });
    },
  });
}

// ─── Actualizar metadata (nombre/franja/días/prioridad/activa) ──────

/**
 * Actualiza metadata de TODAS las versiones del linaje via
 * `fn_actualizar_metadata_tarifa_clase` (0034). NO toca vigencia ni monto.
 */
export function useActualizarMetadataTarifaClase(): UseMutationResult<
  number,
  Error,
  ActualizarMetadataInput
> {
  const queryClient = useQueryClient();
  return useMutation<number, Error, ActualizarMetadataInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'fn_actualizar_metadata_tarifa_clase',
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
        },
      );
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? 0) as number;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TARIFAS_CLASES_QUERY_KEY });
    },
  });
}
