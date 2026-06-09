import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ClubPost {
  id:            number;
  club_id:       number;
  club_nombre:   string;
  usuario_id:    string;
  titulo:        string;
  contenido:     string;
  tipo:          'noticia' | 'promo' | 'torneo' | 'otro';
  imagen_url:    string | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  creado_en:     string;
}

export function useClubPosts() {
  return useQuery({
    queryKey: ['club-posts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('club_posts')
        .select(`
          id, club_id, usuario_id, titulo, contenido, tipo,
          imagen_url, vigente_desde, vigente_hasta, creado_en,
          clubes(nombre)
        `)
        .eq('activo', true)
        .order('creado_en', { ascending: false })
        .limit(50);

      if (error) throw error;

      return (data ?? []).map((post: any) => ({
        id: post.id,
        club_id: post.club_id,
        club_nombre: post.clubes?.nombre || 'Club',
        usuario_id: post.usuario_id,
        titulo: post.titulo,
        contenido: post.contenido,
        tipo: post.tipo,
        imagen_url: post.imagen_url,
        vigente_desde: post.vigente_desde,
        vigente_hasta: post.vigente_hasta,
        creado_en: post.creado_en,
      })) as ClubPost[];
    },
    staleTime: 1000 * 60 * 2, // 2 min
  });
}
