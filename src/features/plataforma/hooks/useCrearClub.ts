import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { CLUBES_PLATAFORMA_QUERY_KEY } from './useClubesPlataforma';

export interface CrearClubInput {
  club: {
    nombre: string;
    plan_id: number;
  };
  admin: {
    nombre: string;
    email: string;
    password: string;
  };
}

export interface CrearClubResult {
  club: {
    id: number;
    nombre: string;
    slug: string;
    plan_id: number;
    estado: string;
  };
  admin: {
    id: string;
    email: string;
    nombre: string;
  };
}

/**
 * Onboarding atómico de un club nuevo + su primer admin desde el panel
 * de plataforma. Llama a la Edge Function `crear-club`, que server-side:
 *   - Valida que el caller sea superadmin activo (gate).
 *   - Valida el plan (existe y activo).
 *   - Genera slug único.
 *   - INSERT club + createUser auth + INSERT usuarios (rol=admin).
 *   - ROLLBACK EN CASCADA si algún paso falla.
 *
 * Mensajes que el usuario puede ver (todos en castellano, vienen del body
 * de la respuesta de la function):
 *   - 400: validaciones de formato + "Plan inválido o no activo."
 *   - 401: sin JWT / JWT inválido (anon, service_role, expirado).
 *   - 403: "Solo el superadmin de la plataforma puede crear clubes." /
 *          "Tu usuario está desactivado."
 *   - 409: "Ya existe un usuario con ese email."
 *   - 500: error interno (rollback fallido — pide contactar soporte).
 *
 * Mismo patrón de extracción del mensaje que `useCrearVendedor`:
 * supabase-js no propaga el body de respuestas 4xx/5xx por default,
 * así que parseamos `error.context.body` manualmente.
 *
 * Al éxito invalida `CLUBES_PLATAFORMA_QUERY_KEY` para refrescar la
 * lista del panel con el club recién creado.
 */
export function useCrearClub(): UseMutationResult<
  CrearClubResult,
  Error,
  CrearClubInput
> {
  const queryClient = useQueryClient();

  return useMutation<CrearClubResult, Error, CrearClubInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.functions.invoke(
        'crear-club',
        { body: input },
      );

      if (error) {
        let mensaje = error.message || 'No pudimos crear el club.';
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
          'La función respondió sin datos. Refrescá la lista para verificar si el club quedó creado.',
        );
      }

      return data as CrearClubResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: CLUBES_PLATAFORMA_QUERY_KEY,
      });
    },
  });
}
