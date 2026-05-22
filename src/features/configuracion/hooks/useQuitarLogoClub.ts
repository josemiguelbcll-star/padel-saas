import {
  useMutation,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { LOGOS_BUCKET } from '@/lib/clubBrand';
import { useSession } from '@/features/auth/useSession';

/**
 * Quita el logo del club:
 *   1. UPDATE clubes SET logo_path = NULL.
 *   2. Borra el archivo del Storage (best-effort — si falla, queda
 *      huérfano sin afectar funcionalidad).
 *   3. updateClub() en el SessionProvider → topbar vuelve a solo nombre.
 *
 * Si el club no tenía logo (logo_path ya era null), la mutación
 * retorna sin hacer nada (no es error).
 */
export function useQuitarLogoClub(): UseMutationResult<void, Error, void> {
  const { club, updateClub } = useSession();

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const oldPath = club.logo_path;
      if (!oldPath) return;

      // 1. UPDATE clubes.logo_path = null. RLS + GRANT (0016/0017)
      //    protegen — sólo admin del club puede modificar logo_path.
      const { error: updateError } = await supabase
        .from('clubes')
        .update({ logo_path: null })
        .eq('id', club.id);
      if (updateError) {
        throw new Error(mapPostgrestError(updateError));
      }

      // 2. Borrar el archivo (best-effort cleanup).
      await supabase.storage
        .from(LOGOS_BUCKET)
        .remove([oldPath])
        .catch(() => {});
    },
    onSuccess: () => {
      updateClub({ logo_path: null });
    },
  });
}
