import { useMemo } from 'react';
import { useRotacion } from '@/features/inventario/hooks/useRotacion';
import {
  productosParaReponer,
  type ProductoReponer,
} from '@/features/inventario/utils/reponer';

export interface ProductosParaReponer {
  /** null mientras carga. Array vacío = nada para reponer. */
  productos: ProductoReponer[] | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Alarma de reposición: productos con < 3 días de stock al ritmo de venta de
 * los últimos 14 días. Ventana corta (14d) = sensible a la demanda reciente.
 * Reusa useRotacion(14) (que ya computa dias_de_stock) + la función pura
 * productosParaReponer.
 */
export function useProductosParaReponer(): ProductosParaReponer {
  const q = useRotacion(14);
  const productos = useMemo(
    () => (q.data ? productosParaReponer(q.data.filas) : null),
    [q.data],
  );
  return { productos, isLoading: q.isLoading, error: q.error };
}
