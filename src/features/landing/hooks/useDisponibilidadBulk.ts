import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type BulkRow = {
  club_slug: string;
  cancha_id: number;
  cancha_nombre: string;
  hora_inicio: string;
  hora_fin: string;
  disponible: boolean;
};

/**
 * Trae disponibilidad de TODOS los clubes públicos para una fecha.
 * Devuelve Map<club_slug, hora_inicio[]> — solo las horas DISPONIBLES,
 * deduplicadas entre canchas (si Cancha 1 y 2 tienen 08:00 libre → aparece una sola vez).
 */
export function useDisponibilidadBulk(fecha: string, enabled = true) {
  return useQuery({
    queryKey: ['disponibilidad-bulk', fecha],
    enabled: enabled && !!fecha,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_disponibilidad_bulk', { p_fecha: fecha });
      if (error) throw error;

      const map = new Map<string, string[]>();
      for (const row of (data ?? []) as BulkRow[]) {
        if (!row.disponible) continue;
        const hora = row.hora_inicio.slice(0, 5);
        if (!map.has(row.club_slug)) map.set(row.club_slug, []);
        const arr = map.get(row.club_slug)!;
        if (!arr.includes(hora)) arr.push(hora);
      }
      for (const [, arr] of map) arr.sort();
      return map;
    },
  });
}
