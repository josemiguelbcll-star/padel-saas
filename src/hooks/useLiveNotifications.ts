import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/features/auth/useSession';

export interface NotificationItem {
  id: number;
  jugadorNombre: string;
  canchaNombre: string;
  fecha: string;
  horaInicio: string;
  fechaAlta: string;
  read: boolean;
}

export function useLiveNotifications() {
  const { club } = useSession();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Play a sweet premium double-tone chime using Web Audio API
  const playSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.15, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = audioCtx.currentTime;
      playTone(698.46, now, 0.15); // F5
      playTone(1046.50, now + 0.1, 0.3); // C6
    } catch (e) {
      console.warn('AudioContext blocked or not supported:', e);
    }
  }, []);

  // Fetch initial notifications (last 5 reservations)
  useEffect(() => {
    if (!club?.id) return;

    async function fetchInitial() {
      try {
        const { data, error } = await supabase
          .from('reservas')
          .select('id, fecha, hora_inicio, cancha:cancha_id(nombre), jugador:jugador_id(nombre), fecha_alta')
          .eq('club_id', club.id)
          .order('fecha_alta', { ascending: false })
          .limit(5);

        if (error) {
          console.error('[useLiveNotifications] Error fetching initial reservations:', error);
          return;
        }

        if (data) {
          const items: NotificationItem[] = data.map((d: any) => ({
            id: d.id,
            jugadorNombre: d.jugador?.nombre || 'Jugador Anónimo',
            canchaNombre: d.cancha?.nombre || 'Cancha',
            fecha: d.fecha,
            horaInicio: d.hora_inicio,
            fechaAlta: d.fecha_alta,
            read: true, // Existing items are read by default
          }));
          setNotifications(items);
        }
      } catch (err) {
        console.error('[useLiveNotifications] Fetch exception:', err);
      }
    }

    fetchInitial();
  }, [club?.id]);

  // Subscribe to realtime inserts
  useEffect(() => {
    if (!club?.id) return;

    const channel = supabase
      .channel(`reservas-realtime-${club.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'reservas',
          filter: `club_id=eq.${club.id}`,
        },
        async (payload: any) => {
          const newId = payload.new.id;

          try {
            // Fetch names since realtime insert payload only has raw IDs
            const { data, error } = await supabase
              .from('reservas')
              .select('id, fecha, hora_inicio, cancha:cancha_id(nombre), jugador:jugador_id(nombre), fecha_alta')
              .eq('id', newId)
              .single();

            if (error) {
              console.error('[useLiveNotifications] Error loading inserted reservation details:', error);
              return;
            }

            if (data) {
              const newItem: NotificationItem = {
                id: data.id,
                jugadorNombre: data.jugador?.nombre || 'Jugador Anónimo',
                canchaNombre: data.cancha?.nombre || 'Cancha',
                fecha: data.fecha,
                horaInicio: data.hora_inicio,
                fechaAlta: data.fecha_alta,
                read: false,
              };

              setNotifications((prev) => [newItem, ...prev.slice(0, 9)]); // Keep last 10
              setUnreadCount((c) => c + 1);
              playSound();
            }
          } catch (err) {
            console.error('[useLiveNotifications] Realtime handling error:', err);
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [club?.id, playSound]);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  return {
    notifications,
    unreadCount,
    markAllAsRead,
  };
}
