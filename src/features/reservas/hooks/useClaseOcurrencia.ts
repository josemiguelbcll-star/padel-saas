import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';

export interface ClaseOcurrencia {
  id: number;
  club_id: number;
  clase_id: number;
  fecha: string;
  cantidad_alumnos: number;
  monto_total: number;
  estado: string;
  creado_por: string;
  creado_en: string;
}

export const CLASE_OCURRENCIA_QUERY_KEY = 'clase_ocurrencia';

export function useClaseOcurrencia(claseId: number, fecha: string) {
  return useQuery<ClaseOcurrencia | null, Error>({
    queryKey: [CLASE_OCURRENCIA_QUERY_KEY, claseId, fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clase_ocurrencias')
        .select('*')
        .eq('clase_id', claseId)
        .eq('fecha', fecha)
        .maybeSingle();
      
      if (error) {
        throw new Error(mapPostgrestError(error));
      }
      return data as ClaseOcurrencia | null;
    },
    enabled: !!claseId && !!fecha,
  });
}
