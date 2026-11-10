import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/features/auth/useSession';

export interface NotificationItem {
  id: number;
  reserva_id: number | null;
  titulo: string;
  mensaje: string;
  link: string;
  creada_en: string;
  leida: boolean;
  read: boolean;
}

export function useLiveNotifications() {
  const { club, user } = useSession();
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

  // Load persisted reservation and payment notifications for this club user.
  useEffect(() => {
    if (!club?.id || !user?.id) return;
    const clubId = club.id;
    const userId = user.id;

    async function fetchInitial() {
      try {
        const { data, error } = await supabase
          .from('notificaciones_club')
          .select('id, reserva_id, titulo, mensaje, link, creada_en, leida')
          .eq('club_id', clubId)
          .eq('usuario_id', userId)
          .order('creada_en', { ascending: false })
          .limit(20);

        if (error) {
          console.error('[useLiveNotifications] Error fetching initial reservations:', error);
          return;
        }

        if (data) {
          const items: NotificationItem[] = (data ?? []).map((item) => ({
            ...item,
            read: item.leida,
          }));
          setNotifications(items);
          setUnreadCount(items.filter((item) => !item.leida).length);
        }
      } catch (err) {
        console.error('[useLiveNotifications] Fetch exception:', err);
      }
    }

    fetchInitial();
  }, [club?.id, user?.id]);

  // Subscribe to realtime inserts
  useEffect(() => {
    if (!club?.id || !user?.id) return;
    const clubId = club.id;
    const userId = user.id;

    const channel = supabase
      .channel(`reservas-realtime-${clubId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notificaciones_club',
          filter: `usuario_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Omit<NotificationItem, 'read'>;
          const newItem: NotificationItem = { ...row, read: row.leida };
          setNotifications((previous) => [newItem, ...previous.filter((item) => item.id !== row.id).slice(0, 19)]);
          if (!newItem.leida) setUnreadCount((count) => count + 1);
          playSound();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [club?.id, user?.id, playSound]);

  const markAllAsRead = useCallback(() => {
    if (!club?.id || !user?.id) return;
    setNotifications((prev) => prev.map((notification) => ({ ...notification, leida: true, read: true })));
    setUnreadCount(0);
    void supabase
      .from('notificaciones_club')
      .update({ leida: true })
      .eq('club_id', club.id)
      .eq('usuario_id', user.id)
      .eq('leida', false)
      .then(({ error }) => {
        if (error) console.warn('[useLiveNotifications] No se pudieron marcar leídas:', error);
      });
  }, [club?.id, user?.id]);

  return {
    notifications,
    unreadCount,
    markAllAsRead,
  };
}
