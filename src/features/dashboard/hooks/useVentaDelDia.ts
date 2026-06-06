import { useFlujoCaja } from '@/features/finanzas/hooks/useFlujoCaja';
import { fechaHoy } from '@/features/reservas/utils/fechaUtils';

export interface VentaDelDia {
  /** Total cobrado hoy (todos los medios). null mientras carga. */
  ventaDelDia: number | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Venta del día = todo lo percibido hoy (reserva_pagos + clase_cobros +
 * ventas + otros_ingresos, todos los medios), con el bucketing día-local-AR
 * ya resuelto server-side. Reusa fn_flujo_caja (0061) con rango hoy–hoy y
 * granularidad diaria: devuelve una sola fila (generate_series garantiza la
 * fila aunque no haya movimientos) → tomamos su `ingresos`.
 *
 * Una vez cargada, una jornada sin cobros da 0 (no null); null sólo mientras
 * la query está en vuelo.
 */
export function useVentaDelDia(): VentaDelDia {
  const hoy = fechaHoy();
  const q = useFlujoCaja(hoy, hoy, 'day');
  const ventaDelDia = q.data ? (q.data[0]?.ingresos ?? 0) : null;
  return { ventaDelDia, isLoading: q.isLoading, error: q.error };
}
