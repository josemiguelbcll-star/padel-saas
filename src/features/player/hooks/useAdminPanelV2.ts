import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface PostFormData {
  titulo: string;
  contenido: string;
  tipo: 'noticia' | 'promo' | 'torneo' | 'otro';
  imagen_url?: string | null;
  badge?: string | null;
  cta_texto?: string | null;
  cta_link?: string | null;
  duracion_horas?: number | null;
}

export function useAdminPanelV2() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Subir imagen a Storage
   */
  async function subirImagen(file: File, clubId: number): Promise<string> {
    if (!file) throw new Error('No hay archivo');

    // Validar tamaño (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Imagen muy grande (máximo 5MB)');
    }

    // Validar tipo
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Solo JPG, PNG o WebP');
    }

    // Generar nombre sanitizado
    const timestamp = Date.now();
    const ext = file.name.split('.').pop();
    const filename = `club_${clubId}/${timestamp}.${ext}`;

    // Subir a Storage
    const { data, error: uploadError } = await supabase.storage
      .from('club-posts-images')
      .upload(filename, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('[subirImagen] Error:', uploadError);
      throw new Error(`Error al subir: ${uploadError.message}`);
    }

    // Obtener URL pública
    const { data: publicUrl } = supabase.storage
      .from('club-posts-images')
      .getPublicUrl(data.path);

    return publicUrl.publicUrl;
  }

  /**
   * Crear post con imagen
   */
  async function crearPost(clubId: number, data: PostFormData): Promise<any> {
    setIsLoading(true);
    setError(null);

    try {
      // Validar campos requeridos
      if (!data.titulo || !data.contenido) {
        throw new Error('Título y contenido son requeridos');
      }

      // Crear post via RPC
      const { data: result, error: rpcError } = await supabase.rpc(
        'fn_crear_post_con_imagen',
        {
          p_club_id: clubId,
          p_titulo: data.titulo,
          p_contenido: data.contenido,
          p_tipo: data.tipo,
          p_imagen_url: data.imagen_url || null,
          p_badge: data.badge || null,
          p_cta_texto: data.cta_texto || null,
          p_cta_link: data.cta_link || null,
          p_duracion_horas: data.duracion_horas || 24,
        }
      );

      if (rpcError) {
        console.error('[crearPost] RPC Error:', rpcError);
        throw new Error(rpcError.message || 'Error al crear post');
      }

      return result?.[0] || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Dar "Me gusta" a un post
   */
  async function darMeGusta(postId: number): Promise<number> {
    try {
      const { data, error: rpcError } = await supabase.rpc(
        'fn_dar_me_gusta_post',
        {
          p_post_id: postId,
        }
      );

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      return data || 0;
    } catch (err) {
      console.error('[darMeGusta]', err);
      throw err;
    }
  }

  return {
    isLoading,
    error,
    subirImagen,
    crearPost,
    darMeGusta,
  };
}
