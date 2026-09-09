import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ClubPublico } from './useClubPublico';

export function useClubsPublicos() {
  return useQuery({
    queryKey: ['clubs-publicos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_clubes_publicos')
        .select('id, nombre, slug, ciudad, provincia, logo_path, portada_url, descripcion, lat, lng, sena_obligatoria, sena_valor, mercadopago_habilitado')
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as ClubPublico[];
    },
    staleTime: 1000 * 60 * 5,
  });
}
