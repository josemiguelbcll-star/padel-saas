import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { ReservaOperativa } from '@/types/database';
import { fechaHoy } from '../utils/fechaUtils';

/**
 * Alarma cross-día: turnos de fecha anterior a hoy que quedaron SIN CERRAR
 * y que tuvieron actividad (consumo o pago). Un reservado viejo sin
 * actividad es un no-show, no un "turno colgado" — por eso el filtro
 * `tiene_consumo OR tiene_pago`.
 *
 * Sobre la vista `v_reservas_operativas` (0054, security_invoker → RLS por
 * club). Apoyado en el índice parcial idx_reservas_abiertas
 * (cerrado_en IS NULL AND estado != 'cancelada'). Resultado acotado.
 */
export const TURNOS_ABIERTOS_VIEJOS_QUERY_KEY = ['turnos-abiertos-viejos'] as const;

export function useTurnosAbiertosViejos(): UseQueryResult<
  ReservaOperativa[],
  Error
> {
  return useQuery<ReservaOperativa[], Error>({
    queryKey: TURNOS_ABIERTOS_VIEJOS_QUERY_KEY,
    queryFn: async () => {
      const hoy = fechaHoy();
      const { data, error } = await supabase
        .from('v_reservas_operativas')
        .select('*')
        .lt('fecha', hoy)
        .is('cerrado_en', null)
        .neq('estado', 'cancelada')
        .or('tiene_consumo.eq.true,tiene_pago.eq.true')
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as unknown as ReservaOperativa[];
    },
  });
}
