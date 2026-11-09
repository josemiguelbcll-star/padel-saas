import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { mapPostgrestError } from '@/lib/dbErrors';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/features/auth';

export type OrigenMovimientoCuenta =
  | 'reserva_pago'
  | 'clase_cobro'
  | 'venta'
  | 'venta_correccion'
  | 'venta_reversion'
  | 'gasto'
  | 'otro_ingreso'
  | 'gasto_cuota'
  | 'caja_manual'
  | 'transferencia_origen'
  | 'transferencia_destino';

export interface MovimientoCuentaItem {
  id: string;
  club_id: number;
  cuenta_id: number;
  cuenta_nombre: string;
  tipo_cuenta: string;
  fecha_hora: string;
  origen: OrigenMovimientoCuenta;
  concepto: string;
  detalle: string | null;
  signo: 1 | -1;
  monto: number;
  usuario_id: string | null;
  usuario_nombre: string;
  usuario_rol: string | null;
}

export interface UseMovimientosCuentasArgs {
  desde?: string;
  hasta?: string;
  cuentaId?: number | null;
}

export const MOVIMIENTOS_CUENTAS_QUERY_KEY = ['movimientos_cuentas'] as const;

export function useMovimientosCuentas({
  desde,
  hasta,
  cuentaId,
}: UseMovimientosCuentasArgs): UseQueryResult<MovimientoCuentaItem[], Error> {
  const { club } = useSession();

  return useQuery<MovimientoCuentaItem[], Error>({
    queryKey: [...MOVIMIENTOS_CUENTAS_QUERY_KEY, club?.id, desde, hasta, cuentaId],
    enabled: Boolean(club?.id),
    queryFn: async () => {
      if (!club?.id) return [];

      let query = supabase
        .from('v_movimientos_cuenta_detalle')
        .select('*')
        .eq('club_id', club.id);
      if (cuentaId !== undefined && cuentaId !== null) {
        query = query.eq('cuenta_id', cuentaId);
      }
      if (desde) query = query.gte('fecha_hora', `${desde}T00:00:00.000-03:00`);
      if (hasta) query = query.lte('fecha_hora', `${hasta}T23:59:59.999-03:00`);

      const { data, error } = await query.order('fecha_hora', { ascending: false });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as unknown as MovimientoCuentaItem[];
    },
  });
}
