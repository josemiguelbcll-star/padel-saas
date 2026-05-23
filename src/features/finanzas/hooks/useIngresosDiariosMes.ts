import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import { rangoMesISO } from '../utils/ocurrenciasDelMes';

export interface PuntoIngresoDiario {
  /** YYYY-MM-DD */
  fecha: string;
  /** Día del mes 1..31 (para el eje X cuando se compara entre meses). */
  dia: number;
  /** Total ingresos de ese día (cobros reserva + clases + ventas + otros). */
  monto: number;
  /** Acumulado del mes hasta ese día. */
  acumulado: number;
}

export interface IngresosDiariosMes {
  anio: number;
  mes: number;
  /** Array completo del mes (1..N días). Días sin movimiento tienen monto=0. */
  serie: PuntoIngresoDiario[];
}

export const INGRESOS_DIARIOS_MES_QUERY_KEY = (anio: number, mes: number) =>
  ['ingresos_diarios_mes', anio, mes] as const;

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function extraerFechaISO(fechaHora: string): string {
  // Acepta YYYY-MM-DD o YYYY-MM-DDTHH:MM:SS. Devuelve los primeros 10.
  return fechaHora.slice(0, 10);
}

/**
 * Serie diaria de ingresos del mes (criterio caja: lo que entró el día).
 * Suma: cobros de reservas (descontando reembolsos) + cobros de clases +
 * ventas + otros ingresos. Pensado para alimentar un gráfico de línea
 * con acumulado.
 *
 * Días sin movimiento tienen monto=0, para que el gráfico no tenga
 * "agujeros" y el acumulado avance monotónico.
 */
export function useIngresosDiariosMes(
  anio: number,
  mes: number,
): UseQueryResult<IngresosDiariosMes, Error> {
  return useQuery<IngresosDiariosMes, Error>({
    queryKey: INGRESOS_DIARIOS_MES_QUERY_KEY(anio, mes),
    queryFn: async () => {
      const { desde, hasta } = rangoMesISO(anio, mes);
      const desdeISO = `${desde}T00:00:00`;
      const hastaISO = `${hasta}T23:59:59`;

      const [pagosRes, clasesRes, ventasRes, otrosIngRes] = await Promise.all([
        supabase
          .from('reserva_pagos')
          .select('monto, tipo, fecha_hora')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
        supabase
          .from('clase_cobros')
          .select('monto, fecha_hora')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
        supabase
          .from('ventas')
          .select('monto_total, fecha_hora')
          .gte('fecha_hora', desdeISO)
          .lte('fecha_hora', hastaISO),
        supabase
          .from('otros_ingresos')
          .select('monto, fecha')
          .eq('activo', true)
          .gte('fecha', desde)
          .lte('fecha', hasta),
      ]);

      for (const r of [pagosRes, clasesRes, ventasRes, otrosIngRes]) {
        if (r.error) throw new Error(mapPostgrestError(r.error));
      }

      // Acumular por fecha (YYYY-MM-DD).
      const porDia = new Map<string, number>();
      const sumar = (fecha: string, monto: number) => {
        porDia.set(fecha, (porDia.get(fecha) ?? 0) + monto);
      };

      for (const p of pagosRes.data ?? []) {
        const fecha = extraerFechaISO(String(p.fecha_hora));
        const monto =
          (String(p.tipo) === 'reembolso' ? -1 : 1) * Number(p.monto);
        sumar(fecha, monto);
      }
      for (const c of clasesRes.data ?? []) {
        sumar(extraerFechaISO(String(c.fecha_hora)), Number(c.monto));
      }
      for (const v of ventasRes.data ?? []) {
        sumar(extraerFechaISO(String(v.fecha_hora)), Number(v.monto_total));
      }
      for (const i of otrosIngRes.data ?? []) {
        sumar(String(i.fecha), Number(i.monto));
      }

      // Construir serie 1..últimoDía con monto + acumulado.
      const ultimoDia = new Date(anio, mes, 0).getDate();
      const serie: PuntoIngresoDiario[] = [];
      let acumulado = 0;
      for (let d = 1; d <= ultimoDia; d += 1) {
        const fecha = fmtISO(new Date(anio, mes - 1, d));
        const monto = porDia.get(fecha) ?? 0;
        acumulado += monto;
        serie.push({ fecha, dia: d, monto, acumulado });
      }

      return { anio, mes, serie };
    },
  });
}
