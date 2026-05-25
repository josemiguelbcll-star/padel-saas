import type { FranjaTurno } from '@/types/database';
import { diaSemanaDe } from './fechaUtils';
import { compararHoras } from './horaUtils';

/**
 * Resuelve QUÉ duraciones se pueden reservar arrancando en un (fecha,
 * hora) de una cancha. Espejo client-side de fn_resolver_duraciones
 * (0050). Es el que alimenta la grilla (calcularDisponibles corre
 * client-side) — ambos algoritmos deben mantenerse en sintonía.
 *
 * Regla de resolución:
 *   1. Filtra franjas activas que aplican:
 *      - cancha: la franja es global (cancha_id NULL) o de esta cancha
 *      - dias_semana incluye el día  OR  dias_semana IS NULL
 *      - hora dentro de [desde_hora, hasta_hora)  OR  ambas NULL
 *   2. Ordena: cancha-específica primero, luego prioridad DESC, id DESC.
 *   3. Devuelve las duraciones de la primera + su borde `hastaHora`.
 *   4. Si ninguna aplica → fallback { duraciones: [duracionDefault],
 *      hastaHora: null } (club sin franjas funciona como hoy).
 *
 * `hastaHora` (borde de la franja) lo usa calcularDisponibles como
 * límite: un turno no puede cruzar el borde de su franja. null = la
 * franja (o el fallback) aplica a toda hora → el límite lo pone el fin
 * del hueco / cierre del club.
 */
export interface DuracionesResueltas {
  /** Duraciones permitidas (minutos), ordenadas ascendente. */
  duraciones: number[];
  /** 'HH:MM:SS' borde superior de la franja, o null si aplica a toda hora. */
  hastaHora: string | null;
}

interface ResolverDuracionesParams {
  /** 'YYYY-MM-DD' */
  fecha: string;
  /** 'HH:MM' o 'HH:MM:SS' — hora de inicio candidata */
  hora: string;
  /** Cancha para la que se resuelve (las franjas globales también aplican). */
  canchaId: number;
  franjas: FranjaTurno[];
  /** clubes.duracion_turno_default — fallback cuando ninguna franja aplica. */
  duracionDefault: number;
}

export function resolverDuraciones(
  params: ResolverDuracionesParams,
): DuracionesResueltas {
  const { fecha, hora, canchaId, franjas, duracionDefault } = params;
  const diaSemana = diaSemanaDe(fecha);

  const aplicables = franjas.filter((f) =>
    franjaAplicaA(f, diaSemana, hora, canchaId),
  );

  if (aplicables.length === 0) {
    return { duraciones: [duracionDefault], hastaHora: null };
  }

  const ordenadas = [...aplicables].sort((a, b) => {
    // cancha-específica (cancha_id != null) gana sobre global (null).
    const aEspecifica = a.cancha_id !== null ? 1 : 0;
    const bEspecifica = b.cancha_id !== null ? 1 : 0;
    if (aEspecifica !== bEspecifica) return bEspecifica - aEspecifica;
    if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
    return b.id - a.id;
  });

  const elegida = ordenadas[0]!;
  return {
    duraciones: [...elegida.duraciones_min].sort((x, y) => x - y),
    hastaHora: elegida.hasta_hora,
  };
}

function franjaAplicaA(
  franja: FranjaTurno,
  diaSemana: number,
  hora: string,
  canchaId: number,
): boolean {
  if (!franja.activa) return false;

  // cancha: global (NULL) o exactamente esta cancha.
  if (franja.cancha_id !== null && franja.cancha_id !== canchaId) return false;

  if (
    franja.dias_semana !== null &&
    !franja.dias_semana.includes(diaSemana)
  ) {
    return false;
  }

  if (franja.desde_hora !== null && franja.hasta_hora !== null) {
    if (compararHoras(hora, franja.desde_hora) < 0) return false;
    if (compararHoras(hora, franja.hasta_hora) >= 0) return false;
  }

  return true;
}
