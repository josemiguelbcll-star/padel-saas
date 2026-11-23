import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface NoticiaAppFeed {
  id: number;
  club_id: number;
  club_nombre: string;
  club_slug: string | null;
  titulo: string;
  descripcion: string | null;
  imagen_url: string | null;
  creado_en: string;
  likes_count: number;
  comments_count: number;
}

/**
 * Hook para cargar noticias del feed (para jugadores)
 */
export function useNoticiasAppFeed(clubId?: number) {
  return useQuery({
    queryKey: clubId ? ['noticias-club-publicas', clubId, 'nombres'] : ['noticias-app-feed', 'nombres'],
    queryFn: async () => {
      const selectConConteos = `
          id, club_id, titulo, descripcion, imagen_url, creado_en,
          likes_count, comments_count
        `;
      const selectSinConteos = `
          id, club_id, titulo, descripcion, imagen_url, creado_en
        `;

      let q = supabase
        .from('noticias_feed')
        .select(selectConConteos)
        .eq('activo', true)
        .order('creado_en', { ascending: false })
        .limit(20);
      if (clubId) q = q.eq('club_id', clubId);

      let { data, error } = await q;
      if (error && /likes_count|comments_count|column/i.test(error.message)) {
        let q2 = supabase
          .from('noticias_feed')
          .select(selectSinConteos)
          .eq('activo', true)
          .order('creado_en', { ascending: false })
          .limit(20);
        if (clubId) q2 = q2.eq('club_id', clubId);
        const retry = await q2;
        data = retry.data;
        error = retry.error;
      }
      if (error) throw error;

      const filas = data ?? [];
      const clubIds = [...new Set(filas.map((n: { club_id: number }) => n.club_id))];
      const nombres = new Map<number, { nombre: string; slug: string | null }>();
      if (clubIds.length > 0) {
        let clubs: { id: number; nombre: string; slug: string | null }[] | null = null;
        const desdeFeed = await supabase
          .from('v_clubes_nombres_feed')
          .select('id, nombre, slug')
          .in('id', clubIds);
        if (!desdeFeed.error) {
          clubs = desdeFeed.data as { id: number; nombre: string; slug: string | null }[] | null;
        } else {
          const desdePublicos = await supabase
            .from('v_clubes_publicos')
            .select('id, nombre, slug')
            .in('id', clubIds);
          clubs = (desdePublicos.data ?? null) as { id: number; nombre: string; slug: string | null }[] | null;
        }
        for (const c of clubs ?? []) {
          nombres.set(Number(c.id), {
            nombre: c.nombre || 'Club',
            slug: c.slug ?? null,
          });
        }
      }

      return filas.map((noticia: {
        id: number;
        club_id: number;
        titulo: string;
        descripcion: string | null;
        imagen_url: string | null;
        creado_en: string;
        likes_count?: number | null;
        comments_count?: number | null;
      }) => {
        const club = nombres.get(noticia.club_id);
        return {
          id: noticia.id,
          club_id: noticia.club_id,
          club_nombre: club?.nombre || 'Club',
          club_slug: club?.slug ?? null,
          titulo: noticia.titulo,
          descripcion: noticia.descripcion,
          imagen_url: noticia.imagen_url,
          creado_en: noticia.creado_en,
          likes_count: Number(noticia.likes_count ?? 0),
          comments_count: Number(noticia.comments_count ?? 0),
        } satisfies NoticiaAppFeed;
      });
    },
    staleTime: 1000 * 60 * 2,
  });
}
