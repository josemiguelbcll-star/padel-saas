import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Linea } from '@/types/database';

export interface TopVendido {
  producto_id: number;
  producto_nombre: string;
  linea: Linea;
  /** SUM(cantidad) en el mes. */
  unidades: number;
  /** SUM(subtotal) en el mes. */
  ingreso: number;
  /** Subset de ingreso atribuible a items con costo cargado al momento. */
  ingreso_con_costo: number;
  /** Subset de unidades con costo cargado. */
  unidades_con_costo: number;
  /** Subset de unidades sin costo (margen no calculable para esa parte). */
  unidades_sin_costo: number;
  /**
   * Margen $ de la parte CON costo (ingreso_con_costo − costo_total).
   * `null` cuando 0 items del producto tuvieron costo (todo n/c).
   */
  margen: number | null;
  /**
   * Margen % sobre `ingreso_con_costo` (no sobre ingreso total — sería
   * mezclar peras con manzanas si parte vino sin costo). `null` cuando
   * todo es n/c o ingreso_con_costo === 0.
   */
  margen_pct: number | null;
  /** True si al menos UN item del producto no tuvo costo cargado. */
  parcial: boolean;
}

export const TOP_VENDIDOS_QUERY_KEY = (anio: number, mes: number) =>
  ['inventario', 'top_vendidos', anio, mes] as const;

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Top productos vendidos en un mes calendario, agregado por producto.
 *
 * Estrategia: query a `venta_items` con INNER JOIN a `ventas` filtrado
 * por `ventas.fecha_hora` dentro del mes. La agregación se hace
 * client-side (volumen típico: pocos cientos de items por mes — barato).
 *
 * Honestidad sobre costo NULL: el margen $ y % se calculan SOLO sobre
 * la porción de unidades que tuvo costo cargado. Si todo es n/c, ambos
 * son null. La UI debe mostrarlo explícitamente.
 *
 * Default: mes actual. Pasar año/mes 1-based.
 */
export function useTopVendidos(
  anio: number,
  mes: number,
): UseQueryResult<TopVendido[], Error> {
  return useQuery<TopVendido[], Error>({
    queryKey: TOP_VENDIDOS_QUERY_KEY(anio, mes),
    queryFn: async () => {
      const inicio = new Date(anio, mes - 1, 1);
      const fin = new Date(anio, mes, 0); // último día del mes
      const desdeIni = `${fmtISO(inicio)}T00:00:00`;
      const hastaFin = `${fmtISO(fin)}T23:59:59`;

      const { data, error } = await supabase
        .from('venta_items')
        .select(
          `
          producto_id, producto_nombre, cantidad, costo_unitario,
          subtotal, linea,
          ventas!inner (fecha_hora)
          `,
        )
        .gte('ventas.fecha_hora', desdeIni)
        .lte('ventas.fecha_hora', hastaFin);

      if (error) throw new Error(mapPostgrestError(error));

      type Row = {
        producto_id: number;
        producto_nombre: string;
        cantidad: number;
        costo_unitario: number | null;
        subtotal: number;
        linea: Linea;
        ventas: { fecha_hora: string } | null;
      };

      const acc = new Map<number, TopVendido>();
      for (const r of (data ?? []) as unknown as Row[]) {
        const cant = Number(r.cantidad) || 0;
        const subtot = Number(r.subtotal) || 0;
        const costo = r.costo_unitario === null ? null : Number(r.costo_unitario);

        let prev = acc.get(r.producto_id);
        if (!prev) {
          prev = {
            producto_id: r.producto_id,
            producto_nombre: r.producto_nombre,
            linea: r.linea,
            unidades: 0,
            ingreso: 0,
            ingreso_con_costo: 0,
            unidades_con_costo: 0,
            unidades_sin_costo: 0,
            margen: null,
            margen_pct: null,
            parcial: false,
          };
          acc.set(r.producto_id, prev);
        }

        prev.unidades += cant;
        prev.ingreso += subtot;
        if (costo === null) {
          prev.unidades_sin_costo += cant;
        } else {
          prev.unidades_con_costo += cant;
          prev.ingreso_con_costo += subtot;
          // El margen se acumula en `margen` como "ganancia bruta de la
          // parte con costo": ingreso_con_costo − costo_total.
          const aporte = subtot - cant * costo;
          prev.margen = (prev.margen ?? 0) + aporte;
        }
      }

      const top: TopVendido[] = [];
      for (const t of acc.values()) {
        t.parcial = t.unidades_sin_costo > 0 && t.unidades_con_costo > 0;
        if (t.unidades_con_costo === 0) {
          // Todo n/c — no podemos calcular margen.
          t.margen = null;
          t.margen_pct = null;
        } else if (t.ingreso_con_costo > 0 && t.margen !== null) {
          t.margen_pct = (t.margen / t.ingreso_con_costo) * 100;
        }
        top.push(t);
      }

      top.sort((a, b) => b.ingreso - a.ingreso);
      return top.slice(0, 10);
    },
  });
}
