import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Gasto, MedioPago } from '@/types/database';
import {
  estadoPagoGasto,
  type ResultadoEstadoPago,
} from '../utils/estadoPagoGasto';

export const GASTOS_QUERY_KEY = ['gastos'] as const;

/** Gasto + su estado de pago DERIVADO de las cuotas (no del gasto madre). */
export interface GastoFila extends Gasto {
  pago: ResultadoEstadoPago;
}

/**
 * Lista de gastos del club ordenada por `fecha_gasto DESC` (más
 * recientes arriba). Por ahora trae todos los activos; cuando emerja
 * volumen, agregamos paginación o filtros server-side.
 *
 * Los snapshots (categoria_nombre, unidad_nombre, unidad_tipo) ya
 * vienen en la fila — no hace falta JOIN con catálogo para mostrar.
 *
 * El estado de pago se DERIVA de las cuotas (gasto_cuotas), no de
 * gastos.fecha_pago: un gasto a plazo / con cuota nace con fecha_pago NULL
 * pero puede estar pagado vía sus cuotas. Ver estadoPagoGasto.
 */
export function useGastos(): UseQueryResult<GastoFila[], Error> {
  return useQuery<GastoFila[], Error>({
    queryKey: GASTOS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gastos')
        .select('*, gasto_cuotas (fecha_pago, medio_pago)')
        .eq('activo', true)
        .order('fecha_gasto', { ascending: false })
        .order('id', { ascending: false })
        .limit(500);
      if (error) throw new Error(mapPostgrestError(error));

      type Row = Gasto & {
        gasto_cuotas: Array<{ fecha_pago: string | null; medio_pago: MedioPago | null }>;
      };

      return ((data ?? []) as unknown as Row[]).map((r) => {
        const { gasto_cuotas, ...gasto } = r;
        return {
          ...gasto,
          pago: estadoPagoGasto(gasto_cuotas ?? [], r.fecha_pago, r.medio_pago),
        } as GastoFila;
      });
    },
  });
}
