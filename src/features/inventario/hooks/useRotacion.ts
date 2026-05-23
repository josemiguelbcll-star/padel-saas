import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { mapPostgrestError } from '@/lib/dbErrors';
import type { Linea, ProductoConStock } from '@/types/database';
import { INVENTARIO_PRODUCTOS_QUERY_KEY } from './useInventarioProductos';

export interface RotacionFila {
  producto_id: number;
  producto_nombre: string;
  linea: Linea;
  stock_actual: number;
  /** SUM(|cantidad|) en últimos N días con fuente venta/consumo_turno. */
  unidades_vendidas_ventana: number;
  /** unidades_vendidas_ventana / diasVentana. */
  venta_diaria_promedio: number;
  /**
   * stock_actual / venta_diaria_promedio (días).
   * `null` cuando venta_diaria_promedio === 0 (sin ventas en la ventana
   * — UI debería mostrar "Sin ventas en {N}d").
   */
  dias_de_stock: number | null;
  /** Fecha-hora de la última venta DENTRO de la ventana (null si no hay). */
  ultima_venta_en_ventana: string | null;
}

export interface RotacionResultado {
  diasVentana: number;
  filas: RotacionFila[];
  /** Total de productos activos con stock > 0. Para contexto en la UI. */
  totalActivosConStock: number;
  /**
   * Total de productos activos con stock > 0 que NO tuvieron ventas en
   * la ventana (slow movers brutos).
   */
  totalSinVentasConStock: number;
}

export const ROTACION_QUERY_KEY = (dias: number) =>
  ['inventario', 'rotacion', dias] as const;

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Estimación de rotación de inventario sobre los últimos N días
 * (default 30):
 *
 *   - "Venta diaria promedio" = unidades vendidas en ventana / N días.
 *   - "Días de stock" = stock_actual / venta diaria promedio (cuántos
 *     días duraría el stock actual al ritmo de venta de la ventana).
 *   - "Sin ventas" cuando no hubo movimientos de salida en la ventana.
 *
 * IMPORTANTE — bajo volumen distorsiona estos números: con poco
 * histórico, "días de stock" puede dar valores enormes o "Sin ventas"
 * incluso para productos que se mueven ocasionalmente. La UI debe
 * mostrar contexto y no presentar esto como verdad absoluta.
 *
 * Estrategia: lee 2 cosas en paralelo — `vw_productos_con_stock`
 * (catálogo + stock) y movimientos de salida (venta + consumo_turno) en
 * la ventana. Agrega client-side: ~200 productos × ~500 movimientos
 * /mes es barato. La query de productos REUSA la queryKey del catálogo
 * para que un ajuste invalide ambas. La query de movimientos tiene
 * queryKey propia.
 */
export function useRotacion(
  diasVentana: number = 30,
): UseQueryResult<RotacionResultado, Error> {
  return useQuery<RotacionResultado, Error>({
    // queryKey distinta del catálogo porque el resultado es derivado
    // (filas distintas, computadas). La invalidación del catálogo (al
    // ajustar stock) NO refresca esta query automáticamente — para que
    // refresque, hay que sumar este queryKey al invalidador del ajuste.
    queryKey: ROTACION_QUERY_KEY(diasVentana),
    queryFn: async () => {
      const hoy = new Date();
      const desde = new Date(hoy);
      desde.setDate(desde.getDate() - (diasVentana - 1));
      const desdeIni = `${fmtISO(desde)}T00:00:00`;
      const hastaFin = `${fmtISO(hoy)}T23:59:59`;

      const [productosRes, movRes] = await Promise.all([
        supabase
          .from('vw_productos_con_stock')
          .select('id, nombre, linea, activo, stock_actual'),
        // Solo movimientos de SALIDA por ventas (mostrador) o por consumos
        // de turno — ambos representan "se vendió". Ignoramos compras,
        // ajustes, reposiciones de consumo y bot WhatsApp (no son ventas).
        supabase
          .from('movimientos_stock')
          .select('producto_id, cantidad, fuente, fecha_hora')
          .in('fuente', ['venta', 'consumo_turno'])
          .gte('fecha_hora', desdeIni)
          .lte('fecha_hora', hastaFin),
      ]);

      if (productosRes.error)
        throw new Error(mapPostgrestError(productosRes.error));
      if (movRes.error) throw new Error(mapPostgrestError(movRes.error));

      const productos = (productosRes.data ?? []) as Array<
        Pick<ProductoConStock, 'id' | 'nombre' | 'linea' | 'activo' | 'stock_actual'>
      >;

      // Agregar movimientos por producto.
      type Agg = { unidades: number; ultima: string | null };
      const porProducto = new Map<number, Agg>();
      type Mov = {
        producto_id: number;
        cantidad: number;
        fecha_hora: string;
      };
      for (const m of (movRes.data ?? []) as Mov[]) {
        const abs = Math.abs(Number(m.cantidad) || 0);
        const prev = porProducto.get(m.producto_id);
        if (!prev) {
          porProducto.set(m.producto_id, {
            unidades: abs,
            ultima: m.fecha_hora,
          });
        } else {
          prev.unidades += abs;
          if (!prev.ultima || m.fecha_hora > prev.ultima) {
            prev.ultima = m.fecha_hora;
          }
        }
      }

      const filas: RotacionFila[] = [];
      let totalActivosConStock = 0;
      let totalSinVentasConStock = 0;

      for (const p of productos) {
        if (!p.activo) continue;
        const agg = porProducto.get(p.id);
        const unidades_vendidas_ventana = agg?.unidades ?? 0;
        const venta_diaria_promedio =
          unidades_vendidas_ventana / diasVentana;
        const dias_de_stock =
          venta_diaria_promedio > 0
            ? p.stock_actual / venta_diaria_promedio
            : null;
        const fila: RotacionFila = {
          producto_id: p.id,
          producto_nombre: p.nombre,
          linea: p.linea,
          stock_actual: p.stock_actual,
          unidades_vendidas_ventana,
          venta_diaria_promedio,
          dias_de_stock,
          ultima_venta_en_ventana: agg?.ultima ?? null,
        };
        filas.push(fila);
        if (p.stock_actual > 0) {
          totalActivosConStock++;
          if (unidades_vendidas_ventana === 0) {
            totalSinVentasConStock++;
          }
        }
      }

      return {
        diasVentana,
        filas,
        totalActivosConStock,
        totalSinVentasConStock,
      };
    },
  });
}

// Re-exportamos la query key del catálogo por conveniencia (si alguna
// pantalla necesita invalidar ambas).
export { INVENTARIO_PRODUCTOS_QUERY_KEY };
