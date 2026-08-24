import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface PartidoAbiertoDb {
  id: number;
  reserva_id: number;
  organizador_id: string;
  categoria: string;
  faltan_jugadores: number;
  posicion_buscada: string;
  nota: string | null;
  visibilidad: 'cualquiera' | 'amigos';
  creado_en: string;
  reserva: {
    fecha: string;
    hora_inicio: string;
    club: { nombre: string } | null;
    cancha: { nombre: string } | null;
  } | null;
  organizador: {
    id: string;
    nombre_display: string;
    alias: string | null;
    foto_url: string | null;
  } | null;
  participantes: Array<{
    id: number;
    jugador_app_id: string;
    confirmado: boolean;
    solicitado_by: 'organizador' | 'jugador';
    jugador: {
      nombre_display: string;
      alias: string | null;
      foto_url: string | null;
    } | null;
  }>;
}

export function usePartidosAbiertos() {
  const query = useQuery<PartidoAbiertoDb[]>({
    queryKey: ['partidos-abiertos'],
    queryFn: async () => {
      const hoy = new Date().toISOString().slice(0, 10);

      // 1. Obtener partidos abiertos activos (futuros)
      const { data: partidos, error: partidosError } = await supabase
        .from('partidos_abiertos')
        .select(`
          id,
          reserva_id,
          organizador_id,
          categoria,
          faltan_jugadores,
          posicion_buscada,
          nota,
          visibilidad,
          creado_en,
          reserva:reserva_id!inner(
            fecha,
            hora_inicio,
            club:clubes(nombre),
            cancha:canchas(nombre)
          ),
          organizador:jugadores_app(
            id,
            nombre_display,
            alias,
            foto_url
          )
        `)
        .gte('reserva.fecha', hoy)
        .order('creado_en', { ascending: false });

      if (partidosError) throw partidosError;

      // 2. Obtener participantes e invitaciones para estos partidos
      const partidoIds = (partidos ?? []).map(p => p.id);
      if (partidoIds.length === 0) return [];

      const { data: participants, error: partError } = await supabase
        .from('partido_participantes')
        .select(`
          id,
          partido_abierto_id,
          jugador_app_id,
          confirmado,
          solicitado_by,
          jugador:jugadores_app(
            nombre_display,
            alias,
            foto_url
          )
        `)
        .in('partido_abierto_id', partidoIds);

      if (partError) throw partError;

      const participantsGrouped = new Map<number, any[]>();
      for (const part of (participants ?? [])) {
        if (!participantsGrouped.has(part.partido_abierto_id)) {
          participantsGrouped.set(part.partido_abierto_id, []);
        }
        participantsGrouped.get(part.partido_abierto_id)!.push({
          id: part.id,
          jugador_app_id: part.jugador_app_id,
          confirmado: part.confirmado,
          solicitado_by: part.solicitado_by,
          jugador: part.jugador as any,
        });
      }

      return (partidos ?? []).map((p: any) => ({
        id: p.id,
        reserva_id: p.reserva_id,
        organizador_id: p.organizador_id,
        categoria: p.categoria,
        faltan_jugadores: p.faltan_jugadores,
        posicion_buscada: p.posicion_buscada,
        nota: p.nota,
        visibilidad: p.visibilidad,
        creado_en: p.creado_en,
        reserva: p.reserva,
        organizador: p.organizador,
        participantes: participantsGrouped.get(p.id) ?? [],
      })) as PartidoAbiertoDb[];
    },
    staleTime: 1000 * 30, // 30 segundos
  });

  return {
    partidos: query.data ?? [],
    isLoading: query.isLoading,
    refetch: () => query.refetch(),
  };
}

export function useInvitacionesPendientes() {
  return useQuery({
    queryKey: ['invitaciones-pendientes'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [];

      const { data: jugadorApp } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (!jugadorApp) return [];

      const { data, error } = await supabase
        .from('partido_participantes')
        .select(`
          id,
          confirmado,
          solicitado_by,
          partido:partido_abierto_id(
            id,
            categoria,
            posicion_buscada,
            nota,
            organizador:jugadores_app(
              nombre_display,
              alias,
              foto_url
            ),
            reserva:reserva_id(
              fecha,
              hora_inicio,
              club:clubes(nombre),
              cancha:canchas(nombre)
            )
          )
        `)
        .eq('jugador_app_id', jugadorApp.id)
        .eq('confirmado', false)
        .eq('solicitado_by', 'organizador');

      if (error) throw error;
      
      return (data ?? []).filter((inv: any) => inv.partido) as any[];
    },
    staleTime: 1000 * 30,
  });
}

export function usePartidosMutations() {
  const queryClient = useQueryClient();

  const getMiJugadorAppId = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('Sin sesión activa');

    const { data: jugadorApp } = await supabase
      .from('jugadores_app')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!jugadorApp) throw new Error('Perfil de jugador no encontrado');
    return jugadorApp.id;
  };

  const publicarPartido = useMutation({
    mutationFn: async (params: {
      reservaId: number;
      categoria: string;
      faltanJugadores: number;
      posicionBuscada: string;
      nota: string;
      visibilidad: 'cualquiera' | 'amigos';
    }) => {
      const organizadorId = await getMiJugadorAppId();

      const { data, error } = await supabase
        .from('partidos_abiertos')
        .insert({
          reserva_id: params.reservaId,
          organizador_id: organizadorId,
          categoria: params.categoria,
          faltan_jugadores: params.faltanJugadores,
          posicion_buscada: params.posicionBuscada,
          nota: params.nota || null,
          visibilidad: params.visibilidad,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['partidos-abiertos'] });
    },
  });

  const invitarAmigo = useMutation({
    mutationFn: async (params: { partidoId: number; amigoId: string }) => {
      const { data, error } = await supabase
        .from('partido_participantes')
        .insert({
          partido_abierto_id: params.partidoId,
          jugador_app_id: params.amigoId,
          confirmado: false,
          solicitado_by: 'organizador',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['partidos-abiertos'] });
    },
  });

  const solicitarUnirse = useMutation({
    mutationFn: async (params: { partidoId: number }) => {
      const miJugadorId = await getMiJugadorAppId();
      const { data, error } = await supabase
        .from('partido_participantes')
        .insert({
          partido_abierto_id: params.partidoId,
          jugador_app_id: miJugadorId,
          confirmado: false,
          solicitado_by: 'jugador',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['partidos-abiertos'] });
    },
  });

  const responderInvitacion = useMutation({
    mutationFn: async (params: { participanteId: number; aceptar: boolean }) => {
      if (params.aceptar) {
        const { data, error } = await supabase
          .from('partido_participantes')
          .update({ confirmado: true })
          .eq('id', params.participanteId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } else {
        const { error } = await supabase
          .from('partido_participantes')
          .delete()
          .eq('id', params.participanteId);

        if (error) throw error;
        return null;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['partidos-abiertos'] });
      void queryClient.invalidateQueries({ queryKey: ['invitaciones-pendientes'] });
    },
  });

  const eliminarPartido = useMutation({
    mutationFn: async (partidoId: number) => {
      const { error } = await supabase
        .from('partidos_abiertos')
        .delete()
        .eq('id', partidoId);

      if (error) throw error;
      return null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['partidos-abiertos'] });
    },
  });

  return {
    publicarPartido,
    invitarAmigo,
    solicitarUnirse,
    responderInvitacion,
    eliminarPartido,
  };
}
