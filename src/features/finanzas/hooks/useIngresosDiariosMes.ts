import { type UseQueryResult } from '@tanstack/react-query';
import { useResumenFinanciero } from './useResumenFinanciero';

export interface PuntoIngresoDiario {
  /** YYYY-MM-DD */
  fecha: string;
  /** Día del mes 1..31 (para el eje X cuando se compara entre meses). */
  dia: number;
  /** Total ingresos de ese día (cobros reserva + clases + ventas + otros). */
  monto: number;
  /** Acumulado del mes hasta ese día. */
  acumulado: number;
}

export interface IngresosDiariosMes {
  anio: number;
  mes: number;
  /** Array completo del mes (1..N días). Días sin movimiento tienen monto=0. */
  serie: PuntoIngresoDiario[];
}

export const INGRESOS_DIARIOS_MES_QUERY_KEY = (anio: number, mes: number) =>
  ['resumen_financiero', anio, mes] as const;

/**
 * Serie diaria de ingresos del mes (criterio caja: lo que entró el día).
 * Suma: cobros de reservas (descontando reembolsos) + cobros de clases +
 * ventas + otros ingresos. Pensado para alimentar un gráfico de línea
 * con acumulado.
 *
 * Optimizado para reutilizar la query de `useResumenFinanciero` bajo la misma
 * queryKey, evitando llamar al pesado RPC `fn_obtener_resumen_financiero` dos veces.
 */
export function useIngresosDiariosMes(
  anio: number,
  mes: number,
): UseQueryResult<IngresosDiariosMes, Error> {
  const query = useResumenFinanciero(anio, mes);

  // Mapeamos los datos manteniendo la estructura requerida
  const mappedData: IngresosDiariosMes | undefined = query.data
    ? {
        anio,
        mes,
        serie: query.data.ingresos_diarios || [],
      }
    : undefined;

  return {
    ...query,
    data: mappedData,
  } as unknown as UseQueryResult<IngresosDiariosMes, Error>;
}
