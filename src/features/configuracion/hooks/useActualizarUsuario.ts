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
    permisos?: any;
  };
}

/**
 * Actualiza nombre, rol, activo y/o permisos de un usuario del club. UPDATE
 * directo via supabase — la RLS `usuarios_update_solo_admin` (0002)
 * restringe a admin del club, y el GRANT column-level (0018) limita
 * las columnas updateables. El trigger `tr_proteger_ultimo_admin_activo` (0018)
 * es la red de seguridad.
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
        changes.activo === undefined &&
        changes.permisos === undefined
      ) {
        throw new Error('No hay cambios para guardar.');
      }
      const { data, error } = await supabase
        .from('usuarios')
        .update(changes)
        .eq('id', id)
        .select('id, club_id, nombre, rol, activo, fecha_alta, email, permisos')
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
