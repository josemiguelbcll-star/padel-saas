import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEPORTES_CATALOGO, detectarDeporte, type DeporteId, type DeporteInfo } from '@/lib/deportes';
import type { ClubPublico, CanchaPublica } from './useClubPublico';

export interface ClubPublicoConCanchas extends ClubPublico {
  canchas: CanchaPublica[];
  deportesDisponibles: DeporteId[];
}

export function useClubsPublicos() {
  const query = useQuery({
    queryKey: ['clubs-publicos-catalogo'],
    queryFn: async () => {
      const [{ data: clubs, error: clubsError }, { data: canchas, error: canchasError }] = await Promise.all([
        supabase.from('v_clubes_publicos').select('*').order('nombre'),
        supabase.from('v_canchas_publicas').select('*').order('orden'),
      ]);

      if (clubsError) throw clubsError;
      if (canchasError) {
        console.warn('[useClubsPublicos] error fetching canchas:', canchasError);
      }

      const allCanchas = (canchas ?? []) as CanchaPublica[];
      const canchasPorClub = new Map<number, CanchaPublica[]>();
      for (const cancha of allCanchas) {
        const list = canchasPorClub.get(cancha.club_id) || [];
        list.push(cancha);
        canchasPorClub.set(cancha.club_id, list);
      }

      const clubsConCanchas: ClubPublicoConCanchas[] = ((clubs ?? []) as ClubPublico[]).map((club) => {
        const clubCanchas = canchasPorClub.get(club.id) || [];
        const deportes = Array.from(new Set(clubCanchas.map((c) => detectarDeporte(c))));
        return {
          ...club,
          canchas: clubCanchas,
          deportesDisponibles: deportes,
        };
      });

      return clubsConCanchas;
    },
    staleTime: 1000 * 60 * 5,
  });

  const clubs = query.data ?? [];

  // Extraer ciudades únicas reales de los clubes registrados
  const ciudades = useMemo(() => {
    const rawCiudades = clubs
      .map((c) => c.ciudad?.trim())
      .filter((c): c is string => !!c && c.length > 0);
    const unique = Array.from(new Set(rawCiudades)).sort((a, b) => a.localeCompare(b, 'es'));
    return unique.length > 0 ? unique : ['Salta'];
  }, [clubs]);

  // Extraer deportes únicos reales que tienen al menos 1 cancha activa registrada
  const deportesDisponibles = useMemo(() => {
    const deportesIds = new Set<DeporteId>();
    for (const club of clubs) {
      for (const d of club.deportesDisponibles) {
        deportesIds.add(d);
      }
    }
    const filteredCatalog = DEPORTES_CATALOGO.filter((dep) => deportesIds.has(dep.id));
    return filteredCatalog.length > 0 ? filteredCatalog : [DEPORTES_CATALOGO[0]!];
  }, [clubs]);

  // Función para obtener deportes disponibles filtrados por ciudad
  const getDeportesPorCiudad = (ciudad?: string): readonly DeporteInfo[] => {
    if (!ciudad) return deportesDisponibles;
    const clubsEnCiudad = clubs.filter(
      (c) => c.ciudad && c.ciudad.toLowerCase().trim() === ciudad.toLowerCase().trim()
    );
    if (clubsEnCiudad.length === 0) return [];
    const deportesIds = new Set<DeporteId>();
    for (const club of clubsEnCiudad) {
      for (const d of club.deportesDisponibles) {
        deportesIds.add(d);
      }
    }
    const filtered = DEPORTES_CATALOGO.filter((dep) => deportesIds.has(dep.id));
    return filtered.length > 0 ? filtered : deportesDisponibles;
  };

  return {
    ...query,
    data: clubs,
    clubs,
    ciudades,
    deportesDisponibles,
    getDeportesPorCiudad,
  };
}
