import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';

/**
 * Una transferencia (cobro con medio_pago='transferencia') del período,
 * normalizada desde las tres fuentes de plata entrante (turnos, ventas de
 * mostrador, cobros de clase). La devuelve la RPC `fn_transferencias_dia`
 * (migración 0066).
 */
export interface TransferenciaDia {
  /** Key única y estable: 'turno:123' | 'venta:45' | 'clase:9'. */
  id: string;
  /** Instante del cobro (TIMESTAMPTZ ISO). */
  fecha_hora: string;
  /** Fuente del cobro. */
  origen: 'turno' | 'venta' | 'clase';
  /**
   * Nombre del pagador. Turnos: jugador (ficha), nombre_libre, o 'Invitado'.
   * Ventas: 'Venta mostrador'. Clases: 'Cobro de clase'.
   */
  nombre: string;
  /**
   * "¿Quién transfirió?" = reserva_pagos.observaciones (Parte 2). NULL en
   * ventas (no tiene la columna) y en clases (decisión de producto).
   */
  quien_transfirio: string | null;
  monto: number;
  cuenta_id: number | null;
}

/** Shape crudo que devuelve la RPC (numeric llega como string en PostgREST). */
interface RawRow {
  id: string;
  fecha_hora: string;
  origen: 'turno' | 'venta' | 'clase';
  nombre: string;
  quien_transfirio: string | null;
  monto: string | number;
  cuenta_id: number | null;
}

export const TRANSFERENCIAS_QUERY_KEY = (desde: string, hasta: string) =>
  ['transferencias', desde, hasta] as const;

/**
 * Trae todas las transferencias de un rango de fechas (día local AR), uniendo
 * reserva_pagos + ventas + clase_cobros vía la RPC `fn_transferencias_dia`.
 *
 * - Parámetros `desde`/`hasta` en formato ISO 'YYYY-MM-DD'.
 * - El filtro de fecha por día local AR vive en la RPC (AT TIME ZONE).
 * - La búsqueda por nombre NO va acá: se aplica client-side sobre los datos
 *   cargados (Parte 6), para no re-fetchear al tipear.
 * - RLS por club resuelta en la RPC (SECURITY INVOKER).
 */
export function useTransferenciasDia(params: {
  desde: string;
  hasta: string;
}): UseQueryResult<TransferenciaDia[], Error> {
  const { desde, hasta } = params;
  return useQuery<TransferenciaDia[], Error>({
    queryKey: TRANSFERENCIAS_QUERY_KEY(desde, hasta),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_transferencias_dia', {
        p_desde: desde,
        p_hasta: hasta,
      });
      if (error) throw new Error(mapPostgrestError(error));
      return ((data ?? []) as RawRow[]).map((r) => ({
        id: r.id,
        fecha_hora: r.fecha_hora,
        origen: r.origen,
        nombre: r.nombre,
        quien_transfirio: r.quien_transfirio,
        monto: Number(r.monto),
        cuenta_id: r.cuenta_id == null ? null : Number(r.cuenta_id),
      }));
    },
  });
}
