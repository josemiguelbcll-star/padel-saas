import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth/useSession';

export interface ClaseAlumnoFinanciero {
  id: number;
  clase_id: number;
  monto_clase: number;
}

export interface ClaseConsumoFinanciero {
  id: number;
  clase_id: number;
  subtotal: number;
}

export interface ClaseDatosFinancierosDelDia {
  alumnos: ClaseAlumnoFinanciero[];
  consumos: ClaseConsumoFinanciero[];
}

export const CLASE_DATOS_FINANCIEROS_DEL_DIA_QUERY_KEY_BASE = 'clase_datos_financieros_del_dia';

export function useClaseDatosFinancierosDelDia(
  fecha: string | null,
): UseQueryResult<ClaseDatosFinancierosDelDia, Error> {
  const { club } = useSession();

  return useQuery<ClaseDatosFinancierosDelDia, Error>({
    queryKey: [CLASE_DATOS_FINANCIEROS_DEL_DIA_QUERY_KEY_BASE, fecha, club?.id],
    queryFn: async () => {
      if (!fecha) {
        return { alumnos: [], consumos: [] };
      }

      const [alumnosRes, consumosRes] = await Promise.all([
        supabase
          .from('clase_ocurrencia_alumnos')
          .select('id, clase_id, monto_clase')
          .eq('fecha', fecha),
        supabase
          .from('clase_consumos')
          .select('id, clase_id, subtotal')
          .eq('fecha', fecha),
      ]);

      if (alumnosRes.error) throw new Error(mapPostgrestError(alumnosRes.error));
      if (consumosRes.error) throw new Error(mapPostgrestError(consumosRes.error));

      return {
        alumnos: (alumnosRes.data ?? []) as ClaseAlumnoFinanciero[],
        consumos: (consumosRes.data ?? []) as ClaseConsumoFinanciero[],
      };
    },
    enabled: Boolean(fecha),
  });
}
