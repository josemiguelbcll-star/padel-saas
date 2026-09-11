import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { notificarDesafioRecibido, notificarRespuestaDesafio } from '@/lib/notifications';

export interface Desafio {
  id:                  number;
  jugador_app_id_de:   string;
  jugador_app_id_para: string;
  nombre_de:           string;
  nombre_para:         string;
  club_id:             number;
  club_nombre:         string;
  cancha_nombre:       string;
  fecha:               string; // YYYY-MM-DD
  hora_inicio:         string; // HH:MM:SS
  duracion_min:        number;
  mensaje:             string | null;
  estado:              'pendiente' | 'aceptado' | 'jugado' | 'rechazado';
  creado_en:           string;
  soyElProponente:     boolean;
}

export function useDesafios() {
  const [error, setError] = useState<string | null>(null);

  const { data: desafios = [], isLoading, refetch } = useQuery({
    queryKey: ['desafios'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('No hay sesión activa');

      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!jugadorApp) return [];

      const { data, error } = await supabase
        .from('desafios')
        .select(`
          id, jugador_app_id_de, jugador_app_id_para,
          fecha, hora_inicio, duracion_min, mensaje, estado, creado_en,
          club_id, cancha_id,
          club: clubes(nombre),
          cancha: canchas(nombre),
          jugador_de: jugador_app_id_de(nombre_display),
          jugador_para: jugador_app_id_para(nombre_display)
        `)
        .or(`jugador_app_id_de.eq.${jugadorApp.id},jugador_app_id_para.eq.${jugadorApp.id}`)
        .order('creado_en', { ascending: false });

      if (error) throw error;

      return (data ?? []).map((d: any) => ({
        id: d.id,
        jugador_app_id_de: d.jugador_app_id_de,
        jugador_app_id_para: d.jugador_app_id_para,
        nombre_de: d.jugador_de?.nombre_display || 'Jugador',
        nombre_para: d.jugador_para?.nombre_display || 'Jugador',
        club_id: d.club_id,
        club_nombre: d.club?.nombre || 'Club',
        cancha_nombre: d.cancha?.nombre || 'Cancha',
        fecha: d.fecha,
        hora_inicio: d.hora_inicio,
        duracion_min: d.duracion_min,
        mensaje: d.mensaje,
        estado: d.estado,
        creado_en: d.creado_en,
        soyElProponente: d.jugador_app_id_de === jugadorApp.id,
      })) as Desafio[];
    },
    staleTime: 1000 * 60, // 1 min
  });

  const crearDesafio = useCallback(async (params: {
    jugador_id_para: string;
    club_id: number;
    cancha_id: number;
    fecha: string;
    hora_inicio: string;
    duracion_min: number;
    mensaje?: string;
  }) => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id, nombre_display, alias')
        .eq('auth_user_id', user?.id)
        .maybeSingle();

      const { data, error: rpcError } = await supabase.rpc('fn_crear_desafio', {
        p_jugador_app_id_para: params.jugador_id_para,
        p_club_id: params.club_id,
        p_cancha_id: params.cancha_id,
        p_fecha: params.fecha,
        p_hora_inicio: params.hora_inicio,
        p_duracion_min: params.duracion_min,
        p_mensaje: params.mensaje || null,
      });

      if (rpcError) throw new Error(rpcError.message);

      // Notificar al rival
      try {
        const { data: clubData } = await supabase
          .from('clubes')
          .select('nombre')
          .eq('id', params.club_id)
          .maybeSingle();

        const miNombre = jugadorApp?.alias ? `@${jugadorApp.alias}` : (jugadorApp?.nombre_display || 'Un rival');
        const clubNombre = clubData?.nombre || 'Club';

        await notificarDesafioRecibido({
          rivalJugadorId: params.jugador_id_para,
          retadorNombre: miNombre,
          clubNombre,
          fecha: params.fecha,
          hora: params.hora_inicio.slice(0, 5),
          desafioId: data?.id || 0,
        });
      } catch (notifErr) {
        console.warn('[crearDesafio] Error al notificar:', notifErr);
      }

      await refetch();
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al crear desafio';
      setError(msg);
      throw err;
    }
  }, [refetch]);

  const aceptarDesafio = useCallback(async (desafioId: number) => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id, nombre_display, alias')
        .eq('auth_user_id', user?.id)
        .maybeSingle();

      const { data: desafioRow } = await supabase
        .from('desafios')
        .select('id, jugador_app_id_de, fecha, hora_inicio, club:clubes(nombre)')
        .eq('id', desafioId)
        .maybeSingle();

      const { data, error: rpcError } = await supabase.rpc('fn_aceptar_desafio', {
        p_desafio_id: desafioId,
      });

      if (rpcError) throw new Error(rpcError.message);

      // Notificar al retador que su desafío fue aceptado
      if (desafioRow?.jugador_app_id_de) {
        try {
          const miNombre = jugadorApp?.alias ? `@${jugadorApp.alias}` : (jugadorApp?.nombre_display || 'Tu rival');
          const clubNombre = (desafioRow.club as any)?.nombre || 'Club';

          await notificarRespuestaDesafio({
            retadorJugadorId: desafioRow.jugador_app_id_de,
            rivalNombre: miNombre,
            clubNombre,
            fecha: desafioRow.fecha,
            hora: desafioRow.hora_inicio ? desafioRow.hora_inicio.slice(0, 5) : '',
            aceptado: true,
            desafioId,
          });
        } catch (notifErr) {
          console.warn('[aceptarDesafio] Error al notificar:', notifErr);
        }
      }

      await refetch();
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al aceptar desafio';
      setError(msg);
      throw err;
    }
  }, [refetch]);

  const rechazarDesafio = useCallback(async (desafioId: number) => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id, nombre_display, alias')
        .eq('auth_user_id', user?.id)
        .maybeSingle();

      const { data: desafioRow } = await supabase
        .from('desafios')
        .select('id, jugador_app_id_de, fecha, hora_inicio, club:clubes(nombre)')
        .eq('id', desafioId)
        .maybeSingle();

      const { data, error: rpcError } = await supabase.rpc('fn_rechazar_desafio', {
        p_desafio_id: desafioId,
      });

      if (rpcError) throw new Error(rpcError.message);

      // Notificar al retador
      if (desafioRow?.jugador_app_id_de) {
        try {
          const miNombre = jugadorApp?.alias ? `@${jugadorApp.alias}` : (jugadorApp?.nombre_display || 'Tu rival');
          const clubNombre = (desafioRow.club as any)?.nombre || 'Club';

          await notificarRespuestaDesafio({
            retadorJugadorId: desafioRow.jugador_app_id_de,
            rivalNombre: miNombre,
            clubNombre,
            fecha: desafioRow.fecha,
            hora: desafioRow.hora_inicio ? desafioRow.hora_inicio.slice(0, 5) : '',
            aceptado: false,
            desafioId,
          });
        } catch (notifErr) {
          console.warn('[rechazarDesafio] Error al notificar:', notifErr);
        }
      }

      await refetch();
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al rechazar desafio';
      setError(msg);
      throw err;
    }
  }, [refetch]);

  return {
    desafios,
    isLoading,
    error,
    crearDesafio,
    aceptarDesafio,
    rechazarDesafio,
    refetch,
  };
}
