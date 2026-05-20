import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { Club } from '@/types/database';

export const CLUB_HORARIOS_QUERY_KEY = ['club', 'horarios'] as const;

/**
 * Subset de columnas de `clubes` que el frontend puede actualizar (en
 * coherencia con el GRANT UPDATE acotado a estas 3 columnas que define
 * la migración 0003).
 */
export type HorariosClub = Pick<
  Club,
  'hora_apertura' | 'hora_cierre' | 'duracion_turno_default'
>;

/**
 * Lee los horarios del club desde Postgres con un select acotado.
 *
 * Por qué una query dedicada en lugar de leer del session.club:
 *   - Permite invalidación granular tras `useUpdateHorariosClub` sin
 *     tener que tocar el ciclo de vida del SessionProvider.
 *   - Mantiene el contrato claro: HorariosPage <-> tabla clubes.
 *
 * El session.club sigue siendo válido para mostrar el NOMBRE del club
 * en el topbar (que no cambia con esta mutación), pero `hora_apertura`,
 * `hora_cierre` y `duracion_turno_default` que se lean ahí pueden
 * quedar desactualizados tras un update. En sprint 2 sólo HorariosPage
 * los consume y usa este hook; cuando llegue la grilla del sprint 3
 * vamos a decidir si refrescar la sesión o seguir con query dedicada.
 */
export function useHorariosClub(): UseQueryResult<HorariosClub, Error> {
  const { club } = useSession();

  return useQuery<HorariosClub, Error>({
    queryKey: CLUB_HORARIOS_QUERY_KEY,
    queryFn: async () => {
      if (!club) {
        throw new Error('No hay sesión activa.');
      }
      const { data, error } = await supabase
        .from('clubes')
        .select('hora_apertura, hora_cierre, duracion_turno_default')
        .eq('id', club.id)
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as HorariosClub;
    },
    enabled: !!club,
  });
}

export function useUpdateHorariosClub(): UseMutationResult<
  HorariosClub,
  Error,
  HorariosClub
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<HorariosClub, Error, HorariosClub>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('clubes')
        .update(input)
        .eq('id', club.id)
        .select('hora_apertura, hora_cierre, duracion_turno_default')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as HorariosClub;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLUB_HORARIOS_QUERY_KEY });
    },
  });
}
