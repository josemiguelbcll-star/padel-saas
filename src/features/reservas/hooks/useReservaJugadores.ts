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
import type { ReservaJugador } from '@/types/database';

export const RESERVA_JUGADORES_QUERY_KEY_BASE = 'reserva_jugadores';

function reservaJugadoresQueryKey(reservaId: number) {
  return [RESERVA_JUGADORES_QUERY_KEY_BASE, reservaId] as const;
}

/**
 * Fila de reserva_jugadores enriquecida con el nombre del jugador
 * cuando `jugador_id` apunta a uno registrado. Para los acompañantes
 * "nombre libre" el join es null y se usa `nombre_libre` directamente.
 * Para los anónimos (tipo='jugador' con ambos null, o tipo='invitado'),
 * ambos son null y la UI deriva "Jugador N" / "Invitado N" por orden.
 */
export interface ReservaJugadorConNombre extends ReservaJugador {
  jugador: { nombre: string } | null;
}

/**
 * Trae las personas de una reserva (titular primero, después por id ASC
 * para que la UI pueda derivar "Jugador N" / "Invitado N" con orden
 * estable). Si `reservaId` es null no dispara la query.
 *
 * Usado por el DetalleReservaDialog cuando el usuario clickea una
 * reserva en la grilla.
 */
export function useReservaJugadores(
  reservaId: number | null,
): UseQueryResult<ReservaJugadorConNombre[], Error> {
  return useQuery<ReservaJugadorConNombre[], Error>({
    queryKey: reservaId === null
      ? [RESERVA_JUGADORES_QUERY_KEY_BASE]
      : reservaJugadoresQueryKey(reservaId),
    queryFn: async () => {
      if (reservaId === null) return [];
      const { data, error } = await supabase
        .from('reserva_jugadores')
        .select('*, jugador:jugador_id(nombre)')
        .eq('reserva_id', reservaId)
        .order('es_titular', { ascending: false })
        .order('id', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as unknown as ReservaJugadorConNombre[];
    },
    enabled: reservaId !== null,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Mutaciones del paso 1b (cuenta del turno)
// ─────────────────────────────────────────────────────────────────────

/**
 * Input de `useAgregarPersonaTurno`. Discriminado por `tipo`:
 *   - 'jugador': identidad opcional (jugador_id, nombre_libre, o ambos null
 *     para anónimo "Jugador N" numerado por la UI).
 *   - 'invitado': no acepta identidad. Es estrictamente anónimo
 *     (la migración 0012 lo refuerza con un CHECK).
 */
export type AgregarPersonaTurnoInput =
  | {
      reserva_id: number;
      tipo: 'jugador';
      jugador_id?: number | null;
      nombre_libre?: string | null;
    }
  | {
      reserva_id: number;
      tipo: 'invitado';
    };

/**
 * Agregar una persona al turno (jugador o invitado). INSERT directo en
 * reserva_jugadores. `es_titular` siempre false — el titular lo setea
 * fn_crear_reserva al momento de crear la reserva y no se cambia desde
 * acá.
 *
 * La RLS abierta a authenticated del club permite el INSERT. El CHECK
 * `reserva_jugadores_tipo_identidad` valida la coherencia tipo↔identidad.
 */
export function useAgregarPersonaTurno(): UseMutationResult<
  ReservaJugador,
  Error,
  AgregarPersonaTurnoInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<ReservaJugador, Error, AgregarPersonaTurnoInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const payload = {
        club_id: club.id,
        reserva_id: input.reserva_id,
        tipo: input.tipo,
        es_titular: false,
        jugador_id:
          input.tipo === 'jugador' ? (input.jugador_id ?? null) : null,
        nombre_libre:
          input.tipo === 'jugador' ? (input.nombre_libre ?? null) : null,
      };
      const { data, error } = await supabase
        .from('reserva_jugadores')
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as ReservaJugador;
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: reservaJugadoresQueryKey(input.reserva_id),
      });
    },
  });
}

/**
 * Input de `useActualizarPersonaTurno`. Solo se permiten cambios de
 * identidad (jugador_id / nombre_libre) — el caso típico es promover una
 * fila anónima a una con ficha. NO se permite cambiar `tipo` ni
 * `es_titular` desde acá (eso requeriría borrar y re-crear).
 */
export interface ActualizarPersonaTurnoInput {
  id: number;
  /** Solo para invalidación; no se manda al UPDATE. */
  reserva_id: number;
  changes: {
    jugador_id?: number | null;
    nombre_libre?: string | null;
  };
}

/**
 * Actualizar una persona del turno. Caso de uso principal: vincular una
 * ficha de `jugadores` a una fila anónima o con nombre libre (sumar
 * `jugador_id`, opcionalmente limpiar `nombre_libre`).
 */
export function useActualizarPersonaTurno(): UseMutationResult<
  ReservaJugador,
  Error,
  ActualizarPersonaTurnoInput
> {
  const queryClient = useQueryClient();

  return useMutation<ReservaJugador, Error, ActualizarPersonaTurnoInput>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('reserva_jugadores')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as ReservaJugador;
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: reservaJugadoresQueryKey(input.reserva_id),
      });
    },
  });
}

export interface QuitarPersonaTurnoInput {
  id: number;
  /** Solo para invalidación; no se manda al DELETE. */
  reserva_id: number;
}

/**
 * Quitar una persona del turno. DELETE directo. RLS gatea por club.
 *
 * El titular (es_titular=true) técnicamente puede borrarse desde acá
 * porque la RLS no distingue, pero la UI no expone el botón sobre el
 * titular (cambiar titular es fuera de scope del paso 1b).
 *
 * En el paso 4, cuando los pagos por persona apunten a
 * reserva_jugadores.id, va a hacer falta evaluar si bloqueamos el
 * borrado de una persona con pagos asociados (probablemente sí, con
 * trigger + mensaje accionable). Por ahora libre.
 */
export function useQuitarPersonaTurno(): UseMutationResult<
  void,
  Error,
  QuitarPersonaTurnoInput
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, QuitarPersonaTurnoInput>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase
        .from('reserva_jugadores')
        .delete()
        .eq('id', id);
      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: reservaJugadoresQueryKey(input.reserva_id),
      });
    },
  });
}
