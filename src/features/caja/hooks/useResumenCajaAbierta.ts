import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';

export interface ResumenCaja {
  apertura: number;
  cobros_reservas: number;   // efectivo de reserva_pagos (reembolsos restan)
  cobros_ventas: number;     // efectivo de ventas (buffet)
  cobros_clases: number;     // efectivo de clase_cobros
  entradas_cobros: number;   // suma de las 3 anteriores
  ajustes_positivos: number; // movimientos manuales tipo ajuste_positivo
  salidas: number;           // retiros + pago_proveedor + ajuste_negativo
  esperado: number;          // apertura + entradas + ajustes − salidas
  count_cobros_efectivo: number;
  count_salidas: number;
}

export const CAJA_RESUMEN_QUERY_KEY = (turnoCajaId: number) =>
  ['caja', 'resumen', turnoCajaId] as const;

/**
 * Calcula el resumen en vivo de la caja abierta (apertura + cobros en
 * efectivo + ajustes manuales − salidas = esperado).
 *
 * Hace 4 queries paralelas + 1 de la caja:
 *   1. apertura: turnos_caja.monto_apertura
 *   2. cobros de reserva_pagos en efectivo de esta caja (tipo='reembolso'
 *      resta — regla de oro de fn_cerrar_caja)
 *   3. ventas en efectivo de esta caja
 *   4. clase_cobros en efectivo de esta caja
 *   5. movimientos manuales de esta caja
 *
 * Mismo cálculo que `fn_cerrar_caja` server-side, replicado en JS para
 * mostrar el esperado en vivo SIN cerrar la caja. La RPC sigue siendo
 * la fuente de verdad al momento del cierre (lock + recalculo atómico).
 *
 * Filtros server-side por `turno_caja_id` + `medio_pago='efectivo'`
 * (doble defensa: en teoría turno_caja_id solo se setea para efectivo
 * desde la 0023, pero filtrar por medio_pago hace el invariante
 * explícito y resiste bugs futuros).
 */
export function useResumenCajaAbierta(
  turnoCajaId: number | null,
): UseQueryResult<ResumenCaja | null, Error> {
  return useQuery<ResumenCaja | null, Error>({
    queryKey: turnoCajaId
      ? CAJA_RESUMEN_QUERY_KEY(turnoCajaId)
      : ['caja', 'resumen', 'null'],
    enabled: turnoCajaId !== null,
    queryFn: async () => {
      if (!turnoCajaId) return null;

      const [cajaRes, pagosRes, ventasRes, clasesRes, movRes] = await Promise.all([
        supabase
          .from('turnos_caja')
          .select('monto_apertura')
          .eq('id', turnoCajaId)
          .single(),
        supabase
          .from('reserva_pagos')
          .select('monto, tipo')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('ventas')
          .select('monto_total')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('clase_cobros')
          .select('monto')
          .eq('turno_caja_id', turnoCajaId)
          .eq('medio_pago', 'efectivo'),
        supabase
          .from('caja_movimientos_manuales')
          .select('tipo, monto')
          .eq('turno_caja_id', turnoCajaId),
      ]);

      const results = [cajaRes, pagosRes, ventasRes, clasesRes, movRes];
      for (const r of results) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      const apertura = Number(
        (cajaRes.data as { monto_apertura: number }).monto_apertura,
      );

      const pagos =
        (pagosRes.data ?? []) as Array<{ monto: number; tipo: string }>;
      // tipo='reembolso' resta (devolvimos efectivo).
      const cobros_reservas = pagos.reduce(
        (acc, p) =>
          acc + (p.tipo === 'reembolso' ? -Number(p.monto) : Number(p.monto)),
        0,
      );

      const ventas =
        (ventasRes.data ?? []) as Array<{ monto_total: number }>;
      const cobros_ventas = ventas.reduce(
        (acc, v) => acc + Number(v.monto_total),
        0,
      );

      const clases = (clasesRes.data ?? []) as Array<{ monto: number }>;
      const cobros_clases = clases.reduce(
        (acc, c) => acc + Number(c.monto),
        0,
      );

      const entradas_cobros = cobros_reservas + cobros_ventas + cobros_clases;

      const movs =
        (movRes.data ?? []) as Array<{ tipo: string; monto: number }>;
      let ajustes_positivos = 0;
      let salidas = 0;
      for (const m of movs) {
        const monto = Number(m.monto);
        if (m.tipo === 'ajuste_positivo') {
          ajustes_positivos += monto;
        } else {
          salidas += monto;
        }
      }

      const esperado =
        apertura + entradas_cobros + ajustes_positivos - salidas;

      return {
        apertura,
        cobros_reservas,
        cobros_ventas,
        cobros_clases,
        entradas_cobros,
        ajustes_positivos,
        salidas,
        esperado,
        count_cobros_efectivo: pagos.length + ventas.length + clases.length,
        count_salidas: movs.length,
      };
    },
  });
}
