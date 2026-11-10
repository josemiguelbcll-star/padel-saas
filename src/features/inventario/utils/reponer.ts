/**
 * Lógica PURA de "productos para reponer": a partir de las filas de rotación
 * (useRotacion), selecciona y clasifica los productos cuya cobertura de stock
 * cae por debajo de un umbral de días. Sin Supabase ni React → testeable en
 * Node.
 *
 * Vive en inventario (no en dashboard) porque es dominio de inventario: opera
 * sobre RotacionFila. La consumen tanto el tab "Reposición" de InventarioPage
 * como la alarma del dashboard (useProductosParaReponer) — misma fuente, mismos
 * números por construcción.
 */
import type { Linea } from '@/types/database';
import type { RotacionFila } from '../hooks/useRotacion';

/** Umbral de días de cobertura por debajo del cual un producto "hay que pedir". */
export const UMBRAL_DIAS_REPONER = 3;

export type SeveridadStock = 'rojo' | 'ambar' | 'normal';
export type FiltroReposicion = 'urgentes' | 'sin_stock' | 'todos';

export interface ProductoReponer {
  producto_id: number;
  producto_nombre: string;
  linea: Linea;
  stock_actual: number;
  dias_de_stock: number | null;
  /** Unidades vendidas en la ventana (contexto). */
  unidades_vendidas_ventana: number;
  /** 'rojo' = sin stock (urgente); 'ambar' = quedan < umbral días. */
  severidad: SeveridadStock;
}

/**
 * Productos cuya cobertura de stock cae por debajo de `umbral` días al ritmo
 * de venta de la ventana (típicamente useRotacion(14)).
 *
 *  - Sin ventas en la ventana (`dias_de_stock === null`) → NO dispara: sin
 *    ritmo no se puede proyectar agotamiento (evita el falso "infinito").
 *  - Stock 0 (con ventas) → `dias_de_stock` = 0 → severidad 'rojo' (urgente).
 *  - 0 < días < umbral → severidad 'ambar'.
 *
 * Orden: más urgente primero (menos días arriba).
 */
export function productosParaReponer(
  filas: ReadonlyArray<RotacionFila>,
  umbral: number = UMBRAL_DIAS_REPONER,
  filtro: FiltroReposicion = 'urgentes',
): ProductoReponer[] {
  return filas
    .filter((f) => {
      if (filtro === 'sin_stock') return f.stock_actual <= 0;
      if (filtro === 'todos') return true;
      return f.dias_de_stock !== null && f.dias_de_stock < umbral;
    })
    .map((f): ProductoReponer => ({
      producto_id: f.producto_id,
      producto_nombre: f.producto_nombre,
      linea: f.linea,
      stock_actual: f.stock_actual,
      dias_de_stock: f.dias_de_stock,
      unidades_vendidas_ventana: f.unidades_vendidas_ventana,
      severidad:
        f.stock_actual <= 0
          ? 'rojo'
          : f.dias_de_stock !== null && f.dias_de_stock < umbral
            ? 'ambar'
            : 'normal',
    }))
    .sort((a, b) => {
      const aSinStock = a.stock_actual <= 0;
      const bSinStock = b.stock_actual <= 0;
      if (aSinStock !== bSinStock) return aSinStock ? -1 : 1;
      if (a.dias_de_stock === null) {
        return b.dias_de_stock === null
          ? a.producto_nombre.localeCompare(b.producto_nombre)
          : 1;
      }
      if (b.dias_de_stock === null) return -1;
      return a.dias_de_stock - b.dias_de_stock;
    });
}
