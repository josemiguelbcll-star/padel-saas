import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ReservaPago } from '@/types/database';

export const RESERVA_PAGOS_QUERY_KEY_BASE = 'reserva_pagos';

/**
 * Historial de cobros (señas + pagos + reembolsos) de una reserva,
 * ordenados cronológicamente. Usado por el DetalleReservaDialog.
 *
 * En sprint 3a hay como máximo 1 pago por reserva (el del momento de
 * crearla). En sprints posteriores (Buffet/Caja) van a aparecer
 * múltiples pagos por reserva — la query ya soporta ese caso, no hay
 * que cambiar el hook.
 */
export function useReservaPagos(
  reservaId: number | null,
): UseQueryResult<ReservaPago[], Error> {
  return useQuery<ReservaPago[], Error>({
    queryKey: [RESERVA_PAGOS_QUERY_KEY_BASE, reservaId],
    queryFn: async () => {
      if (reservaId === null) return [];
      const { data, error } = await supabase
        .from('reserva_pagos')
        .select('*')
        .eq('reserva_id', reservaId)
        .order('fecha_hora', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as ReservaPago[];
    },
    enabled: reservaId !== null,
  });
}
