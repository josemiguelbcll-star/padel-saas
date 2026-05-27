/**
 * Helpers PUROS de "matemática de períodos" para el flujo de caja. Espejan
 * exactamente el bucketing de `fn_flujo_caja` (0061) en SQL, para que el flujo
 * PROYECTADO (frontend) caiga en las MISMAS claves de período que el flujo
 * REAL (SQL). Sin estado, sin I/O → testeables en Node plano.
 *
 * Convención: las fechas son de CALENDARIO (YYYY-MM-DD), sin hora ni zona.
 * Las fechas de proyección (vencimientos, días de recurrentes, fechas de
 * reservas) ya son fechas-calendario AR, así que coinciden con el "día local
 * AR" que `fn_flujo_caja` deriva de los instantes. Semana = lunes (ISO), igual
 * que `date_trunc('week', ...)` de Postgres.
 */

export type Granularidad = 'day' | 'week' | 'month';

function parseISO(fechaISO: string): { y: number; m: number; d: number } {
  const p = fechaISO.split('-');
  return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
}

function fmtISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** ISO day-of-week 1..7 (1=lunes ... 7=domingo) de una fecha-calendario. */
function isoDow(y: number, m: number, d: number): number {
  const wd = new Date(y, m - 1, d).getDay(); // 0=domingo .. 6=sábado
  return wd === 0 ? 7 : wd;
}

/** Último día (28..31) del mes dado. */
export function ultimoDiaMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate(); // día 0 del mes siguiente
}

/**
 * Clave de período (fecha-inicio ISO) que espeja date_trunc:
 *   'day'   → la misma fecha.
 *   'week'  → lunes ISO de esa semana.
 *   'month' → día 1 del mes.
 */
export function clavePeriodo(fechaISO: string, gran: Granularidad): string {
  const { y, m, d } = parseISO(fechaISO);
  if (gran === 'month') return fmtISO(y, m, 1);
  if (gran === 'day') return fmtISO(y, m, d);
  // week → retroceder al lunes de la semana ISO.
  const dow = isoDow(y, m, d);
  const fecha = new Date(y, m - 1, d);
  fecha.setDate(fecha.getDate() - (dow - 1));
  return fmtISO(fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate());
}

/** Período siguiente a uno dado (avanza 1 día / 1 semana / 1 mes). */
function siguientePeriodo(periodoISO: string, gran: Granularidad): string {
  const { y, m, d } = parseISO(periodoISO);
  const fecha = new Date(y, m - 1, d);
  if (gran === 'day') fecha.setDate(fecha.getDate() + 1);
  else if (gran === 'week') fecha.setDate(fecha.getDate() + 7);
  else fecha.setMonth(fecha.getMonth() + 1);
  return fmtISO(fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate());
}

/**
 * Lista CONTINUA de claves de período que cubren [desde, hasta] (ambos
 * alineados a su período natural). Espeja el generate_series de fn_flujo_caja
 * → el flujo proyectado tiene una fila por período aunque no haya compromisos.
 * Comparación lexicográfica de ISO = cronológica.
 */
export function enumerarPeriodos(
  desdeISO: string,
  hastaISO: string,
  gran: Granularidad,
): string[] {
  const out: string[] = [];
  const fin = clavePeriodo(hastaISO, gran);
  let cur = clavePeriodo(desdeISO, gran);
  let guard = 0;
  while (cur <= fin && guard < 100000) {
    out.push(cur);
    cur = siguientePeriodo(cur, gran);
    guard += 1;
  }
  return out;
}

/**
 * Meses calendario en [desde, hasta] (inclusive). Para iterar la proyección
 * de ingresos mensual (calcularProyeccion* trabajan por anio/mes).
 */
export function enumerarMeses(
  desdeISO: string,
  hastaISO: string,
): Array<{ anio: number; mes: number; firstISO: string; mKey: string }> {
  const a = parseISO(desdeISO);
  const b = parseISO(hastaISO);
  const out: Array<{ anio: number; mes: number; firstISO: string; mKey: string }> = [];
  let y = a.y;
  let m = a.m;
  let guard = 0;
  while ((y < b.y || (y === b.y && m <= b.m)) && guard < 1200) {
    out.push({
      anio: y,
      mes: m,
      firstISO: fmtISO(y, m, 1),
      mKey: `${y}-${String(m).padStart(2, '0')}`,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

/** Hoy en fecha-calendario LOCAL (YYYY-MM-DD). No es puro (usa el reloj); por
 *  eso vive acá y no se mete dentro de las otras funciones. */
export function hoyISO(): string {
  const d = new Date();
  return fmtISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// ── Etiquetas de período (es-AR) — compartidas por la UI del flujo ──────────
const _mesAnioFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' });
const _diaMesFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' });

/** Etiqueta corta y legible de un período (inicio ISO), según granularidad.
 *  month → "may 2026" · week → "sem. 11/05" · day → "11/05". */
export function etiquetaPeriodo(iso: string, gran: Granularidad): string {
  const { y, m, d } = parseISO(iso);
  const fecha = new Date(y, m - 1, d);
  if (gran === 'month') {
    const s = _mesAnioFmt.format(fecha).replace('.', '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (gran === 'week') return `sem. ${_diaMesFmt.format(fecha)}`;
  return _diaMesFmt.format(fecha);
}
