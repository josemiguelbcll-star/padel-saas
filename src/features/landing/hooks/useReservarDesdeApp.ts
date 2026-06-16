import { useState } from 'react';
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
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function reservar(params: {
    cancha_id:    number;
    fecha:        string;
    hora_inicio:  string;
    duracion_min: number;
  }): Promise<ReservaAppConfirmada | null> {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('fn_reservar_desde_app', {
        p_cancha_id:    params.cancha_id,
        p_fecha:        params.fecha,
        p_hora_inicio:  params.hora_inicio,
        p_duracion_min: params.duracion_min,
      });
      if (rpcError) throw new Error(rpcError.message);
      return data as ReservaAppConfirmada;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al reservar. Intentá de nuevo.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  return { reservar, isLoading, error, clearError: () => setError(null) };
}
