import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/network';

export interface Amigo {
  id:             string; // UUID del jugador_app
  nombre_display: string;
  alias:          string | null;
  genero:         string | null;
  categoria:      string | null;
  avatars_path:   string | null;
  confirmado:     boolean;
  vinculado_en:   string;
}

export function useJugadorAmigos() {
  const [error, setError] = useState<string | null>(null);

  const { data: amigos = [], isLoading, refetch } = useQuery({
    queryKey: ['jugador-amigos'],
    queryFn: async () => {
      // Obtener el ID del jugador_app actual
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await (withTimeout(
        supabase
          .from('jugadores_app')
          .select('id')
          .eq('auth_user_id', user.id)
          .single() as any,
        8000,
        'useJugadorAmigos:jugadores_app',
      ) as any);

      if (!jugadorApp) throw new Error('Perfil de jugador no encontrado');

      const { data: relaciones, error } = await (withTimeout(
        supabase
          .from('jugador_amigos')
          .select('jugador_app_id_1, jugador_app_id_2, confirmado, vinculado_en')
          .or(`jugador_app_id_1.eq.${jugadorApp.id},jugador_app_id_2.eq.${jugadorApp.id}`) as any,
        8000,
        'useJugadorAmigos:jugador_amigos',
      ) as any);

      if (error) throw error;
      const rels = (relaciones ?? []) as Array<{
        jugador_app_id_1: string;
        jugador_app_id_2: string;
        confirmado: boolean;
        vinculado_en: string;
      }>;

      const friendIds = rels.map((rel) =>
        rel.jugador_app_id_1 === jugadorApp.id ? rel.jugador_app_id_2 : rel.jugador_app_id_1,
      );

      if (friendIds.length === 0) {
        return [];
      }

      const { data: amigosRows, error: amigosError } = await (withTimeout(
        supabase
          .from('jugadores_app')
          .select('id, nombre_display, alias, genero, categoria, avatars_path')
          .in('id', friendIds) as any,
        8000,
        'useJugadorAmigos:jugadores_app_friends',
      ) as any);

      if (amigosError) throw amigosError;
      const amigosMap = new Map<string, any>(
        (amigosRows ?? []).map((row: any) => [row.id as string, row]),
      );

      return rels.map((rel) => {
        const friendId = rel.jugador_app_id_1 === jugadorApp.id ? rel.jugador_app_id_2 : rel.jugador_app_id_1;
        const amigoData = amigosMap.get(friendId);
        if (!amigoData) {
          return {
            id: friendId,
            nombre_display: 'Jugador desconocido',
            alias: null,
            genero: null,
            categoria: null,
            avatars_path: null,
            confirmado: rel.confirmado,
            vinculado_en: rel.vinculado_en,
          } as Amigo;
        }

        return {
          id: amigoData.id,
          nombre_display: amigoData.nombre_display,
          alias: amigoData.alias,
          genero: amigoData.genero,
          categoria: amigoData.categoria,
          avatars_path: amigoData.avatars_path,
          confirmado: rel.confirmado,
          vinculado_en: rel.vinculado_en,
        } as Amigo;
      });
    },
    staleTime: 1000 * 60 * 5, // 5 min
  });

  const agregarAmigo = useCallback(async (jugadorDestino: { id: string; nombre_display: string }) => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!jugadorApp) throw new Error('Perfil de jugador no encontrado');

      // Evitar duplicados: siempre guardar con el menor ID primero
      const id1 = jugadorApp.id < jugadorDestino.id ? jugadorApp.id : jugadorDestino.id;
      const id2 = jugadorApp.id < jugadorDestino.id ? jugadorDestino.id : jugadorApp.id;

      const { error } = await supabase
        .from('jugador_amigos')
        .insert({
          jugador_app_id_1: id1,
          jugador_app_id_2: id2,
          confirmado: false, // Inicio como pendiente
        });

      if (error) throw error;
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al agregar amigo';
      setError(msg);
      throw err;
    }
  }, [refetch]);

  const confirmarAmigo = useCallback(async (amigoId: string) => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!jugadorApp) throw new Error('Perfil de jugador no encontrado');

      // Determinar el orden correcto de IDs
      const id1 = jugadorApp.id < amigoId ? jugadorApp.id : amigoId;
      const id2 = jugadorApp.id < amigoId ? amigoId : jugadorApp.id;

      const { error } = await supabase
        .from('jugador_amigos')
        .update({ confirmado: true })
        .eq('jugador_app_id_1', id1)
        .eq('jugador_app_id_2', id2);

      if (error) throw error;
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al confirmar amigo';
      setError(msg);
      throw err;
    }
  }, [refetch]);

  return { amigos, isLoading, error, agregarAmigo, confirmarAmigo, refetch };
}
