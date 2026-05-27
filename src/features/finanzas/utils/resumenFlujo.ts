import type { FilaFlujo, FlujoCombinado, TipoFila } from './combinarFlujo';

/**
 * Resumen ejecutivo del flujo de caja para el hero de KPIs + la alerta de
 * liquidez. PURO (derivado de combinarFlujo) → testeable.
 *
 * El insight clave es la LIQUIDEZ: si (y cuándo) el saldo proyectado cruza a
 * negativo (`primerNegativo`) y cuál es el piso del horizonte (`minSaldo` /
 * `minPeriodo`, el "valle de liquidez").
 */
export interface ResumenFlujo {
  /** Saldo REAL a hoy (cierre del período en curso; fallback al último real). */
  saldoHoy: number | null;
  /** Saldo proyectado al final del horizonte (cierre del último período). */
  saldoProyFin: number | null;
  /** Período final del horizonte (para etiquetar "a fin de…"). */
  finPeriodo: string | null;
  /** Variación proyectada en el horizonte (saldoProyFin − saldoHoy). */
  netoHorizonte: number;
  /** Piso de saldo en todo el rango (valle de liquidez) + su período. */
  minSaldo: number | null;
  minPeriodo: string | null;
  /** Primer período cuyo saldo de cierre es < 0 (cuándo se va a rojo). NULL =
   *  no hay riesgo de quedar negativo en el horizonte. */
  primerNegativo: string | null;
  primerNegativoTipo: TipoFila | null;
  /** ¿El rango incluye el período en curso? */
  hayActual: boolean;
}

const VACIO: ResumenFlujo = {
  saldoHoy: null,
  saldoProyFin: null,
  finPeriodo: null,
  netoHorizonte: 0,
  minSaldo: null,
  minPeriodo: null,
  primerNegativo: null,
  primerNegativoTipo: null,
  hayActual: false,
};

export function resumenFlujo(combinado: FlujoCombinado): ResumenFlujo {
  const filas = combinado.filas;
  if (filas.length === 0) return VACIO;

  const ultima = filas[filas.length - 1] as FilaFlujo;
  const saldoProyFin = ultima.saldoCierre;

  // Saldo hoy = período en curso (real a hoy); fallback al último período real.
  const actual = filas.find((f) => f.tipo === 'actual');
  let saldoHoy: number | null;
  let hayActual: boolean;
  if (actual) {
    saldoHoy = actual.saldoCierre;
    hayActual = true;
  } else {
    const reales = filas.filter((f) => f.tipo === 'real');
    saldoHoy = reales.length > 0 ? (reales[reales.length - 1] as FilaFlujo).saldoCierre : null;
    hayActual = false;
  }

  const netoHorizonte = saldoHoy === null ? 0 : saldoProyFin - saldoHoy;

  // Valle de liquidez (saldo más bajo del rango) + primer cruce a negativo.
  let minSaldo = ultima.saldoCierre;
  let minPeriodo = ultima.periodo;
  let primerNegativo: string | null = null;
  let primerNegativoTipo: TipoFila | null = null;
  for (const f of filas) {
    if (f.saldoCierre < minSaldo) {
      minSaldo = f.saldoCierre;
      minPeriodo = f.periodo;
    }
    if (primerNegativo === null && f.saldoCierre < 0) {
      primerNegativo = f.periodo;
      primerNegativoTipo = f.tipo;
    }
  }

  return {
    saldoHoy,
    saldoProyFin,
    finPeriodo: ultima.periodo,
    netoHorizonte,
    minSaldo,
    minPeriodo,
    primerNegativo,
    primerNegativoTipo,
    hayActual,
  };
}
