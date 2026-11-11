import { useMemo } from 'react';
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

/**
 * Devuelve el set de IDs de cajas (`turnos_caja.id`) que están CERRADAS y
 * que recibieron alguno de los cobros pasados. Sirve para bloquear en la UI
 * el borrado de cobros ya arqueados (política: solo un admin corrige, con
 * motivo). La RPC valida lo mismo del lado del servidor.
 */
export function useCajasCerradasDePagos(pagos: ReservaPago[]): Set<number> {
  const ids = useMemo(
    () =>
      Array.from(
        new Set(
          pagos
            .map((p) => p.turno_caja_id)
            .filter((id): id is number => typeof id === 'number'),
        ),
      ),
    [pagos],
  );

  const query = useQuery<number[], Error>({
    queryKey: ['turnos_caja_cerrada', ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('turnos_caja')
        .select('id')
        .in('id', ids)
        .not('cerrada_en', 'is', null);
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []).map((row) => row.id as number);
    },
  });

  return useMemo(() => new Set(query.data ?? []), [query.data]);
}
