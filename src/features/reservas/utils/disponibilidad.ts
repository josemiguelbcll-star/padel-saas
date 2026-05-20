import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import type { ReservaConTitular } from '../hooks/useReservasDelDia';
import { horaToMinutos, minutosToHora } from './horaUtils';

export interface SlotDisponible {
  /** 'HH:MM:SS' — hora de inicio del slot disponible. */
  hora: string;
  /** Duración del slot en minutos (en sprint 3a, siempre = 90). */
  duracionMin: number;
}

interface CalcularDisponiblesParams {
  /** Reservas (no canceladas) de la cancha en el día. */
  reservas: ReservaConTitular[];
  /** Clases activas de la cancha que aplican al día (ya filtradas por dias_semana). */
  clases: ClaseConProfesor[];
  /** Hora de apertura del club, 'HH:MM' o 'HH:MM:SS'. */
  horaApertura: string;
  /** Hora de cierre del club, 'HH:MM' o 'HH:MM:SS'. */
  horaCierre: string;
  /** Duración del partido a tilear. Default 90 (sprint 3a). */
  duracionPartidoMin?: number;
}

/**
 * Calcula los slots "Disponible" de una cancha en un día dado.
 *
 * Algoritmo:
 *   1. Unir reservas + clases como intervalos ocupados (minutos desde 00:00).
 *   2. Computar los huecos libres entre apertura y cierre (set algebra básica).
 *   3. Para cada hueco, tilear con bloques encadenados de `duracionPartidoMin`
 *      desde el inicio del hueco. Remanentes < duracionPartidoMin quedan
 *      sin tilear (espacio en blanco, no hay click target).
 *
 * El "tiling encadenado desde el inicio" es la decisión definida en la
 * sección "Requisitos pendientes" del CLAUDE.md: por ahora los turnos
 * son rígidos (8:00, 9:30, 11:00...). En el futuro se va a permitir
 * elegir cualquier inicio cada 30 min — ahí cambia este algoritmo.
 */
export function calcularDisponibles({
  reservas,
  clases,
  horaApertura,
  horaCierre,
  duracionPartidoMin = 90,
}: CalcularDisponiblesParams): SlotDisponible[] {
  const aperturaMin = horaToMinutos(horaApertura);
  const cierreMin = horaToMinutos(horaCierre);

  if (cierreMin <= aperturaMin) return [];

  // 1. Intervalos ocupados (en minutos), sólo dentro de las horas del club.
  const ocupados: { start: number; end: number }[] = [];

  for (const r of reservas) {
    if (r.estado === 'cancelada') continue;
    ocupados.push({
      start: horaToMinutos(r.hora_inicio),
      end: horaToMinutos(r.hora_fin),
    });
  }

  for (const c of clases) {
    if (!c.activa) continue;
    const start = horaToMinutos(c.hora_inicio);
    ocupados.push({ start, end: start + c.duracion_min });
  }

  ocupados.sort((a, b) => a.start - b.start);

  // 2. Huecos libres dentro de [apertura, cierre).
  const huecos: { start: number; end: number }[] = [];
  let cursor = aperturaMin;
  for (const o of ocupados) {
    // Si el ocupado arranca dentro o antes del cursor, lo absorbemos.
    if (o.end <= cursor) continue;
    if (o.start > cursor) {
      huecos.push({ start: cursor, end: Math.min(o.start, cierreMin) });
    }
    cursor = Math.max(cursor, o.end);
    if (cursor >= cierreMin) break;
  }
  if (cursor < cierreMin) {
    huecos.push({ start: cursor, end: cierreMin });
  }

  // 3. Tilear cada hueco con bloques encadenados de duracionPartidoMin.
  const disponibles: SlotDisponible[] = [];
  for (const h of huecos) {
    let start = h.start;
    while (start + duracionPartidoMin <= h.end) {
      disponibles.push({
        hora: minutosToHora(start),
        duracionMin: duracionPartidoMin,
      });
      start += duracionPartidoMin;
    }
    // Remanente (< duracionPartidoMin) queda como espacio en blanco.
  }

  return disponibles;
}
