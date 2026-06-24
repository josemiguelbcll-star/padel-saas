import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';

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
  ['ingresos_diarios_mes', anio, mes] as const;



/**
 * Serie diaria de ingresos del mes (criterio caja: lo que entró el día).
 * Suma: cobros de reservas (descontando reembolsos) + cobros de clases +
 * ventas + otros ingresos. Pensado para alimentar un gráfico de línea
 * con acumulado.
 *
 * Días sin movimiento tienen monto=0, para que el gráfico no tenga
 * "agujeros" y el acumulado avance monotónico.
 */
export function useIngresosDiariosMes(
  anio: number,
  mes: number,
): UseQueryResult<IngresosDiariosMes, Error> {
  return useQuery<IngresosDiariosMes, Error>({
    queryKey: INGRESOS_DIARIOS_MES_QUERY_KEY(anio, mes),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_obtener_resumen_financiero', {
        p_anio: anio,
        p_mes: mes,
      });
      if (error) throw new Error(mapPostgrestError(error));
      return {
        anio,
        mes,
        serie: data.ingresos_diarios,
      } as IngresosDiariosMes;
    },
  });
}
