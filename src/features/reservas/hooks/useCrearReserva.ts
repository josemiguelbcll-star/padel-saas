import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { EstadoReserva, MedioPago, Reserva } from '@/types/database';
import { RESERVAS_QUERY_KEY_BASE } from './useReservasDelDia';

/**
 * Datos que el modal de nueva reserva pasa al hook.
 *
 * - `jugadores_ids`: IDs de los acompañantes registrados (0..3).
 * - `nombres_libres`: nombres de acompañantes que todavía no son
 *   jugadores registrados (0..3).
 * - `medio_pago`: null si no hubo pago inicial (monto_pagado === 0).
 *
 * La RPC fn_crear_reserva calcula hora_fin como hora_inicio + duracion_min
 * server-side, así que NO se pasa.
 */
export interface CrearReservaInput {
  cancha_id: number;
  /** 'YYYY-MM-DD' */
  fecha: string;
  /** 'HH:MM' o 'HH:MM:SS' */
  hora_inicio: string;
  duracion_min: number;
  /** Titular: jugador registrado o null si todos los participantes son "nombres libres". */
  jugador_titular_id: number | null;
  jugadores_ids: number[];
  nombres_libres: string[];
  tarifa_id: number | null;
  monto_total: number;
  monto_pagado: number;
  medio_pago: MedioPago | null;
  estado: EstadoReserva;
  observaciones: string | null;
}

/**
 * Crea una reserva invocando la RPC fn_crear_reserva, que orquesta en
 * una transacción los INSERTs en reservas + reserva_jugadores +
 * (opcional) reserva_pagos.
 *
 * Errores que el usuario puede ver (mapeados por dbErrors):
 *   - "Ese horario ya está ocupado en esa cancha..." (no_overlap_reservas)
 *   - "La hora de fin tiene que ser posterior a la de inicio."
 *   - "El monto pagado no puede ser mayor al total..."
 *   - "Si hay un pago, el medio de pago es obligatorio." (RAISE de la RPC)
 *   - "No tenés permisos..." (RLS, raro porque las policies de reservas
 *      están abiertas a todo authenticated del club)
 *
 * Al éxito invalida la query de reservas del día tocado para que la
 * grilla se refresque sola.
 */
export function useCrearReserva(): UseMutationResult<
  Reserva,
  Error,
  CrearReservaInput
> {
  const queryClient = useQueryClient();

  return useMutation<Reserva, Error, CrearReservaInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.rpc('fn_crear_reserva', {
        p_cancha_id: input.cancha_id,
        p_fecha: input.fecha,
        p_hora_inicio: input.hora_inicio,
        p_duracion_min: input.duracion_min,
        p_jugador_titular_id: input.jugador_titular_id,
        p_jugadores_ids: input.jugadores_ids,
        p_nombres_libres: input.nombres_libres,
        p_tarifa_id: input.tarifa_id,
        p_monto_total: input.monto_total,
        p_monto_pagado: input.monto_pagado,
        p_medio_pago: input.medio_pago,
        p_estado: input.estado,
        p_observaciones: input.observaciones,
      });
      if (error) throw new Error(mapPostgrestError(error));
      if (!data) {
        // Defensivo: si la RPC devuelve null por algún motivo (no debería).
        throw new Error('La reserva se creó pero no recibimos los datos. Refrescá la grilla.');
      }
      return data as Reserva;
    },
    onSuccess: (reserva) => {
      void queryClient.invalidateQueries({
        queryKey: [RESERVAS_QUERY_KEY_BASE, reserva.fecha],
      });
    },
  });
}
