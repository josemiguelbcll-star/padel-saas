import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface NoticiaFeed {
  id: number;
  club_id: number;
  titulo: string;
  descripcion: string | null;
  imagen_url: string | null;
  creado_en: string;
  activo: boolean;
}

/**
 * Hook para cargar noticias del club (solo las propias)
 */
export function useNoticiasClub(clubId: number) {
  return useQuery({
    queryKey: ['noticias-club', clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('noticias_feed')
        .select('*')
        .eq('club_id', clubId)
        .eq('activo', true)
        .order('creado_en', { ascending: false });

      if (error) throw error;
      return (data as NoticiaFeed[]) || [];
    },
    enabled: !!clubId,
  });
}

/**
 * Hook para crear noticia (usa RPC)
 */
export function useCrearNoticia() {
  const createNoticia = async (
    clubId: number,
    titulo: string,
    descripcion: string,
    imagenUrl?: string
  ) => {
    const { data, error } = await supabase.rpc('fn_crear_noticia_feed', {
      p_club_id: clubId,
      p_titulo: titulo,
      p_descripcion: descripcion,
      p_imagen_url: imagenUrl || null,
    });

    if (error) throw error;
    return data?.[0];
  };

  const subirImagen = async (file: File, clubId: number): Promise<string> => {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('Imagen muy grande (máximo 10MB)');
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Solo JPG, PNG o WebP');
    }

    const timestamp = Date.now();
    const ext = file.name.split('.').pop();
    const filename = `noticias/${clubId}/${timestamp}.${ext}`;

    const { data, error: uploadError } = await supabase.storage
      .from('club-posts-images')
      .upload(filename, file, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabase.storage
      .from('club-posts-images')
      .getPublicUrl(data.path);

    return publicUrl.publicUrl;
  };

  return { createNoticia, subirImagen };
}

/**
 * Hook para editar noticia
 */
export function useEditarNoticia() {
  const editNoticia = async (
    noticiaId: number,
    titulo: string,
    descripcion: string,
    imagenUrl?: string | null
  ) => {
    const { error } = await supabase
      .from('noticias_feed')
      .update({
        titulo: titulo,
        descripcion: descripcion,
        imagen_url: imagenUrl,
      })
      .eq('id', noticiaId);

    if (error) throw error;
  };

  return { editNoticia };
}

/**
 * Hook para eliminar noticia
 */
export function useEliminarNoticia() {
  return async (noticiaId: number) => {
    const { error } = await supabase
      .from('noticias_feed')
      .update({ activo: false })
      .eq('id', noticiaId);

    if (error) throw error;
  };
}
