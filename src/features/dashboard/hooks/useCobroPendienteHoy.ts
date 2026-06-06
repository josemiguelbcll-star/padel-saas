import { useMemo } from 'react';
import { useReservasDelDia } from '@/features/reservas/hooks/useReservasDelDia';
import { fechaHoy } from '@/features/reservas/utils/fechaUtils';
import {
  turnosConCobroPendiente,
  type ResultadoCobroPendiente,
} from '../utils/kpisHoy';

export interface CobroPendienteHoy {
  /** null mientras carga. `cantidad === 0` cuando no hay nada pendiente. */
  resultado: ResultadoCobroPendiente | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Alarma "turnos de hoy con cobro pendiente": reservas firmes de hoy con
 * saldo de alquiler > 0. Reusa useReservasDelDia(hoy) (misma cache que la
 * grilla) + la función pura turnosConCobroPendiente.
 */
export function useCobroPendienteHoy(): CobroPendienteHoy {
  const hoy = fechaHoy();
  const q = useReservasDelDia(hoy);
  const resultado = useMemo(
    () => (q.data ? turnosConCobroPendiente(q.data) : null),
    [q.data],
  );
  return { resultado, isLoading: q.isLoading, error: q.error };
}
