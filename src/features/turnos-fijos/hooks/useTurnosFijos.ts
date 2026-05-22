import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type {
  ResultadoCancelacionTurnoFijo,
  ResultadoMaterializacion,
  TurnoFijo,
} from '@/types/database';

export const TURNOS_FIJOS_QUERY_KEY = ['turnos-fijos'] as const;

/**
 * Lista de turnos fijos del club. Por default incluye solo activos
 * (los inactivos quedan en la base como histórico; la UI normal
 * trabaja con los activos).
 */
export function useTurnosFijos(opts?: {
  incluirInactivos?: boolean;
}): UseQueryResult<TurnoFijo[], Error> {
  const incluir = opts?.incluirInactivos ?? false;
  return useQuery<TurnoFijo[], Error>({
    queryKey: [...TURNOS_FIJOS_QUERY_KEY, { incluirInactivos: incluir }],
    queryFn: async () => {
      let q = supabase
        .from('turnos_fijos')
        .select('*')
        .order('dia_semana', { ascending: true })
        .order('hora_inicio', { ascending: true });
      if (!incluir) q = q.eq('activo', true);
      const { data, error } = await q;
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as TurnoFijo[];
    },
  });
}

// ─── Crear ────────────────────────────────────────────────────────────

export interface CrearTurnoFijoInput {
  cancha_id: number;
  /** Uno de los dos obligatorio. */
  jugador_id: number | null;
  nombre_libre: string | null;
  /** 1=lunes..7=domingo. */
  dia_semana: number;
  /** 'HH:MM' o 'HH:MM:SS'. */
  hora_inicio: string;
  /** 60 | 90 | 120 | 150 | 180 | 240. */
  duracion_min: number;
  /** 'YYYY-MM-DD'. */
  fecha_desde: string;
  /** 'YYYY-MM-DD' o null. */
  fecha_hasta?: string | null;
  observaciones?: string | null;
}

export function useCrearTurnoFijo(): UseMutationResult<
  TurnoFijo,
  Error,
  CrearTurnoFijoInput
> {
  const queryClient = useQueryClient();
  return useMutation<TurnoFijo, Error, CrearTurnoFijoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_crear_turno_fijo', {
        p_cancha_id: input.cancha_id,
        p_jugador_id: input.jugador_id,
        p_nombre_libre: input.nombre_libre,
        p_dia_semana: input.dia_semana,
        p_hora_inicio: input.hora_inicio,
        p_duracion_min: input.duracion_min,
        p_fecha_desde: input.fecha_desde,
        p_fecha_hasta: input.fecha_hasta ?? null,
        p_observaciones: input.observaciones ?? null,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('La función respondió sin datos.');
      return data as TurnoFijo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TURNOS_FIJOS_QUERY_KEY });
    },
  });
}

// ─── Actualizar (titular / fecha_hasta / observaciones) ──────────────

export interface ActualizarTurnoFijoInput {
  id: number;
  jugador_id?: number | null;
  nombre_libre?: string | null;
  fecha_hasta?: string | null;
  observaciones?: string | null;
  /** Sentinels para diferenciar "no tocar" de "limpiar a NULL". */
  clear_jugador?: boolean;
  clear_nombre_libre?: boolean;
  clear_fecha_hasta?: boolean;
  clear_observaciones?: boolean;
}

export function useActualizarTurnoFijo(): UseMutationResult<
  TurnoFijo,
  Error,
  ActualizarTurnoFijoInput
> {
  const queryClient = useQueryClient();
  return useMutation<TurnoFijo, Error, ActualizarTurnoFijoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_actualizar_turno_fijo', {
        p_turno_fijo_id: input.id,
        p_jugador_id: input.jugador_id ?? null,
        p_nombre_libre: input.nombre_libre ?? null,
        p_fecha_hasta: input.fecha_hasta ?? null,
        p_observaciones: input.observaciones ?? null,
        p_clear_jugador: input.clear_jugador ?? false,
        p_clear_nombre_libre: input.clear_nombre_libre ?? false,
        p_clear_fecha_hasta: input.clear_fecha_hasta ?? false,
        p_clear_observaciones: input.clear_observaciones ?? false,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('La función respondió sin datos.');
      return data as TurnoFijo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TURNOS_FIJOS_QUERY_KEY });
    },
  });
}

// ─── Cancelar (desactivar + opcionalmente cancelar pendientes) ───────

export interface CancelarTurnoFijoInput {
  id: number;
  /**
   * Si TRUE: además de desactivar el turno, las reservas pendientes
   * futuras (estado='pendiente' AND fecha >= hoy) pasan a cancelada.
   * NO toca pagadas/señadas/jugadas (historia).
   */
  cancelar_pendientes: boolean;
}

export function useCancelarTurnoFijo(): UseMutationResult<
  ResultadoCancelacionTurnoFijo,
  Error,
  CancelarTurnoFijoInput
> {
  const queryClient = useQueryClient();
  return useMutation<
    ResultadoCancelacionTurnoFijo,
    Error,
    CancelarTurnoFijoInput
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_cancelar_turno_fijo', {
        p_turno_fijo_id: input.id,
        p_cancelar_pendientes: input.cancelar_pendientes,
      });
      if (error) throw new Error(mapPostgrestError(error));
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? { reservas_canceladas: 0 }) as ResultadoCancelacionTurnoFijo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TURNOS_FIJOS_QUERY_KEY });
      // La cancelación puede haber tocado reservas pendientes — invalidar
      // queries de reservas que la grilla usa.
      void queryClient.invalidateQueries({ queryKey: ['reservas-del-dia'] });
    },
  });
}

// ─── Eliminar (DELETE definitivo, libera el slot) ────────────────────

export interface EliminarTurnoFijoInput {
  id: number;
}

/**
 * Borra (DELETE) un turno fijo via `fn_eliminar_turno_fijo` (0032).
 * Distinto de cancelar: cancelar deja la fila inactiva, eliminar la
 * borra y libera el slot del UNIQUE parcial. Las reservas pendientes
 * futuras se cancelan automáticamente; las pagadas/jugadas se preservan
 * (ON DELETE SET NULL en reservas.turno_fijo_id).
 */
export function useEliminarTurnoFijo(): UseMutationResult<
  ResultadoCancelacionTurnoFijo,
  Error,
  EliminarTurnoFijoInput
> {
  const queryClient = useQueryClient();
  return useMutation<
    ResultadoCancelacionTurnoFijo,
    Error,
    EliminarTurnoFijoInput
  >({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_eliminar_turno_fijo', {
        p_turno_fijo_id: input.id,
      });
      if (error) throw new Error(mapPostgrestError(error));
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? { reservas_canceladas: 0 }) as ResultadoCancelacionTurnoFijo;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TURNOS_FIJOS_QUERY_KEY });
      // Las pendientes futuras pueden haber cambiado a 'cancelada' y
      // perdido el link al turno fijo — refrescar la grilla del día.
      void queryClient.invalidateQueries({ queryKey: ['reservas-del-dia'] });
    },
  });
}

// ─── Materializar ────────────────────────────────────────────────────

export interface MaterializarInput {
  /** 'YYYY-MM-DD'. */
  fecha_desde: string;
  fecha_hasta: string;
}

export function useMaterializarTurnosFijos(): UseMutationResult<
  ResultadoMaterializacion,
  Error,
  MaterializarInput
> {
  const queryClient = useQueryClient();
  return useMutation<ResultadoMaterializacion, Error, MaterializarInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc(
        'fn_materializar_turnos_fijos',
        { p_fecha_desde: input.fecha_desde, p_fecha_hasta: input.fecha_hasta },
      );
      if (error) throw new Error(mapPostgrestError(error));
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? {
        reservas_creadas: 0,
        slots_ocupados_por_reserva_suelta: 0,
        slots_ocupados_por_clase: 0,
        slots_sin_tarifa: 0,
        slots_ya_materializados: 0,
      }) as ResultadoMaterializacion;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservas-del-dia'] });
    },
  });
}
