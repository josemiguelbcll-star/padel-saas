import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { rangoMesISO } from '../utils/ocurrenciasDelMes';

/**
 * Valores posibles de `medio_pago` (mismo enum en reserva_pagos,
 * clase_cobros, ventas y otros_ingresos, definido en 0004 y 0009).
 */
export type MedioPagoIngreso =
  | 'efectivo'
  | 'transferencia'
  | 'mp'
  | 'tarjeta'
  | 'otro';

export interface IngresoPorMedio {
  medio: MedioPagoIngreso;
  monto: number;
  /** Cantidad de movimientos individuales que aportan a este medio. */
  count: number;
}

export interface IngresosPorMedioMes {
  anio: number;
  mes: number;
  /** Array ordenado DESC por monto. Medios sin actividad no aparecen. */
  items: IngresoPorMedio[];
  /** Suma de monto de todos los medios (ingresos del mes por caja). */
  total: number;
}

export const INGRESOS_POR_MEDIO_QUERY_KEY = (anio: number, mes: number) =>
  ['ingresos_por_medio', anio, mes] as const;

/**
 * Agrupa los ingresos del mes POR MEDIO DE PAGO. Cuatro fuentes:
 *   - reserva_pagos (criterio caja: fecha_hora). Reembolsos restan.
 *   - clase_cobros  (fecha_hora).
 *   - ventas        (fecha_hora).
 *   - otros_ingresos (fecha devengado, filtrando con medio_pago seteado).
 *
 * Pensado para alimentar un donut/pie chart en /finanzas que muestre
 * cómo se cobró el dinero del mes (efectivo vs transferencia vs MP,
 * etc.).
 */
export function useIngresosPorMedio(
  anio: number,
  mes: number,
): UseQueryResult<IngresosPorMedioMes, Error> {
  return useQuery<IngresosPorMedioMes, Error>({
    queryKey: INGRESOS_POR_MEDIO_QUERY_KEY(anio, mes),
    queryFn: async () => {
      const { desde, hasta } = rangoMesISO(anio, mes);
      const desdeISO = `${desde}T00:00:00`;
      const hastaISO = `${hasta}T23:59:59`;

      const [pagosRes, clasesRes, ventasRes, otrosIngRes] = await Promise.all([
        supabase
          .from('reserva_pagos')
          .select('monto, medio_pago, tipo')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
        supabase
          .from('clase_cobros')
          .select('monto, medio_pago')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
        supabase
          .from('ventas')
          .select('monto_total, medio_pago')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
        supabase
          .from('otros_ingresos')
          .select('monto, medio_pago')
          .eq('activo', true)
          .not('medio_pago', 'is', null)
          .gte('fecha', desde)
          .lte('fecha', hasta),
      ]);

      for (const r of [pagosRes, clasesRes, ventasRes, otrosIngRes]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      const acumulado = new Map<MedioPagoIngreso, { monto: number; count: number }>();
      const sumar = (medio: string | null, monto: number, contar = true) => {
        if (medio === null) return;
        const m = (
          ['efectivo', 'transferencia', 'mp', 'tarjeta', 'otro'].includes(medio)
            ? (medio as MedioPagoIngreso)
            : 'otro'
        );
        const prev = acumulado.get(m) ?? { monto: 0, count: 0 };
        acumulado.set(m, {
          monto: prev.monto + monto,
          count: prev.count + (contar ? 1 : 0),
        });
      };

      // reserva_pagos: reembolsos restan en monto, pero igual cuentan como
      // movimiento (para que count refleje todo el flujo del medio).
      for (const p of pagosRes.data ?? []) {
        const monto =
          (String(p.tipo) === 'reembolso' ? -1 : 1) * Number(p.monto);
        sumar(String(p.medio_pago), monto);
      }
      for (const c of clasesRes.data ?? []) {
        sumar(String(c.medio_pago), Number(c.monto));
      }
      for (const v of ventasRes.data ?? []) {
        sumar(String(v.medio_pago), Number(v.monto_total));
      }
      for (const i of otrosIngRes.data ?? []) {
        sumar(String(i.medio_pago), Number(i.monto));
      }

      const items: IngresoPorMedio[] = Array.from(acumulado.entries())
        .map(([medio, v]) => ({ medio, monto: v.monto, count: v.count }))
        .filter((i) => i.monto !== 0 || i.count > 0)
        .sort((a, b) => b.monto - a.monto);

      const total = items.reduce((acc, i) => acc + i.monto, 0);

      return { anio, mes, items, total };
    },
  });
}
