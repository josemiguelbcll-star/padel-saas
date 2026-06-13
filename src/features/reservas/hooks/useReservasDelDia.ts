import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Reserva } from '@/types/database';

/** Namespace de cache compartido por todas las queries de reservas. */
export const RESERVAS_QUERY_KEY_BASE = 'reservas';

/** Key específica para la query de reservas de un día. */
export function reservasDelDiaQueryKey(fecha: string): readonly [string, string] {
  return [RESERVAS_QUERY_KEY_BASE, fecha] as const;
}

/**
 * Reserva enriquecida con el nombre del titular (join contra jugadores).
 * Es lo que la grilla necesita en cada bloque sin tener que hacer un
 * segundo fetch.
 */
export interface ReservaConTitular extends Reserva {
  /** Datos mínimos del titular (jugador con jugador_id). NULL si la reserva no tiene titular registrado. */
  jugador: { nombre: string; telefono: string | null } | null;
}

/**
 * Reservas de un día puntual del club activo (filtra RLS).
 *
 * La query trae el nombre del titular en un solo round-trip vía
 * PostgREST. Excluye reservas canceladas no — la grilla las mostrará
 * con su color de estado y queda a criterio del componente decidir si
 * se muestran o se ocultan; el dato está disponible.
 *
 * El índice idx_reservas_club_fecha (migración 0004) hace este filtro
 * trivial incluso con miles de reservas históricas.
 */
export function useReservasDelDia(
  fecha: string,
): UseQueryResult<ReservaConTitular[], Error> {
  return useQuery<ReservaConTitular[], Error>({
    queryKey: reservasDelDiaQueryKey(fecha),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reservas')
        .select('*, jugador:jugador_id(nombre, telefono)')
        .eq('fecha', fecha)
        .order('hora_inicio', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as unknown as ReservaConTitular[];
    },
  });
}
