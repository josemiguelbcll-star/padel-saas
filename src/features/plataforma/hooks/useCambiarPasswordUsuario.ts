import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { USUARIOS_CLUB_PLATAFORMA_QUERY_KEY } from './useUsuariosClubPlataforma';
import { CLUBES_PLATAFORMA_QUERY_KEY } from './useClubesPlataforma';

export interface CambiarPasswordInput {
  userId: string;
  newPassword: string;
  clubId?: number;
}

export function useCambiarPasswordUsuario(): UseMutationResult<
  boolean,
  Error,
  CambiarPasswordInput
> {
  const queryClient = useQueryClient();

  return useMutation<boolean, Error, CambiarPasswordInput>({
    mutationFn: async ({ userId, newPassword }) => {
      // 1. Intentar primero vía RPC directo
      const { error: rpcError } = await supabase.rpc(
        'fn_cambiar_password_usuario_plataforma',
        {
          p_user_id: userId,
          p_nueva_password: newPassword,
        },
      );

      if (!rpcError) {
        return true;
      }

      // 2. Si la RPC no está disponible o falló, intentar vía Edge Function
      const { data, error: fnError } = await supabase.functions.invoke(
        'cambiar-password-usuario',
        {
          body: { userId, newPassword },
        },
      );

      if (fnError) {
        let msg = fnError.message || 'No pudimos actualizar la contraseña.';
        const ctx = (fnError as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = (await ctx.json()) as { error?: string };
            if (body?.error) msg = body.error;
          } catch {
            /* no-op */
          }
        }
        throw new Error(msg);
      }

      if (!data) {
        throw new Error('Error al actualizar la contraseña del usuario.');
      }

      return true;
    },
    onSuccess: (_data, variables) => {
      if (variables.clubId) {
        void queryClient.invalidateQueries({
          queryKey: [USUARIOS_CLUB_PLATAFORMA_QUERY_KEY, variables.clubId],
        });
      }
      void queryClient.invalidateQueries({
        queryKey: CLUBES_PLATAFORMA_QUERY_KEY,
      });
    },
  });
}
