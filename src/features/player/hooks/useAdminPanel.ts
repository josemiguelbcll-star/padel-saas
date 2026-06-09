import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface CrearPostParams {
  club_id: number;
  titulo: string;
  contenido: string;
  tipo: 'noticia' | 'promo' | 'torneo' | 'otro';
  imagen_url?: string;
  vigente_desde?: string;
  vigente_hasta?: string;
}

export interface CrearPromoParams {
  club_id: number;
  tipo: 'descuento_tarifa' | '2x1_producto';
  nombre: string;
  descripcion?: string;
  tarifa_id?: number;
  porcentaje_descuento?: number;
  producto_id?: number;
  vigente_desde?: string;
  vigente_hasta?: string;
}

export function useAdminPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crearPost = async (params: CrearPostParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('club_posts')
        .insert({
          club_id: params.club_id,
          titulo: params.titulo,
          contenido: params.contenido,
          tipo: params.tipo,
          imagen_url: params.imagen_url || null,
          vigente_desde: params.vigente_desde || null,
          vigente_hasta: params.vigente_hasta || null,
        })
        .select()
        .single();

      if (insertError) throw new Error(insertError.message);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al crear post';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const crearPromo = async (params: CrearPromoParams) => {
    setIsLoading(true);
    setError(null);
    try {
      // Validaciones básicas
      if (params.tipo === 'descuento_tarifa') {
        if (!params.tarifa_id || !params.porcentaje_descuento) {
          throw new Error('Descuento de tarifa requiere tarifa_id y porcentaje');
        }
      } else if (params.tipo === '2x1_producto') {
        if (!params.producto_id) {
          throw new Error('2x1 de producto requiere producto_id');
        }
      }

      const { data, error: insertError } = await supabase
        .from('promociones')
        .insert({
          club_id: params.club_id,
          tipo: params.tipo,
          nombre: params.nombre,
          descripcion: params.descripcion || null,
          tarifa_id: params.tarifa_id || null,
          porcentaje_descuento: params.porcentaje_descuento || null,
          producto_id: params.producto_id || null,
          vigente_desde: params.vigente_desde || null,
          vigente_hasta: params.vigente_hasta || null,
        })
        .select()
        .single();

      if (insertError) throw new Error(insertError.message);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al crear promoción';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { crearPost, crearPromo, isLoading, error, clearError: () => setError(null) };
}
