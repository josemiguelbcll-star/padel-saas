import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ReservaJugador } from '@/types/database';

export const RESERVA_JUGADORES_QUERY_KEY_BASE = 'reserva_jugadores';

/**
 * Fila de reserva_jugadores enriquecida con el nombre del jugador
 * cuando `jugador_id` apunta a uno registrado. Para los acompañantes
 * "nombre libre" el join es null y se usa `nombre_libre` directamente.
 */
export interface ReservaJugadorConNombre extends ReservaJugador {
  jugador: { nombre: string } | null;
}

/**
 * Trae los hasta 4 jugadores de una reserva (titular primero por orden
 * DESC en `es_titular`). Si `reservaId` es null no dispara la query.
 *
 * Usado por el DetalleReservaDialog cuando el usuario clickea una
 * reserva en la grilla.
 */
export function useReservaJugadores(
  reservaId: number | null,
): UseQueryResult<ReservaJugadorConNombre[], Error> {
  return useQuery<ReservaJugadorConNombre[], Error>({
    queryKey: [RESERVA_JUGADORES_QUERY_KEY_BASE, reservaId],
    queryFn: async () => {
      if (reservaId === null) return [];
      const { data, error } = await supabase
        .from('reserva_jugadores')
        .select('*, jugador:jugador_id(nombre)')
        .eq('reserva_id', reservaId)
        .order('es_titular', { ascending: false });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as unknown as ReservaJugadorConNombre[];
    },
    enabled: reservaId !== null,
  });
}
