import type { MedioPago } from '@/types/database';

/**
 * Estado de pago de un gasto, derivado de SUS CUOTAS (no del gasto madre).
 *
 * El gasto madre tiene fecha_pago/medio_pago NULL cuando su pago vive en
 * cuotas (compras a plazo, gastos pendientes con cuota automática) → la verdad
 * está en gasto_cuotas. PURO/testeable. Compartido por el listado de compras
 * (useCompras) y el historial de gastos (useGastos) para no duplicar la lógica.
 */

export type EstadoPago = 'pagada' | 'parcial' | 'pendiente';
/** Medio a mostrar: el medio real, 'varios' si las cuotas pagadas difieren. */
export type MedioPagoMostrado = MedioPago | 'varios';

export interface ResultadoEstadoPago {
  estado: EstadoPago;
  /** Único medio de las cuotas pagadas; 'varios' si difieren; null si no hay pago. */
  medio: MedioPagoMostrado | null;
  /** Cuotas pagadas / total (para "Parcial · 1/3"). 0/0 si el gasto no tiene cuotas. */
  pagadas: number;
  total: number;
}

export interface CuotaPago {
  fecha_pago: string | null;
  medio_pago: MedioPago | null;
}

/**
 * Reglas:
 *  - Sin cuotas (pago directo / legacy): estado del gasto madre (fecha_pago).
 *  - Con cuotas: todas pagadas → 'pagada'; algunas → 'parcial'; ninguna →
 *    'pendiente'. Medio = único medio de las cuotas pagadas, o 'varios'.
 */
export function estadoPagoGasto(
  cuotas: CuotaPago[],
  gastoFechaPago: string | null,
  gastoMedio: MedioPago | null,
): ResultadoEstadoPago {
  // Sin cuotas → el gasto se pagó (o no) directo.
  if (cuotas.length === 0) {
    return gastoFechaPago !== null
      ? { estado: 'pagada', medio: gastoMedio, pagadas: 0, total: 0 }
      : { estado: 'pendiente', medio: null, pagadas: 0, total: 0 };
  }

  const total = cuotas.length;
  const pagadas = cuotas.filter((c) => c.fecha_pago !== null).length;

  const estado: EstadoPago =
    pagadas === 0 ? 'pendiente' : pagadas === total ? 'pagada' : 'parcial';

  // Medio de las cuotas pagadas (una cuota pagada SIEMPRE tiene medio, por el
  // CHECK cuota_pago_atomico): único → ese; varios distintos → 'varios'.
  let medio: MedioPagoMostrado | null = null;
  if (pagadas > 0) {
    const medios = [
      ...new Set(
        cuotas
          .filter((c) => c.fecha_pago !== null && c.medio_pago !== null)
          .map((c) => c.medio_pago as MedioPago),
      ),
    ];
    medio = medios.length === 1 ? (medios[0] as MedioPago) : medios.length > 1 ? 'varios' : null;
  }

  return { estado, medio, pagadas, total };
}
