import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/features/auth';

/**
 * Hook de sincronización en memoria en tiempo real (Nivel 2: Realtime WebSockets).
 *
 * Mantiene la grilla de reservas y el estado del mostrador actualizados en RAM
 * ante cualquier evento (INSERT, UPDATE, DELETE) en reservas o consumos,
 * evitando la necesidad de recargas manuales o polling continuo.
 */
export function useReservasRealtimeSync(fecha?: string) {
  const queryClient = useQueryClient();
  const { club } = useSession();
  const clubId = club?.id;

  useEffect(() => {
    if (!clubId) return;

    const channelName = `realtime:club_${clubId}_reservas_${fecha ?? 'all'}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservas',
          filter: `club_id=eq.${clubId}`,
        },
        () => {
          // Invalida la grilla en memoria para revalidar limpiamente
          void queryClient.invalidateQueries({ queryKey: ['reservas-del-dia'] });
          void queryClient.invalidateQueries({ queryKey: ['reservas'] });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reserva_consumos',
        },
        (payload) => {
          const reservaId = (payload.new as { reserva_id?: number })?.reserva_id
            ?? (payload.old as { reserva_id?: number })?.reserva_id;

          if (reservaId) {
            void queryClient.invalidateQueries({
              queryKey: ['reserva_consumos', reservaId],
            });
          }
          void queryClient.invalidateQueries({ queryKey: ['reservas-del-dia'] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clubId, fecha, queryClient]);
}
