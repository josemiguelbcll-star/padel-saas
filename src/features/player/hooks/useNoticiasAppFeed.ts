import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface NoticiaAppFeed {
  id: number;
  club_id: number;
  club_nombre: string;
  titulo: string;
  descripcion: string | null;
  imagen_url: string | null;
  creado_en: string;
}

/**
 * Hook para cargar noticias del feed (para jugadores)
 */
export function useNoticiasAppFeed() {
  return useQuery({
    queryKey: ['noticias-app-feed'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('noticias_feed')
        .select(`
          id, club_id, titulo, descripcion, imagen_url, creado_en,
          clubes(nombre)
        `)
        .eq('activo', true)
        .order('creado_en', { ascending: false })
        .limit(20);

      if (error) throw error;

      return (data ?? []).map((noticia: any) => ({
        id: noticia.id,
        club_id: noticia.club_id,
        club_nombre: noticia.clubes?.nombre || 'Club',
        titulo: noticia.titulo,
        descripcion: noticia.descripcion,
        imagen_url: noticia.imagen_url,
        creado_en: noticia.creado_en,
      })) as NoticiaAppFeed[];
    },
    staleTime: 1000 * 60 * 2, // 2 min
  });
}
