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

export interface FiltrosIngresosPorMedio {
  anio: number;
  mes: number;
  desde?: string | null;
  hasta?: string | null;
  medioPago?: string | null;
}

export const INGRESOS_POR_MEDIO_QUERY_KEY = (
  anio: number,
  mes: number,
  desde?: string | null,
  hasta?: string | null,
  medioPago?: string | null,
) => ['ingresos_por_medio', anio, mes, desde, hasta, medioPago] as const;

/**
 * Agrupa los ingresos del período POR MEDIO DE PAGO. Cuatro fuentes:
 *   - reserva_pagos (criterio caja: fecha_hora). Reembolsos restan.
 *   - clase_cobros  (fecha_hora).
 *   - ventas        (fecha_hora).
 *   - otros_ingresos (fecha devengado, filtrando con medio_pago seteado).
 */
export function useIngresosPorMedio(
  anioOrFiltros: number | FiltrosIngresosPorMedio,
  mesArg?: number,
): UseQueryResult<IngresosPorMedioMes, Error> {
  const isObj = typeof anioOrFiltros === 'object' && anioOrFiltros !== null;
  const anio = isObj ? anioOrFiltros.anio : anioOrFiltros;
  const mes = isObj ? anioOrFiltros.mes : (mesArg ?? 1);
  const desdeFiltro = isObj ? anioOrFiltros.desde : undefined;
  const hastaFiltro = isObj ? anioOrFiltros.hasta : undefined;
  const medioFiltro = isObj ? anioOrFiltros.medioPago : undefined;

  return useQuery<IngresosPorMedioMes, Error>({
    queryKey: INGRESOS_POR_MEDIO_QUERY_KEY(anio, mes, desdeFiltro, hastaFiltro, medioFiltro),
    queryFn: async () => {
      let desdeISO: string;
      let hastaISO: string;
      let desdeDate: string;
      let hastaDate: string;

      if (desdeFiltro && hastaFiltro) {
        desdeDate = desdeFiltro;
        hastaDate = hastaFiltro;
        desdeISO = `${desdeFiltro}T00:00:00`;
        hastaISO = `${hastaFiltro}T23:59:59`;
      } else {
        const { desde, hasta } = rangoMesISO(anio, mes);
        desdeDate = desde;
        hastaDate = hasta;
        desdeISO = `${desde}T00:00:00`;
        hastaISO = `${hasta}T23:59:59`;
      }

      const [pagosRes, clasesRes, otrosIngRes] = await Promise.all([
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
          .from('otros_ingresos')
          .select('monto, medio_pago')
          .eq('activo', true)
          .not('medio_pago', 'is', null)
          .gte('fecha', desdeDate)
          .lte('fecha', hastaDate),
      ]);

      for (const r of [pagosRes, clasesRes, otrosIngRes]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      const [vpRes, vprRes] = await Promise.all([
        supabase
          .from('venta_pagos')
          .select('monto, medio_pago')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
        supabase
          .from('venta_pagos_reversiones')
          .select('monto, medio_pago')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
      ]);
      if (vprRes.error) throw new Error(mapPostgrestError(vprRes.error));

      let ventasItems: Array<{ medio_pago: string; monto: number }> = [];
      if (!vpRes.error && vpRes.data) {
        ventasItems = vpRes.data.map((vp) => ({
          medio_pago: vp.medio_pago,
          monto: Number(vp.monto),
        }));
      } else {
        const vRes = await supabase
          .from('ventas')
          .select('monto_total, medio_pago')
          .eq('activa', true)
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO);
        ventasItems = (vRes.data ?? []).map((v) => ({
          medio_pago: v.medio_pago,
          monto: Number(v.monto_total),
        }));
      }

      const matchMedio = (m: string | null): boolean => {
        if (!m) return false;
        if (!medioFiltro || medioFiltro === 'todos') return true;
        if (m === medioFiltro) return true;
        if (medioFiltro === 'mp' && ['mp', 'mercado_pago'].includes(m)) return true;
        if (medioFiltro === 'tarjeta' && ['tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'].includes(m)) return true;
        return false;
      };

      const acumulado = new Map<MedioPagoIngreso, { monto: number; count: number }>();
      const sumar = (medio: string | null, monto: number, contar = true) => {
        if (medio === null) return;
        if (!matchMedio(medio)) return;

        let m: MedioPagoIngreso = 'otro';
        if (medio === 'efectivo') m = 'efectivo';
        else if (medio === 'transferencia') m = 'transferencia';
        else if (['mp', 'mercado_pago'].includes(medio)) m = 'mp';
        else if (['tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'].includes(medio)) m = 'tarjeta';
        else m = 'otro';

        const prev = acumulado.get(m) ?? { monto: 0, count: 0 };
        acumulado.set(m, {
          monto: prev.monto + monto,
          count: prev.count + (contar ? 1 : 0),
        });
      };

      for (const p of pagosRes.data ?? []) {
        const monto =
          (String(p.tipo) === 'reembolso' ? -1 : 1) * Number(p.monto);
        sumar(String(p.medio_pago), monto);
      }
      for (const c of clasesRes.data ?? []) {
        sumar(String(c.medio_pago), Number(c.monto));
      }
      for (const v of ventasItems) {
        sumar(v.medio_pago, v.monto);
      }
      for (const v of vprRes.data ?? []) {
        sumar(String(v.medio_pago), -Number(v.monto));
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
