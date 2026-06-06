import { useMemo } from 'react';
import { useReservasDelDia } from '@/features/reservas/hooks/useReservasDelDia';
import { fechaHoy } from '@/features/reservas/utils/fechaUtils';
import { calcularProyeccionCierre } from '../utils/kpisHoy';
import { useVentaDelDia } from './useVentaDelDia';

export interface ProyeccionCierreHoy {
  /** venta del día + saldo de alquiler pendiente. null mientras carga. */
  proyeccion: number | null;
  /** Componente ya cobrado (= venta del día). */
  ventaDelDia: number | null;
  /** Componente por cobrar (saldo de alquiler de turnos firmes de hoy). */
  saldoPendiente: number | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Proyección conservadora del cierre del día = venta del día (ya cobrado,
 * todos los medios) + saldo de ALQUILER aún pendiente de los turnos firmes de
 * hoy. Ver `calcularProyeccionCierre` para el detalle de por qué no hay doble
 * conteo.
 */
export function useProyeccionCierreHoy(): ProyeccionCierreHoy {
  const hoy = fechaHoy();
  const venta = useVentaDelDia();
  const reservasQ = useReservasDelDia(hoy);

  const { proyeccion, saldoPendiente } = useMemo<{
    proyeccion: number | null;
    saldoPendiente: number | null;
  }>(() => {
    if (venta.ventaDelDia === null || !reservasQ.data) {
      return { proyeccion: null, saldoPendiente: null };
    }
    const proy = calcularProyeccionCierre(venta.ventaDelDia, reservasQ.data);
    return { proyeccion: proy, saldoPendiente: proy - venta.ventaDelDia };
  }, [venta.ventaDelDia, reservasQ.data]);

  return {
    proyeccion,
    ventaDelDia: venta.ventaDelDia,
    saldoPendiente,
    isLoading: venta.isLoading || reservasQ.isLoading,
    error: venta.error ?? reservasQ.error ?? null,
  };
}
