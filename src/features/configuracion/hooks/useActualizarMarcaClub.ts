import {
  useMutation,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth/useSession';
import type { CondicionFiscalClub } from '@/types/database';

export interface ActualizarMarcaClubInput {
  /**
   * Cambios a aplicar — al menos uno requerido. La RLS (admin del club)
   * y el GRANT UPDATE column-level (nombre, color_primario_hsl en 0016;
   * logo_path en 0017; condicion_fiscal en 0042) son los que protegen
   * — el frontend no agrega validación extra de permisos, sólo de
   * forma.
   */
  nombre?: string;
  color_primario_hsl?: string;
  condicion_fiscal?: CondicionFiscalClub;
}

export interface MarcaClubResult {
  nombre: string;
  color_primario_hsl: string;
  condicion_fiscal: CondicionFiscalClub;
}

/**
 * Actualiza la marca + datos fiscales del club. UPDATE directo via
 * supabase-js — la política RLS `clubes_update_solo_admin_horarios`
 * (0003) y los GRANT column-level (0016 + 0017 + 0042) cubren la
 * seguridad: sólo el admin del club puede UPDATEar las columnas
 * autorizadas.
 *
 * Al éxito mergea el patch en el SessionProvider vía `updateClub`. El
 * `useEffect` de inyección de color, que está suscripto a
 * `state.club?.color_primario_hsl`, dispara automáticamente: aplica el
 * `--primary` nuevo y reescribe el cache de localStorage (anti-flash
 * próximo reload).
 */
export function useActualizarMarcaClub(): UseMutationResult<
  MarcaClubResult,
  Error,
  ActualizarMarcaClubInput
> {
  const { club, updateClub } = useSession();

  return useMutation<MarcaClubResult, Error, ActualizarMarcaClubInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      if (
        input.nombre === undefined &&
        input.color_primario_hsl === undefined &&
        input.condicion_fiscal === undefined
      ) {
        throw new Error('No hay cambios para guardar.');
      }
      const { data, error } = await supabase
        .from('clubes')
        .update(input)
        .eq('id', club.id)
        .select('nombre, color_primario_hsl, condicion_fiscal')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as MarcaClubResult;
    },
    onSuccess: (data) => {
      // Merge en el SessionProvider — esto dispara el useEffect que
      // aplica el --primary nuevo en vivo + reescribe el cache.
      updateClub({
        nombre: data.nombre,
        color_primario_hsl: data.color_primario_hsl,
        condicion_fiscal: data.condicion_fiscal,
      });
    },
  });
}
