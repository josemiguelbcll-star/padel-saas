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

/** Intervalo ocupado, en minutos desde 00:00. */
export interface Intervalo {
  start: number;
  end: number;
}

interface CalcularDisponiblesCoreParams {
  /** Intervalos ocupados (minutos). Se ordenan adentro; no se mutan. */
  ocupados: Intervalo[];
  /** Hora de apertura del club, 'HH:MM' o 'HH:MM:SS'. */
  horaApertura: string;
  /** Hora de cierre del club, 'HH:MM' o 'HH:MM:SS'. */
  horaCierre: string;
  /** Fecha del día ('YYYY-MM-DD') — para resolver dias_semana de las franjas. */
  fecha: string;
  /** Cancha — para resolver franjas cancha-específicas. */
  canchaId: number;
  franjas: FranjaTurno[];
  duracionDefault: number;
}

/**
 * Núcleo del cálculo de disponibilidad (grilla dinámica, Forma B).
 *
 * Dado el conjunto de intervalos OCUPADOS + horario + franjas, devuelve los
 * inicios libres con sus duraciones permitidas por franja. No sabe de dónde
 * viene la ocupación: la grilla de reservas la arma desde reservas + clases
 * (`calcularDisponibles`); el calendario de turnos fijos la arma desde turnos
 * fijos + clases. Un solo motor, dos adapters.
 *
 * Algoritmo:
 *   1. Computar los huecos libres entre apertura y cierre (set algebra básica).
 *   2. Tilear cada hueco con INICIOS FLEXIBLES POR FRANJA: un cursor camina
 *      desde el inicio del hueco; en cada posición resuelve la franja aplicable
 *      (resolverDuraciones) y ofrece las duraciones que entran antes de
 *      min(fin del hueco, fin de la franja) — un turno NUNCA cruza el borde de
 *      su franja. Avanza por la duración más corta ofrecida (el "paso"). Si
 *      nada entra en lo que resta de la franja, salta al fin de ésta.
 *
 * FALLBACK (club sin franjas): resolverDuraciones devuelve
 * { duraciones: [duracionDefault], hastaHora: null }, así que el tiling
 * encadena `duracionDefault` desde el inicio de cada hueco.
 */
export function calcularDisponiblesCore({
  ocupados,
  horaApertura,
  horaCierre,
  fecha,
  canchaId,
  franjas,
  duracionDefault,
}: CalcularDisponiblesCoreParams): SlotDisponible[] {
  const aperturaMin = horaToMinutos(horaApertura);
  let cierreMin = horaToMinutos(horaCierre);
  if (cierreMin === 0) cierreMin = 1440;

  if (cierreMin <= aperturaMin) return [];

  // Orden por inicio (copia — no mutamos el array del caller).
  const ordenados = [...ocupados].sort((a, b) => a.start - b.start);

  // 1. Huecos libres dentro de [apertura, cierre).
  const huecos: { start: number; end: number }[] = [];
  let cursor = aperturaMin;
  for (const o of ordenados) {
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

  // 2. Tilear cada hueco con inicios flexibles por franja.
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

/**
 * Slots "Disponible" de una cancha en un día (grilla de reservas). Adapter
 * fino sobre `calcularDisponiblesCore`: arma la ocupación desde las reservas
 * (no canceladas) y las clases activas, y delega el cálculo.
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
  const ocupados: Intervalo[] = [];

  for (const r of reservas) {
    if (r.estado === 'cancelada') continue;
    const start = horaToMinutos(r.hora_inicio);
    let end = horaToMinutos(r.hora_fin);
    if (end === 0 || end < start) end = 1440;
    ocupados.push({
      start,
      end,
    });
  }

  for (const c of clases) {
    if (!c.activa) continue;
    const start = horaToMinutos(c.hora_inicio);
    ocupados.push({ start, end: start + c.duracion_min });
  }

  return calcularDisponiblesCore({
    ocupados,
    horaApertura,
    horaCierre,
    fecha,
    canchaId,
    franjas,
    duracionDefault,
  });
}
