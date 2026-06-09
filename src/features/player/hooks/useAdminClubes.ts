import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface ClubAdmin {
  club_id: number;
  nombre: string;
}

export function useAdminClubes() {
  const [clubes, setClubes] = useState<ClubAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function cargarClubes() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsLoading(false);
          return;
        }

        // Obtener los clubes donde el usuario es admin
        const { data, error: queryError } = await supabase
          .from('usuarios')
          .select('club_id, clubes(id, nombre)')
          .eq('id', user.id)
          .in('rol', ['admin', 'super_admin']);

        if (queryError) throw queryError;

        const clubesAdmin = (data ?? [])
          .filter((u: any) => u.clubes)
          .map((u: any) => ({
            club_id: u.club_id,
            nombre: u.clubes.nombre,
          }));

        setClubes(clubesAdmin);
      } catch (err) {
        console.error('[useAdminClubes]', err);
        setError(err instanceof Error ? err.message : 'Error al cargar clubes');
      } finally {
        setIsLoading(false);
      }
    }

    cargarClubes();
  }, []);

  return { clubes, isLoading, error, esAdmin: clubes.length > 0 };
}
