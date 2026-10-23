import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { useSession } from '@/features/auth';
import type { PromoBuffet } from '@/types/database';

export const PROMOS_BUFFET_QUERY_KEY = ['promos-buffet'] as const;

export interface PromoBuffetItemInput {
  producto_id: number;
  cantidad: number;
}

export interface GuardarPromoBuffetInput {
  promo_id: number | null;
  nombre: string;
  items: PromoBuffetItemInput[];
}

export function usePromosBuffet() {
  const { club } = useSession();

  return useQuery<PromoBuffet[], Error>({
    queryKey: [...PROMOS_BUFFET_QUERY_KEY, club?.id],
    queryFn: async () => {
      if (!club) return [];

      const { data, error } = await supabase
        .from('promos_buffet')
        .select('*, items:promo_buffet_items(*)')
        .eq('club_id', club.id)
        .order('nombre');

      if (error) throw new Error(mapPostgrestError(error));
      return (data ?? []) as PromoBuffet[];
    },
    enabled: !!club,
  });
}

export function useGuardarPromoBuffet() {
  const queryClient = useQueryClient();

  return useMutation<PromoBuffet, Error, GuardarPromoBuffetInput>({
    mutationFn: async ({ promo_id, nombre, items }) => {
      const { data, error } = await supabase.rpc('fn_guardar_promo_buffet', {
        p_promo_id: promo_id,
        p_nombre: nombre.trim(),
        p_items: items,
      });

      if (error) throw new Error(mapPostgrestError(error));
      if (!data) throw new Error('No recibimos confirmación al guardar la promo.');
      return data as PromoBuffet;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROMOS_BUFFET_QUERY_KEY });
    },
  });
}

export function useCambiarEstadoPromoBuffet() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { promoId: number; activo: boolean }>({
    mutationFn: async ({ promoId, activo }) => {
      const { error } = await supabase
        .from('promos_buffet')
        .update({ activo })
        .eq('id', promoId);

      if (error) throw new Error(mapPostgrestError(error));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROMOS_BUFFET_QUERY_KEY });
    },
  });
}
