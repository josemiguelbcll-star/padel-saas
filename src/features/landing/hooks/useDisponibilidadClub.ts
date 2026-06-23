import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface SlotDisponible {
  cancha_id: number;
  cancha_nombre: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
}

export async function fetchDisponibilidadClub(slug: string, fecha: string) {
  const { data, error } = await supabase.rpc('fn_disponibilidad_publica', {
    p_slug: slug,
    p_fecha: fecha,
  });
  if (error) throw error;
  return (data ?? []) as SlotDisponible[];
}

export function useDisponibilidadClub(slug: string, fecha: string) {
  return useQuery({
    queryKey: ['disponibilidad-club', slug, fecha],
    queryFn: () => fetchDisponibilidadClub(slug, fecha),
    enabled: !!slug && !!fecha,
    staleTime: 1000 * 60 * 2,
  });
}
