import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/features/auth/useSession';
import { USUARIOS_CLUB_QUERY_KEY_BASE } from './useUsuariosClub';
import type { Rol } from '@/types/database';

export interface CrearVendedorInput {
  nombre: string;
  email: string;
  password: string;
  rol: Rol;
}

export interface CrearVendedorResult {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
}

/**
 * Crea un usuario nuevo vía Edge Function `crear-vendedor`. La function
 * hace el trabajo crítico server-side: valida que el caller sea admin,
 * deriva el `club_id` del caller (NUNCA del input), crea en `auth.users`
 * con service_role, INSERTA en `usuarios`, hace rollback si algo falla.
 *
 * Errores que la function devuelve (mensajes en castellano):
 *   - 400: validaciones de formato (email, password, nombre, rol).
 *   - 401: sin JWT o JWT inválido.
 *   - 403: no admin / desactivado / sin perfil.
 *   - 409: email ya existe en auth.users.
 *   - 500: error interno (rollback fallido, etc.).
 *
 * Como `supabase.functions.invoke` no propaga el body de respuestas 4xx
 * por default, parseamos manualmente el `context.body` cuando hay error
 * para extraer el mensaje en castellano y mostrarlo al usuario.
 *
 * Al éxito invalida la query de la lista para refrescar.
 */
export function useCrearVendedor(): UseMutationResult<
  CrearVendedorResult,
  Error,
  CrearVendedorInput
> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<CrearVendedorResult, Error, CrearVendedorInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke(
        'crear-vendedor',
        { body: input },
      );

      if (error) {
        // supabase-js v2 mete la response 4xx/5xx en error.context
        // (un Response). Intentamos extraer el `error` field del body
        // — es el mensaje en castellano que la function devuelve.
        // Si no se puede (red caída, body no-JSON), caemos al
        // error.message genérico.
        let mensaje = error.message || 'No pudimos crear el usuario.';
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = (await ctx.json()) as { error?: string };
            if (body?.error) mensaje = body.error;
          } catch {
            /* body no-JSON o ya consumido — usamos message genérico */
          }
        }
        throw new Error(mensaje);
      }

      if (!data) {
        throw new Error(
          'La función respondió sin datos. Refrescá la página y revisá si el usuario quedó creado.',
        );
      }

      return data as CrearVendedorResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [USUARIOS_CLUB_QUERY_KEY_BASE, club?.id],
      });
    },
  });
}
