import { useState, useEffect } from 'react';

export interface NominatimPlace {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  /** [south, north, west, east] as strings */
  boundingbox: [string, string, string, string];
  type: string;
  address: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
  };
}

export function useNominatimAutocomplete(query: string) {
  const [results, setResults] = useState<NominatimPlace[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('q', q);
        url.searchParams.set('format', 'json');
        url.searchParams.set('addressdetails', '1');
        url.searchParams.set('limit', '5');
        url.searchParams.set('featuretype', 'city');

        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { 'Accept-Language': 'es', 'User-Agent': 'MatchGo/1.0 (matchgo.ar)' },
        });
        const data: NominatimPlace[] = await res.json();
        // prefer city/town/village/state results
        const filtered = data.filter((p) =>
          ['city', 'town', 'village', 'administrative', 'suburb', 'municipality'].includes(p.type)
        );
        setResults(filtered.length > 0 ? filtered : data.slice(0, 4));
      } catch {
        // aborted or network error — ignore
      } finally {
        setLoading(false);
      }
    }, 380);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setLoading(false);
    };
  }, [query]);

  return { results, loading };
}

/** Haversine distance in km between two lat/lng points */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
