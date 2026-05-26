import type { TurnoFijo } from '@/types/database';
import { horaToMinutos } from '@/features/reservas/utils/horaUtils';

/**
 * Helpers de RENDER de la ocupación de turnos fijos en el calendario
 * semanal: mapean cada turno fijo a un bloque posicionable (minutos desde
 * 00:00) y detectan cruces para resaltarlos.
 *
 * La DISPONIBILIDAD (qué slots quedan libres respetando las franjas del
 * club) NO vive acá: la calcula el motor real `calcularDisponiblesCore`
 * (`src/features/reservas/utils/disponibilidad.ts`), el mismo que alimenta
 * la grilla de reservas. Un solo motor, sin lógica de franjas duplicada.
 */

/** Un turno fijo posicionado en minutos desde 00:00. */
export interface OcupacionFijo {
  turno: TurnoFijo;
  inicioMin: number;
  finMin: number;
}

/** Turnos fijos del día (dia_semana 1..7) → rangos en minutos, ordenados. */
export function ocupacionDelDia(turnos: TurnoFijo[], dia: number): OcupacionFijo[] {
  return turnos
    .filter((t) => t.dia_semana === dia)
    .map((t) => {
      const inicioMin = horaToMinutos(t.hora_inicio);
      return { turno: t, inicioMin, finMin: inicioMin + t.duracion_min };
    })
    .sort((a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin);
}

/**
 * Cruces entre turnos fijos del mismo día. No deberían existir (el alta
 * valida), pero si la data quedó sucia los marcamos para resaltarlos en
 * vez de pisarlos en silencio. Devuelve el set de ids involucrados en algún
 * solape. Asume `ocupacion` ordenada por inicio.
 */
export function idsConCruce(ocupacion: OcupacionFijo[]): Set<number> {
  const cruzados = new Set<number>();
  for (let i = 0; i < ocupacion.length; i++) {
    const a = ocupacion[i];
    if (!a) continue;
    for (let j = i + 1; j < ocupacion.length; j++) {
      const b = ocupacion[j];
      if (!b) continue;
      if (b.inicioMin >= a.finMin) break;
      cruzados.add(a.turno.id);
      cruzados.add(b.turno.id);
    }
  }
  return cruzados;
}
