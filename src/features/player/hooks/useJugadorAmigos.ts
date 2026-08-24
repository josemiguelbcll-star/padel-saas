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
  foto_url:       string | null;
  confirmado:     boolean;
  vinculado_en:   string;
  soySolicitante: boolean; // true si yo mandé la solicitud, false si me la mandaron a mí
}

export function useJugadorAmigos() {
  const [error, setError] = useState<string | null>(null);

  const { data: amigos = [], isLoading, refetch } = useQuery<Amigo[]>({
    queryKey: ['jugador-amigos'],
    queryFn: async () => {
      // Obtener el ID del jugador_app actual
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await withTimeout(
        supabase
          .from('jugadores_app')
          .select('id')
          .eq('auth_user_id', user.id)
          .maybeSingle(),
        20000,
        'useJugadorAmigos:jugadores_app',
      );

      if (!jugadorApp) return [];

      const { data: relaciones, error } = await withTimeout(
        supabase
          .from('jugador_amigos')
          .select('jugador_app_id_1, jugador_app_id_2, confirmado, vinculado_en')
          .or(`jugador_app_id_1.eq.${jugadorApp.id},jugador_app_id_2.eq.${jugadorApp.id}`),
        20000,
        'useJugadorAmigos:jugador_amigos',
      );

      if (error) throw error;
      const rels = (relaciones ?? []) as Array<{
        jugador_app_id_1: string;
        jugador_app_id_2: string;
        confirmado: boolean;
        vinculado_en: string;
        solicitante_id?: string;
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
          .select('id, nombre_display, alias, genero, categoria, foto_url')
          .in('id', friendIds) as any,
        20000,
        'useJugadorAmigos:jugadores_app_friends',
      ) as any);

      if (amigosError) throw amigosError;
      const amigosMap = new Map<string, any>(
        (amigosRows ?? []).map((row: any) => [row.id as string, row]),
      );

      return rels.map((rel) => {
        const friendId = rel.jugador_app_id_1 === jugadorApp.id ? rel.jugador_app_id_2 : rel.jugador_app_id_1;
        const amigoData = amigosMap.get(friendId);

        // Clave de almacenamiento local para rastrear remitente exacto
        const id1 = rel.jugador_app_id_1 < rel.jugador_app_id_2 ? rel.jugador_app_id_1 : rel.jugador_app_id_2;
        const id2 = rel.jugador_app_id_1 < rel.jugador_app_id_2 ? rel.jugador_app_id_2 : rel.jugador_app_id_1;
        const storageSenderKey = `mg_freq_sender_${id1}_${id2}`;
        const savedSenderId = localStorage.getItem(storageSenderKey);

        let soySolicitante = false;
        if (rel.solicitante_id) {
          soySolicitante = rel.solicitante_id === jugadorApp.id;
        } else if (savedSenderId) {
          soySolicitante = savedSenderId === jugadorApp.id;
        } else {
          // Fallback por defecto: si id_1 es el actual, asumimos solicitante
          soySolicitante = rel.jugador_app_id_1 === jugadorApp.id;
        }

        if (!amigoData) {
          return {
            id: friendId,
            nombre_display: 'Jugador desconocido',
            alias: null,
            genero: null,
            categoria: null,
            foto_url: null,
            confirmado: rel.confirmado,
            vinculado_en: rel.vinculado_en,
            soySolicitante,
          } as Amigo;
        }

        return {
          id: amigoData.id,
          nombre_display: amigoData.nombre_display,
          alias: amigoData.alias,
          genero: amigoData.genero,
          categoria: amigoData.categoria,
          foto_url: amigoData.foto_url,
          confirmado: rel.confirmado,
          vinculado_en: rel.vinculado_en,
          soySolicitante,
        } as Amigo;
      });
    },
    staleTime: 1000 * 60 * 5, // 5 min
  });

  const agregarAmigo = useCallback(async (jugadorDestino: { id: string; nombre_display: string }) => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id, nombre_display, alias')
        .eq('auth_user_id', user.id)
        .single();

      if (!jugadorApp) throw new Error('Perfil de jugador no encontrado');

      // 1. Guardar localmente la autoría explícita de quién es el remitente (Juancho)
      const id1 = jugadorApp.id < jugadorDestino.id ? jugadorApp.id : jugadorDestino.id;
      const id2 = jugadorApp.id < jugadorDestino.id ? jugadorDestino.id : jugadorApp.id;
      localStorage.setItem(`mg_freq_sender_${id1}_${id2}`, jugadorApp.id);

      // 2. Intentar insertar en la BD
      let { error } = await supabase
        .from('jugador_amigos')
        .insert({
          jugador_app_id_1: jugadorApp.id,
          jugador_app_id_2: jugadorDestino.id,
          confirmado: false,
          solicitante_id: jugadorApp.id,
        });

      if (error) {
        // Fallback si la restricción exige id1 < id2
        const { error: e2 } = await supabase
          .from('jugador_amigos')
          .insert({
            jugador_app_id_1: id1,
            jugador_app_id_2: id2,
            confirmado: false,
          });
        if (e2) throw e2;
      }

      // 3. Notificación explícita al destinatario
      try {
        const miNombre = jugadorApp.alias ? `@${jugadorApp.alias}` : (jugadorApp.nombre_display || 'Un jugador');
        await supabase.from('notificaciones').insert({
          jugador_app_id: jugadorDestino.id,
          titulo: '🤝 ¡Nueva solicitud de amistad!',
          mensaje: `${miNombre} quiere agregarte como amigo en MatchGo.`,
          tipo: 'solicitud_amigo',
          leido: false,
        });
      } catch {}

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
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!jugadorApp) throw new Error('Perfil de jugador no encontrado');

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

  const rechazarAmigo = useCallback(async (amigoId: string) => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!jugadorApp) throw new Error('Perfil de jugador no encontrado');

      const id1 = jugadorApp.id < amigoId ? jugadorApp.id : amigoId;
      const id2 = jugadorApp.id < amigoId ? amigoId : jugadorApp.id;

      const { error } = await supabase
        .from('jugador_amigos')
        .delete()
        .eq('jugador_app_id_1', id1)
        .eq('jugador_app_id_2', id2);

      if (error) throw error;
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al rechazar solicitud';
      setError(msg);
      throw err;
    }
  }, [refetch]);

  const solicitudesRecibidas = amigos.filter(a => !a.confirmado && !a.soySolicitante);
  const solicitudesEnviadas  = amigos.filter(a => !a.confirmado && a.soySolicitante);
  const amigosConfirmados     = amigos.filter(a => a.confirmado);

  return {
    amigos,
    solicitudesRecibidas,
    solicitudesEnviadas,
    amigosConfirmados,
    pendientesRecibidasCount: solicitudesRecibidas.length,
    isLoading,
    error,
    agregarAmigo,
    confirmarAmigo,
    rechazarAmigo,
    refetch,
  };
}

