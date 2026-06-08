import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface SlotDisponible {
  cancha_id: number;
  cancha_nombre: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
}

export function useDisponibilidadClub(slug: string, fecha: string) {
  return useQuery({
    queryKey: ['disponibilidad-club', slug, fecha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_disponibilidad_publica', {
        p_slug: slug,
        p_fecha: fecha,
      });
      if (error) throw error;
      return (data ?? []) as SlotDisponible[];
    },
    enabled: !!slug && !!fecha,
    staleTime: 1000 * 60 * 2,
  });
}
