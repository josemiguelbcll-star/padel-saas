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
import type { Cuenta, CuentaConSaldo } from '@/types/database';

export const CUENTAS_QUERY_KEY = ['cuentas'] as const;

/**
 * Campos que el frontend envía al crear/actualizar una cuenta. `id`,
 * `club_id` (sesión, RLS valida) y `fecha_alta` (DEFAULT) se omiten.
 */
export type CuentaInput = Omit<Cuenta, 'id' | 'club_id' | 'fecha_alta'>;

/**
 * Lista de cuentas del club CON su saldo, leída de la vista
 * `v_cuentas_saldo` (Etapa 1: saldo = saldo_inicial). Ordenada server-side
 * por `orden` y luego `nombre`.
 */
export function useCuentas(): UseQueryResult<CuentaConSaldo[], Error> {
  return useQuery<CuentaConSaldo[], Error>({
    queryKey: CUENTAS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_saldo')
        .select('*')
        .order('orden', { ascending: true })
        .order('nombre', { ascending: true });
      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as CuentaConSaldo[];
    },
  });
}

export function useCrearCuenta(): UseMutationResult<Cuenta, Error, CuentaInput> {
  const queryClient = useQueryClient();
  const { club } = useSession();

  return useMutation<Cuenta, Error, CuentaInput>({
    mutationFn: async (input) => {
      if (!club) {
        throw new Error(
          'No pudimos identificar tu club. Refrescá la página e intentá nuevamente.',
        );
      }
      const { data, error } = await supabase
        .from('cuentas')
        .insert({ ...input, club_id: club.id })
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Cuenta;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUENTAS_QUERY_KEY });
    },
  });
}

interface ActualizarCuentaArgs {
  id: number;
  changes: Partial<CuentaInput>;
}

export function useActualizarCuenta(): UseMutationResult<
  Cuenta,
  Error,
  ActualizarCuentaArgs
> {
  const queryClient = useQueryClient();

  return useMutation<Cuenta, Error, ActualizarCuentaArgs>({
    mutationFn: async ({ id, changes }) => {
      const { data, error } = await supabase
        .from('cuentas')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(mapPostgrestError(error));
      return data as Cuenta;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUENTAS_QUERY_KEY });
    },
  });
}
