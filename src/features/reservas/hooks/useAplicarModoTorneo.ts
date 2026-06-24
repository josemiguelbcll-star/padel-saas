import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';
import { JUGADORES_QUERY_KEY_BASE } from './useJugadores';

export interface AplicarModoTorneoInput {
  fecha: string; // YYYY-MM-DD
  hora_inicio: string; // HH:MM:SS
  hora_fin: string; // HH:MM:SS
  cancha_ids: number[];
  nombre_torneo: string;
}

export interface ReservaAfectadaTorneo {
  reserva_id: number;
  jugador_nombre: string;
  telefono: string | null;
  tipo_turno: 'fijo' | 'suelto';
  monto_reembolsado: number;
}

/**
 * Hook de react-query para ejecutar el "Modo Torneo" (cancelación masiva, bloqueos y acreditación de saldo).
 * Al finalizar con éxito, refresca la grilla del día afectado y las cuentas corrientes de jugadores.
 */
export function useAplicarModoTorneo(): UseMutationResult<
  ReservaAfectadaTorneo[],
  Error,
  AplicarModoTorneoInput
> {
  const queryClient = useQueryClient();

  return useMutation<ReservaAfectadaTorneo[], Error, AplicarModoTorneoInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_aplicar_modo_torneo', {
        p_fecha: input.fecha,
        p_hora_inicio: input.hora_inicio,
        p_hora_fin: input.hora_fin,
        p_cancha_ids: input.cancha_ids,
        p_nombre_torneo: input.nombre_torneo.trim(),
      });

      if (error) {
        throw new Error(mapPostgrestError(error));
      }

      return (data ?? []) as ReservaAfectadaTorneo[];
    },
    onSuccess: (_, variables) => {
      // Refrescar grilla del día
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, variables.fecha],
      });
      // Refrescar saldos de los jugadores (cuentas corrientes)
      void queryClient.invalidateQueries({
        queryKey: [JUGADORES_QUERY_KEY_BASE],
      });
    },
  });
}
