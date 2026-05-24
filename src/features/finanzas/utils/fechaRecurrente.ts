/**
 * Helpers para resolver el día de vencimiento de una plantilla
 * recurrente a una fecha real del mes activo. CRÍTICO: usamos CLAMP
 * (no addMonths) — el día 31 de una plantilla en febrero debe caer
 * en el 28 (o 29 bisiesto), NO en el 3 de marzo.
 */

export interface RangoMes {
  /** YYYY-MM-DD del primer día del mes. */
  desde: string;
  /** YYYY-MM-DD del último día del mes. */
  hasta: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Devuelve el último día calendárico de un mes (1-31). */
export function ultimoDiaDelMes(anio: number, mes: number): number {
  // Día 0 del mes siguiente = último día del mes actual.
  return new Date(anio, mes + 1, 0).getDate();
}

/**
 * Clampa el día de la plantilla al último día del mes. NO hace
 * aritmética calendárica; solo asegura que el día existe en el mes.
 *
 * Ej: diaPlantilla=31, mes=feb 2026 → 28.
 * Ej: diaPlantilla=31, mes=abr 2026 → 30.
 * Ej: diaPlantilla=15, mes=feb 2026 → 15.
 */
export function clampDiaAlMes(
  diaPlantilla: number,
  anio: number,
  mes: number,
): number {
  return Math.min(diaPlantilla, ultimoDiaDelMes(anio, mes));
}

/** ISO YYYY-MM-DD del vencimiento de la plantilla en un mes dado. */
export function fechaVencimientoEnMes(
  diaPlantilla: number,
  anio: number,
  mes: number,
): string {
  const dia = clampDiaAlMes(diaPlantilla, anio, mes);
  return `${anio}-${pad2(mes + 1)}-${pad2(dia)}`;
}

/** Rango [desde, hasta] ISO del mes (inclusive ambos extremos). */
export function rangoDelMes(anio: number, mes: number): RangoMes {
  return {
    desde: `${anio}-${pad2(mes + 1)}-01`,
    hasta: `${anio}-${pad2(mes + 1)}-${pad2(ultimoDiaDelMes(anio, mes))}`,
  };
}

/** YYYY-MM-DD del día de hoy en hora local. */
export function hoyISO(): string {
  return toISO(new Date());
}
