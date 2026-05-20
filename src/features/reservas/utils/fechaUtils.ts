/**
 * Helpers de fecha (`'YYYY-MM-DD'` como formato canónico para Postgres DATE).
 *
 * Convención: 1 = lunes, 7 = domingo (espejo del modelo de datos —
 * tarifas.dias_semana, franjas_duracion.dias_semana). JavaScript devuelve
 * 0 para domingo, 1 para lunes; lo remapeamos a la convención del SaaS.
 */

function parseFechaISO(fecha: string): Date {
  const parts = fecha.split('-');
  if (parts.length !== 3) {
    throw new Error(`Fecha inválida: ${fecha}`);
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    throw new Error(`Fecha inválida: ${fecha}`);
  }
  // Date(year, monthIndex, day) usa hora local. Para fecha "pelada" sin
  // hora, esto es lo que queremos (no queremos drift por UTC).
  return new Date(year, month - 1, day);
}

/** Formato canónico 'YYYY-MM-DD' usado en columnas DATE de Postgres. */
export function formatearFechaISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Día de la semana en convención SaaS: 1 = lunes, 7 = domingo. */
export function diaSemanaDe(fecha: string): number {
  const d = parseFechaISO(fecha);
  const js = d.getDay(); // 0=domingo, 1=lunes, ..., 6=sábado
  return js === 0 ? 7 : js;
}

/** Fecha de hoy en formato 'YYYY-MM-DD'. */
export function fechaHoy(): string {
  return formatearFechaISO(new Date());
}

/** Avanza un día. Devuelve 'YYYY-MM-DD'. */
export function fechaSiguiente(fecha: string): string {
  const d = parseFechaISO(fecha);
  d.setDate(d.getDate() + 1);
  return formatearFechaISO(d);
}

/** Retrocede un día. Devuelve 'YYYY-MM-DD'. */
export function fechaAnterior(fecha: string): string {
  const d = parseFechaISO(fecha);
  d.setDate(d.getDate() - 1);
  return formatearFechaISO(d);
}

/**
 * Formato amigable es-AR para mostrar al usuario en el header de la
 * grilla. Ej: "Lunes 18 de mayo".
 */
export function formatearFechaAmigable(fecha: string): string {
  const d = parseFechaISO(fecha);
  const formatted = d.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  // toLocaleDateString puede devolver con minúscula inicial; capitalizamos.
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
