import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { notificarJugador } from '@/lib/notifications';
import type { Amigo } from './useJugadorAmigos';

export interface ReservaInvitacion {
  id: number;
  club_id: number;
  reserva_id: number;
  invita_jugador_app_id: string;
  invitado_jugador_app_id: string;
  estado: 'pendiente' | 'aceptada' | 'rechazada';
  creada_en: string;
  respondida_en: string | null;
}

interface RespuestaInvitacion {
  estado: 'aceptada' | 'rechazada';
  reserva_id: number;
  club_id?: number;
  club_nombre?: string;
  cancha_nombre?: string;
  fecha?: string;
  hora_inicio?: string;
  invita_jugador_app_id?: string;
}

const queryKey = (reservaId?: number) => ['reservas-invitaciones', reservaId] as const;

export function useReservasInvitaciones(reservaId?: number) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!reservaId) return;
    const channel = supabase
      .channel(`reserva-invitaciones-${reservaId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reserva_invitaciones',
          filter: `reserva_id=eq.${reservaId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKey(reservaId) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [reservaId, queryClient]);

  const query = useQuery<ReservaInvitacion[], Error>({
    queryKey: queryKey(reservaId),
    queryFn: async () => {
      if (!reservaId) return [];
      const { data, error } = await supabase
        .from('reserva_invitaciones')
        .select('*')
        .eq('reserva_id', reservaId)
        .order('creada_en', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReservaInvitacion[];
    },
    enabled: Boolean(reservaId),
  });

  async function invitarAmigo(
    amigo: Amigo,
    reserva: { id: number; club_id: number; club_nombre: string; cancha_nombre: string; fecha: string; hora_inicio: string },
    remitente: string,
  ): Promise<void> {
    const { data, error } = await supabase.rpc('fn_invitar_amigo_a_reserva', {
      p_reserva_id: reserva.id,
      p_amigo_jugador_app_id: amigo.id,
    });
    if (error) throw error;
    const invitacion = data as ReservaInvitacion;

    await notificarJugador({
      jugadorAppId: amigo.id,
      authUserId: amigo.auth_user_id,
      titulo: 'Invitación a una cancha',
      mensaje: `${remitente} te invitó a jugar en ${reserva.club_nombre}, ${reserva.cancha_nombre}.`,
      tipo: 'invitacion_reserva',
      metadata: {
        invitacion_id: invitacion.id,
        reserva_id: reserva.id,
        club_id: reserva.club_id,
        club_nombre: reserva.club_nombre,
        cancha_nombre: reserva.cancha_nombre,
        fecha: reserva.fecha,
        hora_inicio: reserva.hora_inicio,
      },
      link: '/player/partidos',
    });
    await queryClient.invalidateQueries({ queryKey: queryKey(reserva.id) });
  }

  async function responderInvitacion(invitacionId: number, aceptar: boolean): Promise<RespuestaInvitacion> {
    const { data, error } = await supabase.rpc('fn_responder_invitacion_reserva', {
      p_invitacion_id: invitacionId,
      p_aceptar: aceptar,
    });
    if (error) throw error;
    const respuesta = data as RespuestaInvitacion;

    if (respuesta.invita_jugador_app_id) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: miPerfil } = await supabase
        .from('jugadores_app')
        .select('nombre_display')
        .eq('auth_user_id', user?.id ?? '')
        .maybeSingle();
      await notificarJugador({
        jugadorAppId: respuesta.invita_jugador_app_id,
        titulo: 'Invitación aceptada',
        mensaje: respuesta.estado === 'aceptada'
          ? `${miPerfil?.nombre_display ?? 'Tu amigo'} aceptó la invitación a tu turno.`
          : `${miPerfil?.nombre_display ?? 'Tu amigo'} no podrá sumarse a tu turno.`,
        tipo: respuesta.estado === 'aceptada' ? 'invitacion_aceptada' : 'invitacion_rechazada',
        metadata: { invitacion_id: invitacionId, reserva_id: respuesta.reserva_id },
        link: '/player/partidos',
      });
    }

    void queryClient.invalidateQueries({ queryKey: queryKey(respuesta.reserva_id) });
    void queryClient.invalidateQueries({ queryKey: ['my-reservas'] });
    return respuesta;
  }

  return {
    invitaciones: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    invitarAmigo,
    responderInvitacion,
  };
}