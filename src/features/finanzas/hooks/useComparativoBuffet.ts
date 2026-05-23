import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { mismoDiaDelMesAnterior } from '../utils/ocurrenciasDelMes';

export interface ComparativoBuffet {
  /** Total vendido en el mes anterior completo. */
  total_mes_anterior: number;
  /** Total vendido este mes hasta hoy (inclusive). */
  vendido_este_mes_hasta_hoy: number;
  /** Total vendido en el mes anterior hasta el mismo número de día que hoy. */
  vendido_mes_anterior_hasta_mismo_dia: number;
  /**
   * Diferencia en pesos: este mes hasta hoy − mes anterior hasta mismo
   * día. Positivo = por encima del ritmo del mes anterior.
   */
  diferencia_pesos: number;
  /**
   * Diferencia porcentual sobre el ritmo del mes anterior. NaN si el
   * ritmo del mes anterior fue 0 (división por cero).
   */
  diferencia_porcentaje: number;
  /** True si vamos por encima del ritmo del mes anterior. */
  va_por_encima: boolean;
  /** Día de hoy formateado YYYY-MM-DD (informativo). */
  hoy: string;
  /** Fecha del mes anterior con el mismo número de día (YYYY-MM-DD). */
  mismo_dia_mes_anterior: string;
}

export const COMPARATIVO_BUFFET_QUERY_KEY = ['comparativo_buffet'] as const;

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Comparativo de ventas (buffet + shop juntos) del mes en curso vs el
 * mes anterior:
 *   - Total del mes anterior completo (meta del mes).
 *   - Vendido este mes hasta hoy.
 *   - Vendido el mes anterior hasta el MISMO número de día que hoy.
 *
 * NO proyecta cierre — el buffet es impredecible. Sirve solo como
 * señal temprana de si vamos por encima o por debajo del ritmo del
 * mes anterior.
 *
 * Edge case fecha: si hoy es día 31 y el mes anterior tiene 30 días,
 * compara contra el día 30 del mes anterior (último día disponible).
 * Manejado por `mismoDiaDelMesAnterior`.
 */
export function useComparativoBuffet(): UseQueryResult<
  ComparativoBuffet,
  Error
> {
  return useQuery<ComparativoBuffet, Error>({
    queryKey: COMPARATIVO_BUFFET_QUERY_KEY,
    queryFn: async () => {
      const hoy = new Date();
      const hoyISO = fmtISO(hoy);

      // Inicio del mes actual (día 1).
      const inicioMesActual = new Date(
        hoy.getFullYear(),
        hoy.getMonth(),
        1,
      );
      const inicioMesActualISO = fmtISO(inicioMesActual);

      // Mes anterior: primer y último día.
      const anioMesAnt =
        hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
      const mesAnt0 = hoy.getMonth() === 0 ? 11 : hoy.getMonth() - 1;
      const inicioMesAntISO = fmtISO(new Date(anioMesAnt, mesAnt0, 1));
      const finMesAntISO = fmtISO(new Date(anioMesAnt, mesAnt0 + 1, 0));
      const mismoDiaMesAntISO = mismoDiaDelMesAnterior(hoy);

      // Ventas usan fecha_hora (TIMESTAMPTZ). Acotamos por día completo.
      const hoyFin = `${hoyISO}T23:59:59`;
      const inicioMesActualIni = `${inicioMesActualISO}T00:00:00`;
      const inicioMesAntIni = `${inicioMesAntISO}T00:00:00`;
      const finMesAntFin = `${finMesAntISO}T23:59:59`;
      const mismoDiaMesAntFin = `${mismoDiaMesAntISO}T23:59:59`;

      const [mesAntCompletoRes, esteHastaHoyRes, antHastaMismoDiaRes] =
        await Promise.all([
          supabase
            .from('ventas')
            .select('monto_total')
            .gte('fecha_hora', inicioMesAntIni)
            .lte('fecha_hora', finMesAntFin),
          supabase
            .from('ventas')
            .select('monto_total')
            .gte('fecha_hora', inicioMesActualIni)
            .lte('fecha_hora', hoyFin),
          supabase
            .from('ventas')
            .select('monto_total')
            .gte('fecha_hora', inicioMesAntIni)
            .lte('fecha_hora', mismoDiaMesAntFin),
        ]);

      for (const r of [
        mesAntCompletoRes,
        esteHastaHoyRes,
        antHastaMismoDiaRes,
      ]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      const sumar = (rows: Array<{ monto_total: number }> | null): number =>
        (rows ?? []).reduce(
          (acc, v) => acc + (Number(v.monto_total) || 0),
          0,
        );

      const total_mes_anterior = sumar(
        mesAntCompletoRes.data as Array<{ monto_total: number }> | null,
      );
      const vendido_este_mes_hasta_hoy = sumar(
        esteHastaHoyRes.data as Array<{ monto_total: number }> | null,
      );
      const vendido_mes_anterior_hasta_mismo_dia = sumar(
        antHastaMismoDiaRes.data as Array<{ monto_total: number }> | null,
      );

      const diferencia_pesos =
        vendido_este_mes_hasta_hoy - vendido_mes_anterior_hasta_mismo_dia;
      const diferencia_porcentaje =
        vendido_mes_anterior_hasta_mismo_dia === 0
          ? Number.NaN
          : (diferencia_pesos / vendido_mes_anterior_hasta_mismo_dia) * 100;

      return {
        total_mes_anterior,
        vendido_este_mes_hasta_hoy,
        vendido_mes_anterior_hasta_mismo_dia,
        diferencia_pesos,
        diferencia_porcentaje,
        va_por_encima: diferencia_pesos > 0,
        hoy: hoyISO,
        mismo_dia_mes_anterior: mismoDiaMesAntISO,
      };
    },
  });
}
