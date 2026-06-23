import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ClubPublico {
  id: number;
  nombre: string;
  slug: string;
  descripcion: string | null;
  direccion: string | null;
  ciudad: string | null;
  provincia: string | null;
  telefono: string | null;
  email: string | null;
  hora_apertura: string | null;
  hora_cierre: string | null;
  logo_path: string | null;
  color_primario_hsl: string;
  lat: number | null;
  lng: number | null;
  instagram: string | null;
  website: string | null;
  portada_url: string | null;
  sena_obligatoria?: boolean;
  sena_tipo?: 'porcentaje' | 'fijo' | null;
  sena_valor?: number | null;
  sena_alias?: string | null;
  mercadopago_habilitado?: boolean;
}

export interface CanchaPublica {
  id: number;
  club_id: number;
  nombre: string;
  tipo: string | null;
  cubierta: boolean;
  orden: number;
}

export interface FotoClub {
  id: number;
  club_id: number;
  url: string;
  caption: string | null;
  orden: number;
  es_portada: boolean;
}

export async function fetchClubPublico(slug: string) {
  const { data: club, error: clubError } = await supabase
    .from('v_clubes_publicos')
    .select('*')
    .eq('slug', slug)
    .single();

  if (clubError || !club) {
    throw clubError ?? new Error('Club no encontrado');
  }

  const [{ data: canchas }, { data: fotos }] = await Promise.all([
    supabase
      .from('v_canchas_publicas')
      .select('*')
      .eq('club_id', (club as ClubPublico).id)
      .order('orden'),
    supabase
      .from('v_fotos_clubes_publicas')
      .select('*')
      .eq('club_id', (club as ClubPublico).id)
      .order('orden'),
  ]);

  return {
    club: club as ClubPublico,
    canchas: (canchas ?? []) as CanchaPublica[],
    fotos: (fotos ?? []) as FotoClub[],
  };
}

export function useClubPublico(slug: string) {
  return useQuery({
    queryKey: ['club-publico', slug],
    queryFn: () => fetchClubPublico(slug),
    enabled: !!slug,
    staleTime: 1000 * 60 * 5,
  });
}
