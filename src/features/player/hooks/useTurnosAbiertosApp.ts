import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface TurnoAbierto {
  club_id:         number;
  club_nombre:     string;
  cancha_id:       number;
  cancha_nombre:   string;
  fecha:           string; // YYYY-MM-DD
  hora_inicio:     string; // HH:MM:SS
  hora_fin:        string;
  duracion_min:    number;
  precio:          number;
  cantidad_jugadores: number; // cuántos tienen reserva
  vacias:          number; // cuántos espacios libres (asumiendo 4 jugadores por cancha)
}

export function useTurnosAbiertosApp() {
  return useQuery({
    queryKey: ['turnos-abiertos-app'],
    queryFn: async () => {
      // Obtener todas las reservas de los próximos 7 días (no canceladas)
      const hoy = new Date().toISOString().slice(0, 10);
      const en7Dias = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const { data: reservas, error } = await supabase
        .from('reservas')
        .select(`
          id, club_id, cancha_id, fecha, hora_inicio,
          duracion_min, tarifa_id,
          club: clubes(nombre),
          cancha: canchas(nombre),
          tarifa: tarifas(precio)
        `)
        .gte('fecha', hoy)
        .lte('fecha', en7Dias)
        .neq('estado', 'cancelada');

      if (error) throw error;

      // Agrupar por (club, cancha, fecha, hora_inicio, duracion)
      // y contar cuántos jugadores hay
      const turnosMap = new Map<string, TurnoAbierto>();

      const datos = (reservas ?? []) as any[];
      for (const res of datos) {
        const key = `${res.club_id}|${res.cancha_id}|${res.fecha}|${res.hora_inicio}|${res.duracion_min}`;

        if (!turnosMap.has(key)) {
          const horaFin = new Date(`2000-01-01T${res.hora_inicio}:00`);
          horaFin.setMinutes(horaFin.getMinutes() + res.duracion_min);
          const horaFinStr = horaFin.toTimeString().slice(0, 5);

          turnosMap.set(key, {
            club_id: res.club_id,
            club_nombre: res.club?.nombre || 'Club',
            cancha_id: res.cancha_id,
            cancha_nombre: res.cancha?.nombre || 'Cancha',
            fecha: res.fecha,
            hora_inicio: res.hora_inicio,
            hora_fin: horaFinStr,
            duracion_min: res.duracion_min,
            precio: res.tarifa?.precio || 0,
            cantidad_jugadores: 0,
            vacias: 0,
          });
        }

        const turno = turnosMap.get(key)!;
        turno.cantidad_jugadores++;
      }

      // Calcular espacios libres (asumiendo 4 jugadores máximo por turno)
      const JUGADORES_POR_CANCHA = 4;
      for (const turno of turnosMap.values()) {
        turno.vacias = Math.max(0, JUGADORES_POR_CANCHA - turno.cantidad_jugadores);
      }

      // Devolver solo turnos que tengan espacios libres, ordenados por fecha
      return Array.from(turnosMap.values())
        .filter(t => t.vacias > 0)
        .sort((a, b) => {
          if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
          return a.hora_inicio.localeCompare(b.hora_inicio);
        });
    },
    staleTime: 1000 * 60 * 3, // 3 min (cambios en reservas son frecuentes)
  });
}
