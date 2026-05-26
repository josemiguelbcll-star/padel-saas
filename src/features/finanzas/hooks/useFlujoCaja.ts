import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Granularidad } from '../utils/clavePeriodo';

/**
 * Una fila del flujo de caja REAL (percibido) por período, tal como la
 * devuelve la RPC fn_flujo_caja (0061): saldo_apertura + ingresos − egresos =
 * saldo_cierre, con el saldo encadenado período a período. El saldo_cierre del
 * último período == el saldo total de v_cuentas_saldo a esa fecha (fuente única).
 */
export interface FlujoCajaPeriodo {
  /** Inicio del período (YYYY-MM-DD), alineado al date_trunc del SQL. */
  periodo: string;
  ingresos: number;
  egresos: number;
  neto: number;
  saldoApertura: number;
  saldoCierre: number;
}

export const FLUJO_CAJA_QUERY_KEY = (
  desde: string,
  hasta: string,
  granularidad: Granularidad,
  cuentaId: number | null,
) => ['flujo-caja', desde, hasta, granularidad, cuentaId] as const;

/**
 * Flujo de caja REAL por período, vía la RPC fn_flujo_caja (lectura pura,
 * SECURITY INVOKER → RLS por club). p_cuenta_id NULL = agregado de todas las
 * cuentas (las transferencias internas se anulan); con un id = esa cuenta.
 *
 * Es la mitad REAL del flujo: se combina con useFlujoProyectado (proyectado)
 * en combinarFlujo, donde el saldo proyectado se encadena desde el último
 * saldo real (la curva proyectada arranca en el saldo real de hoy, no en cero).
 */
export function useFlujoCaja(
  desde: string,
  hasta: string,
  granularidad: Granularidad,
  cuentaId: number | null = null,
): UseQueryResult<FlujoCajaPeriodo[], Error> {
  return useQuery<FlujoCajaPeriodo[], Error>({
    queryKey: FLUJO_CAJA_QUERY_KEY(desde, hasta, granularidad, cuentaId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_flujo_caja', {
        p_desde: desde,
        p_hasta: hasta,
        p_granularidad: granularidad,
        p_cuenta_id: cuentaId,
      });
      if (error) throw new Error(mapPostgrestError(error));

      // NUMERIC de Postgres puede llegar como string (PostgREST preserva
      // precisión) o number → Number() normaliza. periodo es DATE → string.
      type Row = {
        periodo: string;
        ingresos: number | string;
        egresos: number | string;
        neto: number | string;
        saldo_apertura: number | string;
        saldo_cierre: number | string;
      };

      return ((data ?? []) as unknown as Row[]).map((r) => ({
        periodo: r.periodo,
        ingresos: Number(r.ingresos),
        egresos: Number(r.egresos),
        neto: Number(r.neto),
        saldoApertura: Number(r.saldo_apertura),
        saldoCierre: Number(r.saldo_cierre),
      }));
    },
  });
}
