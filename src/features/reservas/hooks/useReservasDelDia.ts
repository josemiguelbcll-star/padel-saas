import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Reserva } from '@/types/database';

import { useSession } from '@/features/auth/useSession';

/** Namespace de cache compartido por todas las queries de reservas. */
export const RESERVAS_QUERY_KEY_BASE = 'reservas';

/** Key específica para la query de reservas de un día. */
export function reservasDelDiaQueryKey(fecha: string, clubId?: number): readonly [string, string, number | undefined] {
  return [RESERVAS_QUERY_KEY_BASE, fecha, clubId] as const;
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
 * Reservas de un día puntual del club activo.
 */
export function useReservasDelDia(
  fecha: string,
): UseQueryResult<ReservaConTitular[], Error> {
  const { club } = useSession();

  return useQuery<ReservaConTitular[], Error>({
    queryKey: reservasDelDiaQueryKey(fecha, club?.id),
    queryFn: async () => {
      let query = supabase
        .from('reservas')
        .select('*, jugador:jugador_id(nombre, telefono)')
        .eq('fecha', fecha)
        .order('hora_inicio', { ascending: true });

      if (club?.id) {
        query = query.eq('club_id', club.id);
      }

      const { data, error } = await query;
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as unknown as ReservaConTitular[];
    },
  });
}
