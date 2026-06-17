import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';

export interface Notificacion {
  id:             number;
  jugador_app_id: string;
  titulo:         string;
  mensaje:        string;
  leido:          boolean;
  fecha:          string; // TIMESTAMPTZ
  tipo:           string;
  metadata:       any;
}

export const NOTIFICACIONES_QUERY_KEY = ['notificaciones-jugador'] as const;

export function useNotificaciones() {
  const { user } = useSession();
  const queryClient = useQueryClient();

  // 1. Obtener notificaciones del jugador actual
  const query = useQuery<Notificacion[], Error>({
    queryKey: NOTIFICACIONES_QUERY_KEY,
    queryFn: async () => {
      if (!user) return [];

      // Obtener el ID de jugador_app
      const { data: playerApp, error: playerError } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (playerError || !playerApp) return [];

      const { data, error } = await supabase
        .from('notificaciones')
        .select('*')
        .eq('jugador_app_id', playerApp.id)
        .order('fecha', { ascending: false })
        .limit(20);

      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as Notificacion[];
    },
    enabled: !!user,
    staleTime: 1000 * 30, // 30 segundos
  });

  // 2. Marcar una notificación como leída
  const marcarLeidaMutation = useMutation<void, Error, number>({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from('notificaciones')
        .update({ leido: true })
        .eq('id', id);

      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICACIONES_QUERY_KEY });
    },
  });

  // 3. Marcar todas como leídas
  const marcarTodasLeidasMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!user) return;

      const { data: playerApp } = await supabase
        .from('jugadores_app')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!playerApp) return;

      const { error } = await supabase
        .from('notificaciones')
        .update({ leido: true })
        .eq('jugador_app_id', playerApp.id)
        .eq('leido', false);

      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICACIONES_QUERY_KEY });
    },
  });

  const unreadCount = query.data?.filter(n => !n.leido).length ?? 0;

  return {
    notificaciones: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    unreadCount,
    marcarLeida: marcarLeidaMutation.mutate,
    marcarTodasLeidas: marcarTodasLeidasMutation.mutate,
    refetch: query.refetch,
  };
}
