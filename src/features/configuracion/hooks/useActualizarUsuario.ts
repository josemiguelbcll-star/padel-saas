import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth/useSession';
import { USUARIOS_CLUB_QUERY_KEY_BASE } from './useUsuariosClub';
import type { Rol, Usuario } from '@/types/database';

export interface ActualizarUsuarioInput {
  /** UUID del usuario a actualizar. */
  id: string;
  /** Cambios. Al menos uno. */
  changes: {
    nombre?: string;
    rol?: Rol;
    activo?: boolean;
  };
}

/**
 * Actualiza nombre, rol y/o activo de un usuario del club. UPDATE
 * directo via supabase — la RLS `usuarios_update_solo_admin` (0002)
 * restringe a admin del club, y el GRANT column-level (0018) limita
 * las columnas updateables a `(nombre, rol, activo, email)`. El
 * trigger `tr_proteger_ultimo_admin_activo` (0018) es la red de
 * seguridad: bloquea cualquier UPDATE que dejaría al club sin admin
 * activo, con un RAISE EXCEPTION en castellano que mapPostgrestError
 * pasa directo al usuario.
 *
 * Mensajes posibles que el usuario puede ver (todos via dbErrors):
 *   - "No se puede desactivar ni cambiar de rol al último admin
 *      activo del club. Asigná otro admin antes."
 *   - "new row violates row-level security policy" (si no es admin).
 *   - Plus genéricos de red/Postgres.
 */
export function useActualizarUsuario(): UseMutationResult<
  Usuario,
  Error,
  ActualizarUsuarioInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Usuario, Error, ActualizarUsuarioInput>({
    mutationFn: async ({ id, changes }) => {
      if (
        changes.nombre === undefined &&
        changes.rol === undefined &&
        changes.activo === undefined
      ) {
        throw new Error('No hay cambios para guardar.');
      }
      const { data, error } = await supabase
        .from('usuarios')
        .update(changes)
        .eq('id', id)
        .select('id, club_id, nombre, rol, activo, fecha_alta, email')
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Usuario;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [USUARIOS_CLUB_QUERY_KEY_BASE, club?.id],
      });
    },
  });
}
