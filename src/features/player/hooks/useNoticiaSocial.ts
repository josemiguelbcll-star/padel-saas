import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';

export interface NoticiaComentario {
  id: number;
  cuerpo: string;
  creado_en: string;
  autor_nombre: string;
  autor_foto: string | null;
}

export const NOTICIA_SOCIAL_KEY = (noticiaId: number) =>
  ['noticia-social', noticiaId] as const;

export function useNoticiaSocial(noticiaId: number, likesCount: number) {
  const queryClient = useQueryClient();

  const comentariosQuery = useQuery({
    queryKey: [...NOTICIA_SOCIAL_KEY(noticiaId), 'comentarios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('noticias_comentarios')
        .select('id, cuerpo, creado_en, jugadores_app(nombre_display, foto_url)')
        .eq('noticia_id', noticiaId)
        .eq('activo', true)
        .order('creado_en', { ascending: true })
        .limit(40);
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []).map((row) => {
        const autor = row.jugadores_app as
          | { nombre_display?: string; foto_url?: string | null }
          | { nombre_display?: string; foto_url?: string | null }[]
          | null;
        const a = Array.isArray(autor) ? autor[0] : autor;
        return {
          id: row.id as number,
          cuerpo: row.cuerpo as string,
          creado_en: row.creado_en as string,
          autor_nombre: a?.nombre_display ?? 'Jugador',
          autor_foto: a?.foto_url ?? null,
        } satisfies NoticiaComentario;
      });
    },
    enabled: noticiaId > 0,
    staleTime: 20_000,
  });

  const likesCountQuery = useQuery({
    queryKey: [...NOTICIA_SOCIAL_KEY(noticiaId), 'likesCount'],
    queryFn: async () => likesCount,
    initialData: likesCount,
    enabled: noticiaId > 0,
  });

  const likedQuery = useQuery({
    queryKey: [...NOTICIA_SOCIAL_KEY(noticiaId), 'liked'],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) return false;
      const { data: jugador } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', uid)
        .maybeSingle();
      if (!jugador) return false;
      const { data, error } = await supabase
        .from('noticias_likes')
        .select('id')
        .eq('noticia_id', noticiaId)
        .eq('jugador_app_id', jugador.id)
        .maybeSingle();
      if (error) throw new Error(mapPostgrestError(error));
      return !!data;
    },
    enabled: noticiaId > 0,
    staleTime: 20_000,
  });

  const likeMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('fn_toggle_noticia_like', {
        p_noticia_id: noticiaId,
      });
      if (error) throw new Error(mapPostgrestError(error));
      const row = Array.isArray(data) ? data[0] : data;
      return {
        liked: Boolean(row?.liked),
        likes_count: Number(row?.likes_count ?? likesCount),
      };
    },
    onSuccess: (res) => {
      queryClient.setQueryData([...NOTICIA_SOCIAL_KEY(noticiaId), 'liked'], res.liked);
      queryClient.setQueryData(
        [...NOTICIA_SOCIAL_KEY(noticiaId), 'likesCount'],
        res.likes_count,
      );
      queryClient.invalidateQueries({ queryKey: ['noticias-app-feed'] });
      queryClient.invalidateQueries({ queryKey: ['noticias-club-publicas'] });
    },
  });

  const comentarMut = useMutation({
    mutationFn: async (cuerpo: string) => {
      const { data, error } = await supabase.rpc('fn_comentar_noticia', {
        p_noticia_id: noticiaId,
        p_cuerpo: cuerpo,
      });
      if (error) throw new Error(mapPostgrestError(error));
      const row = Array.isArray(data) ? data[0] : data;
      return {
        id: Number(row.id),
        cuerpo: String(row.cuerpo),
        creado_en: String(row.creado_en),
        autor_nombre: String(row.autor_nombre ?? 'Jugador'),
        autor_foto: (row.autor_foto as string | null) ?? null,
      } satisfies NoticiaComentario;
    },
    onSuccess: (comentario) => {
      queryClient.setQueryData<NoticiaComentario[]>(
        [...NOTICIA_SOCIAL_KEY(noticiaId), 'comentarios'],
        (prev) => [...(prev ?? []), comentario],
      );
      queryClient.invalidateQueries({ queryKey: ['noticias-app-feed'] });
      queryClient.invalidateQueries({ queryKey: ['noticias-club-publicas'] });
    },
  });

  return {
    comentarios: comentariosQuery.data ?? [],
    likesCount: likesCountQuery.data ?? likesCount,
    liked: likedQuery.data ?? false,
    likePending: likeMut.isPending,
    comentarPending: comentarMut.isPending,
    likeError: likeMut.error?.message ?? null,
    comentarError: comentarMut.error?.message ?? null,
    toggleLike: () => likeMut.mutate(),
    comentar: (cuerpo: string) => comentarMut.mutateAsync(cuerpo),
  };
}
