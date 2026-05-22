import {
  useMutation,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import {
  ALLOWED_LOGO_MIMES,
  LOGOS_BUCKET,
  MAX_LOGO_SIZE_BYTES,
  type AllowedLogoMime,
} from '@/lib/clubBrand';
import { useSession } from '@/features/auth/useSession';

export interface SubirLogoClubInput {
  file: File;
}

export interface SubirLogoClubResult {
  logo_path: string;
}

/**
 * Sube el logo del club a Supabase Storage. Flujo atómico desde el
 * punto de vista del cliente:
 *
 *   1. Valida formato + tamaño en el front (UX rápida; Storage
 *      también valida server-side como red de seguridad — defense in
 *      depth de la 0017).
 *   2. Genera path nuevo `{clubId}/{uuid}.{ext}` (UUID por upload =
 *      cache-busting natural).
 *   3. Upload con `upsert: false` (cada UUID es único — no hay
 *      colisión).
 *   4. UPDATE clubes.logo_path. Si falla, ROLLBACK del upload (best-
 *      effort delete del archivo recién subido para no dejar huérfano).
 *   5. Si había un logo anterior, lo borra del Storage (best-effort —
 *      si falla, queda huérfano sin afectar funcionalidad).
 *   6. updateClub() en el SessionProvider → topbar repinta en vivo.
 *
 * Permisos: las policies RLS de storage.objects (0017) restringen el
 * INSERT/UPDATE/DELETE a admin del club en SU carpeta. El frontend
 * NUNCA usa service_role — sólo la sesión del usuario.
 */
export function useSubirLogoClub(): UseMutationResult<
  SubirLogoClubResult,
  Error,
  SubirLogoClubInput
> {
  const { club, updateClub } = useSession();

  return useMutation<SubirLogoClubResult, Error, SubirLogoClubInput>({
    mutationFn: async ({ file }) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }

      // Validación frontend (UX rápida — sin round-trip para errores
      // obvios). Storage tiene los mismos límites en el bucket (0017).
      if (!ALLOWED_LOGO_MIMES.includes(file.type as AllowedLogoMime)) {
        throw new Error('Formato inválido. Subí PNG o JPG.');
      }
      if (file.size > MAX_LOGO_SIZE_BYTES) {
        throw new Error('El archivo supera 2 MB. Reducilo y volvé a probar.');
      }

      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const newPath = `${club.id}/${crypto.randomUUID()}.${ext}`;
      const oldPath = club.logo_path;

      // 1. Upload del nuevo archivo. Las policies de Storage rechazan
      //    si el primer folder del path no coincide con current_club_id()
      //    o si el rol no es admin.
      const { error: uploadError } = await supabase.storage
        .from(LOGOS_BUCKET)
        .upload(newPath, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) {
        throw new Error(
          uploadError.message ||
            'No pudimos subir el archivo. Revisá tus permisos y volvé a probar.',
        );
      }

      // 2. UPDATE clubes.logo_path. RLS + GRANT (0017) protegen.
      const { data, error: updateError } = await supabase
        .from('clubes')
        .update({ logo_path: newPath })
        .eq('id', club.id)
        .select('logo_path')
        .single();
      if (updateError) {
        // Rollback: borrar el archivo recién subido para no dejar
        // huérfano apuntando a nada. Best-effort; si el delete falla,
        // queda un archivo huérfano (acceptable, no rompe nada).
        await supabase.storage
          .from(LOGOS_BUCKET)
          .remove([newPath])
          .catch(() => {});
        throw new Error(mapPostgrestError(updateError));
      }

      // 3. Borrar el logo anterior (best-effort cleanup). Si falla,
      //    queda huérfano sin afectar funcionalidad. Para no bloquear
      //    el flujo, ignoramos el error.
      if (oldPath) {
        await supabase.storage
          .from(LOGOS_BUCKET)
          .remove([oldPath])
          .catch(() => {});
      }

      return { logo_path: data.logo_path as string };
    },
    onSuccess: (data) => {
      // Merge en el SessionProvider → el topbar repinta sin reload.
      updateClub({ logo_path: data.logo_path });
    },
  });
}
