import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Linea, TipoUnidad } from '@/types/database';

/**
 * Resumen financiero del período (criterio devengado pragmático:
 * usamos fecha del registro principal en cada tabla, no estricto
 * por unidad temporal — buena base para un EERR operativo,
 * mejorable en iteración futura cuando armemos el EERR formal).
 *
 * El cálculo se hace client-side desde 5 queries paralelas. Para
 * volumen alto (>10k registros/mes), reemplazar por RPC con
 * agregaciones SQL. Hoy alcanza con esto.
 */
export interface IngresoUnidad {
  unidad: string;
  tipo: TipoUnidad;
  monto: number;
}

export interface GastoCategoria {
  categoria_nombre: string;
  unidad_nombre: string;
  unidad_tipo: TipoUnidad;
  monto: number;
}

export interface MovimientoReciente {
  id: string;
  tipo: 'gasto' | 'otro_ingreso' | 'cobro_reserva' | 'venta' | 'cobro_clase';
  fecha: string;
  descripcion: string;
  detalle: string | null;
  monto: number;
  signo: '+' | '-';
}

export interface ResumenFinanciero {
  /** Mes del período (1-12). */
  mes: number;
  anio: number;
  /** Total de ingresos (operativos + otros), antes de costos/gastos. */
  ingresos_total: number;
  ingresos_por_unidad: IngresoUnidad[];
  /** Costo directo de venta (buffet + shop), basado en costo_unitario snapshot. */
  costos_directos: number;
  costos_por_linea: { linea: Linea; monto: number }[];
  /**
   * Gastos directos a unidades operativas (canchas/clases/buffet/shop).
   * En el EERR corporativo se muestran como "Gastos directos". Mantiene
   * el nombre histórico `gastos_operativos` por retrocompat (dashboard).
   *
   * EXCLUYE las categorías con `es_mercaderia=TRUE`: el costo de
   * mercadería ya entra al EERR vía `costos_directos` (CMV = SUM de
   * venta_items.costo_unitario × cantidad). Si también se incluyera
   * acá, habría doble conteo (se restaría al comprar y al vender). El
   * dinero de la compra es flujo de caja / movimiento de inventario,
   * no resultado del EERR hasta que la mercadería se venda.
   */
  gastos_operativos: number;
  /** Gastos de estructura (unidad tipo='estructura'). */
  gastos_estructura: number;
  /**
   * Resultados financieros — gastos con unidad_tipo='financiero'
   * (comisiones bancarias, comisiones MP/tarjetas, intereses, etc.).
   * Capa propia del EERR corporativo (0036). Separado de gastos_otros.
   */
  gastos_financieros: number;
  /** Otros gastos (auspicios/membresias/otro — sin financieros). */
  gastos_otros: number;
  /** Total gastos = operativos + estructura + financieros + otros. */
  gastos_total: number;
  /** Resultado = ingresos − costos − gastos. */
  resultado_neto: number;
  /**
   * Margen bruto = ingresos_total − costos_directos − gastos_operativos.
   * Capa intermedia del EERR (después de gastos directos a unidades).
   */
  margen_bruto: number;
  /**
   * Resultado operativo (≈ EBITDA) = margen_bruto − gastos_estructura.
   * Capa intermedia del EERR (antes de resultados financieros).
   */
  resultado_operativo: number;
  /** % margen sobre ingresos. NaN si ingresos = 0. */
  margen_porcentaje: number;
  /**
   * Top categorías de gasto del período (ordenadas DESC). EXCLUYE las
   * categorías con `es_mercaderia=TRUE` (ver `gastos_operativos`): el
   * top responde "¿en qué se va la plata del EERR?" — mercadería no
   * es gasto del EERR (su impacto va por CMV al vender).
   */
  top_gastos_categoria: GastoCategoria[];
  /** Movimientos recientes mixtos (últimos 15). */
  movimientos_recientes: MovimientoReciente[];
  /**
   * Total de compras de mercadería del período (suma de gastos cuya
   * categoría tiene `es_mercaderia=TRUE`). NO entra en ninguna capa
   * del EERR — es flujo de caja / movimiento de inventario. El costo
   * de mercadería se computa en el EERR al VENDER, vía
   * `costos_directos` (CMV de venta_items.costo_unitario). Este campo
   * queda disponible para banners informativos en /finanzas y para
   * reportes futuros de flujo de caja.
   */
  compras_mercaderia_periodo: number;
}

export const RESUMEN_FINANCIERO_QUERY_KEY = (anio: number, mes: number) =>
  ['resumen_financiero', anio, mes] as const;

export function useResumenFinanciero(
  anio: number,
  mes: number,
): UseQueryResult<ResumenFinanciero, Error> {
  return useQuery<ResumenFinanciero, Error>({
    queryKey: RESUMEN_FINANCIERO_QUERY_KEY(anio, mes),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fn_obtener_resumen_financiero', {
        p_anio: anio,
        p_mes: mes,
      });
      if (error) throw new Error(mapPostgrestError(error));
      return data as ResumenFinanciero;
    },
  });
}
