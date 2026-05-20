/**
 * Helpers para manipular y comparar horas como strings 'HH:MM' o 'HH:MM:SS'.
 *
 * La comparación lexicográfica de strings con formato zero-padded
 * (HH:MM o HH:MM:SS) es ordinalmente equivalente a la comparación
 * cronológica. Lo usamos en lugar de convertir a Date para evitar
 * problemas de zona horaria.
 */

/** Normaliza 'HH:MM' a 'HH:MM:SS' agregando ':00' al final. */
export function normalizarHora(hora: string): string {
  return hora.length === 5 ? `${hora}:00` : hora;
}

/** Formato sin segundos: 'HH:MM:SS' o 'HH:MM' → 'HH:MM'. */
export function formatearHora(hora: string): string {
  return hora.slice(0, 5);
}

/**
 * Suma minutos a una hora 'HH:MM' o 'HH:MM:SS'. Devuelve 'HH:MM:SS'.
 * Si el resultado supera 24h, hace wrap (00:00 - 23:59).
 */
export function sumarMinutos(hora: string, minutos: number): string {
  const parts = hora.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Hora inválida: ${hora}`);
  }
  const total = h * 60 + m + minutos;
  const newH = ((Math.floor(total / 60) % 24) + 24) % 24;
  const newM = ((total % 60) + 60) % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}:00`;
}

/**
 * Compara dos horas. Acepta cualquier mezcla de 'HH:MM' y 'HH:MM:SS'.
 * Devuelve negativo si a < b, 0 si iguales, positivo si a > b.
 */
export function compararHoras(a: string, b: string): number {
  const aNorm = normalizarHora(a);
  const bNorm = normalizarHora(b);
  return aNorm.localeCompare(bNorm);
}

/**
 * Genera los slots de granularidad fija entre hora_apertura (incluida)
 * y hora_cierre (excluida). Devuelve array de strings 'HH:MM:SS'.
 *
 * Por defecto granularidad = 30 min, que es el común divisor de las
 * duraciones permitidas (60, 90, 120, 150, 180, 240).
 */
export function generarSlots(
  horaApertura: string,
  horaCierre: string,
  granularidadMin = 30,
): string[] {
  const slots: string[] = [];
  let actual = normalizarHora(horaApertura);
  const fin = normalizarHora(horaCierre);
  // Salvaguarda: si por error apertura >= cierre, devolver array vacío
  // en lugar de loopear forever.
  if (compararHoras(actual, fin) >= 0) return slots;

  while (compararHoras(actual, fin) < 0) {
    slots.push(actual);
    actual = sumarMinutos(actual, granularidadMin);
  }
  return slots;
}

/**
 * Convierte 'HH:MM' o 'HH:MM:SS' a minutos desde 00:00.
 * '08:30' → 510. '10:00:00' → 600. Útil para aritmética de intervalos.
 */
export function horaToMinutos(hora: string): number {
  const parts = hora.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Hora inválida: ${hora}`);
  }
  return h * 60 + m;
}

/**
 * Convierte minutos desde 00:00 a 'HH:MM:SS'. 510 → '08:30:00'.
 * Hace wrap a 24h si el valor supera 1440.
 */
export function minutosToHora(minutos: number): string {
  const total = ((minutos % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
