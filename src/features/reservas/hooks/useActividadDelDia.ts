import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';

/**
 * "Actividad" de las reservas de un día = qué reservas tienen consumo y
 * cuáles tienen pago. Dos queries companion de `useReservasDelDia` que se
 * usan para derivar el estado operativo (RESERVADO/ABIERTO) sin N+1:
 * son DOS queries totales (no una por reserva), agrupadas en Sets de ids.
 *
 * No cambiamos la forma de `useReservasDelDia` (sigue devolviendo el array
 * que consume la grilla); el estado operativo se combina en el componente
 * (Bloque C) con `derivarEstadoOperativo`.
 *
 * Filtro por día vía embed `reservas!inner(fecha)` + RLS (security del
 * consultante) → solo trae actividad del club y del día pedido.
 */
export const ACTIVIDAD_DEL_DIA_QUERY_KEY_BASE = 'reservas-actividad';

export function actividadDelDiaQueryKey(
  fecha: string,
): readonly [string, string] {
  return [ACTIVIDAD_DEL_DIA_QUERY_KEY_BASE, fecha] as const;
}

export interface ActividadDelDia {
  /** reserva_ids del día que tienen al menos un consumo. */
  idsConConsumo: Set<number>;
  /** reserva_ids del día que tienen al menos un pago. */
  idsConPago: Set<number>;
  /** Suma de subtotal de consumos por reserva_id. */
  totalConsumosPorReserva: Map<number, number>;
  /** Suma de monto de pagos por reserva_id. */
  totalPagosPorReserva: Map<number, number>;
}

export function useActividadDelDia(
  fecha: string,
): UseQueryResult<ActividadDelDia, Error> {
  return useQuery<ActividadDelDia, Error>({
    queryKey: actividadDelDiaQueryKey(fecha),
    queryFn: async () => {
      const [consumosRes, pagosRes] = await Promise.all([
        supabase
          .from('reserva_consumos')
          .select('reserva_id, subtotal, reservas!inner(fecha)')
          .eq('reservas.fecha', fecha),
        supabase
          .from('reserva_pagos')
          .select('reserva_id, monto, reservas!inner(fecha)')
          .eq('reservas.fecha', fecha),
      ]);
      if (consumosRes.error) throw new Error(mapPostgrestError(consumosRes.error));
      if (pagosRes.error) throw new Error(mapPostgrestError(pagosRes.error));

      const idsConConsumo = new Set<number>();
      const totalConsumosPorReserva = new Map<number, number>();
      for (const c of (consumosRes.data ?? []) as any[]) {
        idsConConsumo.add(c.reserva_id);
        const sub = Number(c.subtotal) || 0;
        totalConsumosPorReserva.set(c.reserva_id, (totalConsumosPorReserva.get(c.reserva_id) ?? 0) + sub);
      }

      const idsConPago = new Set<number>();
      const totalPagosPorReserva = new Map<number, number>();
      for (const p of (pagosRes.data ?? []) as any[]) {
        idsConPago.add(p.reserva_id);
        const m = Number(p.monto) || 0;
        totalPagosPorReserva.set(p.reserva_id, (totalPagosPorReserva.get(p.reserva_id) ?? 0) + m);
      }

      return {
        idsConConsumo,
        idsConPago,
        totalConsumosPorReserva,
        totalPagosPorReserva,
      };
    },
  });
}
