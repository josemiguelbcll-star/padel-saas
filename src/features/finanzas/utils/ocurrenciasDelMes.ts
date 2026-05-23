/**
 * Helper puro: dado un mes y un día (o array de días) ISO de la semana,
 * devuelve las fechas YYYY-MM-DD del mes que caen en ese/esos día(s),
 * respetando una vigencia opcional [fechaDesde, fechaHasta].
 *
 * Usado por la proyección de alquileres del dashboard para enumerar
 * ocurrencias de turnos fijos y clases recurrentes del mes en curso.
 *
 * Convención: 1=lunes ... 7=domingo (ISODOW, espejo de Postgres).
 */

export interface OcurrenciasParams {
  /** Año (ej. 2026). */
  anio: number;
  /** Mes 1-12. */
  mes: number;
  /** Día ISO de la semana (1..7) o array de ellos. */
  diasSemana: number | number[];
  /** YYYY-MM-DD opcional. Excluye fechas anteriores. */
  fechaDesde?: string | null;
  /** YYYY-MM-DD opcional. Excluye fechas posteriores. */
  fechaHasta?: string | null;
}

function diaIsoDe(d: Date): number {
  // JS getDay: 0=domingo..6=sábado. ISO: 1=lunes..7=domingo.
  return d.getDay() === 0 ? 7 : d.getDay();
}

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function ocurrenciasDelMes(params: OcurrenciasParams): string[] {
  const { anio, mes, diasSemana, fechaDesde, fechaHasta } = params;
  const diasSet = new Set(
    Array.isArray(diasSemana) ? diasSemana : [diasSemana],
  );

  const out: string[] = [];
  // mes recibido 1-12; Date usa 0-11.
  const ultimoDia = new Date(anio, mes, 0).getDate();
  for (let d = 1; d <= ultimoDia; d += 1) {
    const fecha = new Date(anio, mes - 1, d);
    if (!diasSet.has(diaIsoDe(fecha))) continue;
    const iso = fmtISO(fecha);
    if (fechaDesde && iso < fechaDesde) continue;
    if (fechaHasta && iso > fechaHasta) continue;
    out.push(iso);
  }
  return out;
}

/**
 * Devuelve {desde, hasta} en formato YYYY-MM-DD del mes dado. Útil para
 * acotar queries por columna `fecha`.
 */
export function rangoMesISO(anio: number, mes: number): {
  desde: string;
  hasta: string;
} {
  const desde = new Date(anio, mes - 1, 1);
  const hasta = new Date(anio, mes, 0); // día 0 del mes siguiente
  return { desde: fmtISO(desde), hasta: fmtISO(hasta) };
}

/**
 * Para el comparativo de ritmo del buffet: devuelve la fecha YYYY-MM-DD
 * del mes anterior con el MISMO número de día que `hoy`. Si el mes
 * anterior no tiene ese día (ej. hoy=31 y mes anterior tiene 30 días),
 * devuelve el último día del mes anterior.
 */
export function mismoDiaDelMesAnterior(hoy: Date): string {
  const dia = hoy.getDate();
  const anioAnt = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
  const mesAnt0 = hoy.getMonth() === 0 ? 11 : hoy.getMonth() - 1;
  // último día del mes anterior
  const ultimoDiaMesAnt = new Date(anioAnt, mesAnt0 + 1, 0).getDate();
  const diaEfectivo = Math.min(dia, ultimoDiaMesAnt);
  return fmtISO(new Date(anioAnt, mesAnt0, diaEfectivo));
}
