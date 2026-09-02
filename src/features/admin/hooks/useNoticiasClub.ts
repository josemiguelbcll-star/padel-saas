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
 * Optimiza y comprime la imagen en el navegador antes de subirla a Supabase.
 * Reduce el peso de 5-10MB a ~150KB en formato WebP para que cargue al instante.
 */
async function optimizarImagen(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1600;
        let { width, height } = img;

        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          if (width / height > MAX_WIDTH / MAX_HEIGHT) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          } else {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              resolve(blob ?? file);
            },
            'image/webp',
            0.85
          );
        } else {
          resolve(file);
        }
      };
      img.onerror = () => resolve(file);
      img.src = event.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
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
    if (file.size > 15 * 1024 * 1024) {
      throw new Error('Imagen muy grande (máximo 15MB)');
    }

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type) && !file.type.startsWith('image/')) {
      throw new Error('Solo formatos de imagen (JPG, PNG, WebP)');
    }

    // Optimizar imagen para carga ultra rápida
    const optimizedBlob = await optimizarImagen(file);
    const timestamp = Date.now();
    const filename = `noticias/${clubId}/${timestamp}.webp`;

    const { data, error: uploadError } = await supabase.storage
      .from('club-posts-images')
      .upload(filename, optimizedBlob, { 
        cacheControl: '31536000', 
        contentType: 'image/webp',
        upsert: false 
      });

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
