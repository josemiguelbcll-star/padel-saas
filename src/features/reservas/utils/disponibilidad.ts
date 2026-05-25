import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import type { FranjaTurno } from '@/types/database';
import type { ReservaConTitular } from '../hooks/useReservasDelDia';
import { horaToMinutos, minutosToHora } from './horaUtils';
import { resolverDuraciones } from './resolverDuraciones';

export interface SlotDisponible {
  /** 'HH:MM:SS' — hora de inicio del slot disponible. */
  hora: string;
  /**
   * Duraciones (minutos) que se pueden reservar arrancando en este
   * inicio, según la franja aplicable. Ordenadas asc, siempre ≥1.
   * Antes era `duracionMin` (un único valor); ahora un inicio puede
   * ofrecer varias (ej. mañana 60 o 90) y el usuario elige al reservar.
   * La más corta (índice 0) es el "paso" del tiling y la altura del bloque.
   */
  duracionesPermitidas: number[];
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
  /** Fecha del día ('YYYY-MM-DD') — para resolver dias_semana de las franjas. */
  fecha: string;
  /** Cancha de la columna — para resolver franjas cancha-específicas. */
  canchaId: number;
  /** Franjas de turno del club (0050). Vacío = no hay reglas → fallback. */
  franjas: FranjaTurno[];
  /** clubes.duracion_turno_default — duración usada cuando no hay franja. */
  duracionDefault: number;
}

/**
 * Calcula los slots "Disponible" de una cancha en un día dado (grilla
 * dinámica, Forma B).
 *
 * Algoritmo:
 *   1. Unir reservas + clases como intervalos ocupados (minutos desde 00:00).
 *   2. Computar los huecos libres entre apertura y cierre (set algebra básica).
 *   3. Tilear cada hueco con INICIOS FLEXIBLES POR FRANJA: un cursor camina
 *      desde el inicio del hueco; en cada posición resuelve la franja
 *      aplicable (resolverDuraciones) y ofrece las duraciones que entran
 *      antes de min(fin del hueco, fin de la franja) — un turno NUNCA cruza
 *      el borde de su franja. Avanza por la duración más corta ofrecida
 *      (el "paso"). Si nada entra en lo que resta de la franja, salta al
 *      fin de ésta.
 *
 * FALLBACK (club sin franjas): resolverDuraciones devuelve
 * { duraciones: [duracionDefault], hastaHora: null }, así que el tiling
 * encadena `duracionDefault` desde el inicio de cada hueco — el mismo
 * comportamiento de turnos rígidos de antes (con duracionDefault=90, es
 * idéntico a la grilla previa).
 */
export function calcularDisponibles({
  reservas,
  clases,
  horaApertura,
  horaCierre,
  fecha,
  canchaId,
  franjas,
  duracionDefault,
}: CalcularDisponiblesParams): SlotDisponible[] {
  const aperturaMin = horaToMinutos(horaApertura);
  const cierreMin = horaToMinutos(horaCierre);

  if (cierreMin <= aperturaMin) return [];

  // 1. Intervalos ocupados (en minutos). IDÉNTICO a la versión previa.
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

  // 2. Huecos libres dentro de [apertura, cierre). IDÉNTICO a la previa.
  const huecos: { start: number; end: number }[] = [];
  let cursor = aperturaMin;
  for (const o of ocupados) {
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

  // 3. Tilear cada hueco con inicios flexibles por franja.
  const disponibles: SlotDisponible[] = [];
  for (const h of huecos) {
    let pos = h.start;
    // Salvaguarda contra loop infinito (cada vuelta debe avanzar `pos`).
    let guard = 0;
    const maxIter = Math.ceil((h.end - h.start) / 30) + 4;

    while (pos < h.end && guard++ < maxIter) {
      const hora = minutosToHora(pos);
      const { duraciones, hastaHora } = resolverDuraciones({
        fecha,
        hora,
        canchaId,
        franjas,
        duracionDefault,
      });
      // Un turno no cruza el borde de su franja (ni el del hueco).
      const franjaHastaMin = hastaHora !== null ? horaToMinutos(hastaHora) : h.end;
      const limite = Math.min(h.end, franjaHastaMin);
      const ofrecidas = duraciones
        .filter((d) => pos + d <= limite)
        .sort((a, b) => a - b);

      if (ofrecidas.length > 0) {
        disponibles.push({ hora, duracionesPermitidas: ofrecidas });
        pos += ofrecidas[0]!; // paso = duración más corta ofrecida
      } else {
        // Nada entra desde `pos` hasta el fin de la franja → saltar.
        pos = franjaHastaMin > pos ? franjaHastaMin : pos + 30;
      }
    }
  }

  return disponibles;
}
