import { clavePeriodo, type Granularidad } from './clavePeriodo';
import type { FlujoCajaPeriodo } from '../hooks/useFlujoCaja';
import type { FlujoProyectado } from '../hooks/useFlujoProyectado';

/**
 * Combina el flujo REAL (fn_flujo_caja, percibido) con el PROYECTADO
 * (useFlujoProyectado, compromisos futuros) en una sola serie por período,
 * ENCADENANDO el saldo. Función PURA (sin hooks, sin I/O) → testeable en Node.
 *
 * REGLA DE ORO DEL ENCADENAMIENTO:
 *   La curva proyectada arranca en el SALDO REAL DE HOY, nunca en cero. El
 *   ancla = saldo_cierre real del período actual (= saldo hoy). El período
 *   en curso suma su remanente proyectado (proyectadoRestante.saldoCierreProy
 *   = saldo hoy + neto proyectado que falta este período), y desde ahí cada
 *   período futuro encadena: apertura = cierre del anterior, cierre = apertura
 *   + neto proyectado.
 *
 * Clasificación por período (vs. el período que contiene "hoy"):
 *   - p < actual  → 'real'        (datos de fn_flujo_caja; sólido).
 *   - p = actual  → 'actual'      (real-a-hoy + proyectadoRestante; "en curso").
 *   - p > actual  → 'proyectado'  (saldo encadenado; punteado/translúcido).
 */

export type TipoFila = 'real' | 'actual' | 'proyectado';

export interface FilaFlujo {
  /** Inicio del período (YYYY-MM-DD). */
  periodo: string;
  tipo: TipoFila;
  /** Reales para 'real'/'actual'; proyectados para 'proyectado'. */
  ingresos: number;
  egresos: number;
  neto: number;
  saldoApertura: number;
  /** 'real'/'actual': saldo REAL (hoy en el actual). 'proyectado': encadenado. */
  saldoCierre: number;
  /**
   * Solo en 'actual': la proyección del REMANENTE del período en curso. La
   * cadena proyectada futura arranca en saldoCierreProy (= saldoCierre real de
   * hoy + neto proyectado restante de este período).
   */
  proyectadoRestante?: {
    ingresos: number;
    egresos: number;
    neto: number;
    saldoCierreProy: number;
  };
}

export interface FlujoCombinado {
  filas: FilaFlujo[];
  /** Compromisos sin fecha comprometida — informativos, FUERA de la curva. */
  sinFecha: { cuotasSinVencimiento: number; ocPendientes: number };
  /** Vencido (cuotas/OC a_plazo con fecha < hoy, aún pendientes). */
  vencido: number;
  /** true en day/week: proyección fina de ingresos aproximada. */
  ingresosAproximados: boolean;
}

export function combinarFlujo(params: {
  real: FlujoCajaPeriodo[];
  proyectado: FlujoProyectado;
  granularidad: Granularidad;
  hoy: string; // YYYY-MM-DD
}): FlujoCombinado {
  const { real, proyectado, granularidad, hoy } = params;

  const periodoActual = clavePeriodo(hoy, granularidad);

  // Spine = períodos REALES: fn_flujo_caja devuelve la grilla CONTINUA del
  // rango + los saldos reales (los futuros con 0 movimientos → saldo plano,
  // que NO usamos: ahí va el proyectado). Orden ascendente (ISO = cronológico).
  const realOrdenado = [...real].sort((a, b) =>
    a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0,
  );

  const realPorPeriodo = new Map<string, FlujoCajaPeriodo>();
  for (const r of realOrdenado) realPorPeriodo.set(r.periodo, r);

  const proyPorPeriodo = new Map<
    string,
    { ingresos: number; egresos: number; neto: number }
  >();
  for (const p of proyectado.porPeriodo) {
    proyPorPeriodo.set(p.periodo, {
      ingresos: p.ingresos,
      egresos: p.egresos,
      neto: p.neto,
    });
  }

  // Ancla = saldo real del que parte la cadena proyectada:
  //  - período actual en la ventana → su saldo_cierre real (= saldo hoy);
  //  - ventana enteramente futura → apertura real del primer período (saldo
  //    real al inicio de la ventana, que fn_flujo_caja calcula del ledger).
  const ancla: number = realPorPeriodo.has(periodoActual)
    ? (realPorPeriodo.get(periodoActual) as FlujoCajaPeriodo).saldoCierre
    : realOrdenado[0]?.saldoApertura ?? 0;

  const filas: FilaFlujo[] = [];
  let saldoProyPrev: number | null = null; // cierre proyectado del período anterior

  for (const r of realOrdenado) {
    const p = r.periodo;
    const proy = proyPorPeriodo.get(p) ?? { ingresos: 0, egresos: 0, neto: 0 };

    if (p < periodoActual) {
      // PASADO → real puro.
      filas.push({
        periodo: p,
        tipo: 'real',
        ingresos: r.ingresos,
        egresos: r.egresos,
        neto: r.neto,
        saldoApertura: r.saldoApertura,
        saldoCierre: r.saldoCierre,
      });
    } else if (p === periodoActual) {
      // EN CURSO → real-a-hoy + remanente proyectado del período.
      const saldoCierreProy = r.saldoCierre + proy.neto;
      filas.push({
        periodo: p,
        tipo: 'actual',
        ingresos: r.ingresos,
        egresos: r.egresos,
        neto: r.neto,
        saldoApertura: r.saldoApertura,
        saldoCierre: r.saldoCierre, // saldo REAL de hoy
        proyectadoRestante: {
          ingresos: proy.ingresos,
          egresos: proy.egresos,
          neto: proy.neto,
          saldoCierreProy,
        },
      });
      // La cadena futura arranca en el saldo proyectado a fin del período actual.
      saldoProyPrev = saldoCierreProy;
    } else {
      // FUTURO → proyectado, saldo encadenado desde el período previo / ancla.
      const apertura: number = saldoProyPrev ?? ancla;
      const cierre: number = apertura + proy.neto;
      filas.push({
        periodo: p,
        tipo: 'proyectado',
        ingresos: proy.ingresos,
        egresos: proy.egresos,
        neto: proy.neto,
        saldoApertura: apertura,
        saldoCierre: cierre,
      });
      saldoProyPrev = cierre;
    }
  }

  return {
    filas,
    sinFecha: proyectado.sinFecha,
    vencido: proyectado.vencido,
    ingresosAproximados: proyectado.ingresosAproximados,
  };
}
