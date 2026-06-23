import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ReservaAppConfirmada {
  reserva_id:      number;
  cancha_nombre:   string;
  club_nombre:     string;
  fecha:           string;
  hora_inicio:     string;
  hora_fin:        string;
  duracion_min:    number;
  monto_total:     number;
  monto_sena:      number;
  cbu_alias:       string | null;
  nombre_banco:    string | null;
  instagram:       string | null;
  sena_porcentaje: number;
  sena_tipo?:      'porcentaje' | 'fijo';
  sena_valor?:     number;
}

export function useReservarDesdeApp() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (params: {
      cancha_id:    number;
      fecha:        string;
      hora_inicio:  string;
      duracion_min: number;
    }): Promise<ReservaAppConfirmada> => {
      const { data, error: rpcError } = await supabase.rpc('fn_reservar_desde_app', {
        p_cancha_id:    params.cancha_id,
        p_fecha:        params.fecha,
        p_hora_inicio:  params.hora_inicio,
        p_duracion_min: params.duracion_min,
      });
      if (rpcError) throw new Error(rpcError.message);
      return data as ReservaAppConfirmada;
    },
    onSuccess: () => {
      // Invalida reservas del jugador y disponibilidad del club/bulk
      void queryClient.invalidateQueries({ queryKey: ['my-reservas'] });
      void queryClient.invalidateQueries({ queryKey: ['disponibilidad-club'] });
      void queryClient.invalidateQueries({ queryKey: ['disponibilidad-bulk'] });
    },
  });

  const reservar = async (params: {
    cancha_id:    number;
    fecha:        string;
    hora_inicio:  string;
    duracion_min: number;
  }): Promise<ReservaAppConfirmada | null> => {
    try {
      return await mutation.mutateAsync(params);
    } catch (err) {
      return null;
    }
  };

  const error = mutation.error instanceof Error ? mutation.error.message : null;

  return {
    reservar,
    isLoading: mutation.isPending,
    error,
    clearError: () => mutation.reset(),
  };
}
