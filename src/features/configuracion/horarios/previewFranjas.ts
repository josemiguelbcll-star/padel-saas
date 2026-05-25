import type { FranjaTurno } from '@/types/database';
import { resolverDuraciones } from '@/features/reservas/utils/resolverDuraciones';
import { horaToMinutos, minutosToHora } from '@/features/reservas/utils/horaUtils';
import { formatearFechaISO } from '@/features/reservas/utils/fechaUtils';

/**
 * Lógica de SIMULACIÓN de la grilla para la vista previa de configuración
 * de franjas. Corre el mismo tiling dinámico que el BLOQUE 3 aplicará
 * sobre huecos reales, pero acá sobre un día VACÍO (hueco único
 * [apertura, cierre)). NO toca calcularDisponibles ni la grilla
 * operativa — es una simulación read-only para que el admin vea el
 * efecto de sus franjas antes de usarlas.
 */

export interface InicioPreview {
  /** 'HH:MM:SS' — inicio ofrecido. */
  hora: string;
  /** Duraciones ofrecidas en ese inicio (ordenadas asc). */
  duraciones: number[];
}

export interface GrupoPreview {
  /** Inicios consecutivos con el MISMO set de duraciones. */
  horas: string[];
  duraciones: number[];
}

// Sentinel: ninguna cancha real tiene id 0 (BIGSERIAL arranca en 1), así
// que resolver con canchaId=0 matchea SOLO franjas globales (cancha_id
// NULL). La config normal es global → la vista previa muestra eso.
const SENTINEL_CANCHA_GLOBAL = 0;

/**
 * Devuelve un 'YYYY-MM-DD' cuyo día de semana (ISODOW 1=lun..7=dom)
 * coincide con `isodow`. Base: 2024-01-01 fue lunes (ISODOW 1).
 * Determinístico (no depende de "hoy") → la vista previa es estable.
 */
export function fechaDeISODOW(isodow: number): string {
  const base = new Date(2024, 0, 1); // lunes, hora local
  base.setDate(base.getDate() + (isodow - 1));
  return formatearFechaISO(base);
}

/**
 * Simula los inicios que ofrecería la grilla en un día vacío para las
 * franjas dadas. Algoritmo (idéntico al diseño del BLOQUE 3):
 *   - cursor desde apertura;
 *   - en cada posición resuelve la franja aplicable (resolverDuraciones);
 *   - ofrece las duraciones que entran antes de min(cierre, fin de franja)
 *     — un turno NO cruza el borde de su franja;
 *   - avanza por la duración más corta ofrecida;
 *   - si nada entra en lo que resta de la franja, salta al fin de ésta.
 */
export function previsualizarInicios(params: {
  franjas: FranjaTurno[];
  horaApertura: string;
  horaCierre: string;
  duracionDefault: number;
  /** 'YYYY-MM-DD' — define el día de semana para resolver dias_semana. */
  fecha: string;
  canchaId?: number;
}): InicioPreview[] {
  const { franjas, horaApertura, horaCierre, duracionDefault, fecha } = params;
  const canchaId = params.canchaId ?? SENTINEL_CANCHA_GLOBAL;

  const aperturaMin = horaToMinutos(horaApertura);
  const cierreMin = horaToMinutos(horaCierre);
  if (cierreMin <= aperturaMin) return [];

  const inicios: InicioPreview[] = [];
  let cursor = aperturaMin;
  // Salvaguarda contra loop infinito (cada vuelta debe avanzar el cursor).
  let guard = 0;
  const maxIter = Math.ceil((cierreMin - aperturaMin) / 30) + 8;

  while (cursor < cierreMin && guard++ < maxIter) {
    const hora = minutosToHora(cursor);
    const { duraciones, hastaHora } = resolverDuraciones({
      fecha,
      hora,
      canchaId,
      franjas,
      duracionDefault,
    });
    const franjaHastaMin = hastaHora !== null ? horaToMinutos(hastaHora) : cierreMin;
    const limite = Math.min(cierreMin, franjaHastaMin);
    const ofrecidas = duraciones
      .filter((d) => cursor + d <= limite)
      .sort((a, b) => a - b);

    if (ofrecidas.length > 0) {
      inicios.push({ hora, duraciones: ofrecidas });
      cursor += ofrecidas[0]!; // paso = duración más corta ofrecida
    } else {
      // Nada entra desde el cursor hasta el fin de la franja → saltar.
      cursor = franjaHastaMin > cursor ? franjaHastaMin : cursor + 30;
    }
  }

  return inicios;
}

/** Agrupa inicios consecutivos con el mismo set de duraciones. */
export function agruparInicios(inicios: InicioPreview[]): GrupoPreview[] {
  const grupos: GrupoPreview[] = [];
  for (const ini of inicios) {
    const ultimo = grupos[grupos.length - 1];
    const mismaClave =
      ultimo && ultimo.duraciones.join(',') === ini.duraciones.join(',');
    if (mismaClave) {
      ultimo.horas.push(ini.hora);
    } else {
      grupos.push({ horas: [ini.hora], duraciones: [...ini.duraciones] });
    }
  }
  return grupos;
}

/**
 * ¿Hay algún tramo de [apertura, cierre) sin franja que lo cubra (en el
 * día dado)? Ahí la grilla usa la duración por defecto. Para el aviso
 * suave de configuración.
 */
export function hayHuecoSinFranja(params: {
  franjas: FranjaTurno[];
  horaApertura: string;
  horaCierre: string;
  duracionDefault: number;
  fecha: string;
  canchaId?: number;
}): boolean {
  const { franjas, horaApertura, horaCierre, duracionDefault, fecha } = params;
  const canchaId = params.canchaId ?? SENTINEL_CANCHA_GLOBAL;
  const aperturaMin = horaToMinutos(horaApertura);
  const cierreMin = horaToMinutos(horaCierre);
  if (cierreMin <= aperturaMin) return false;

  // Recorremos en pasos de 30 min: si en algún paso la resolución cae al
  // fallback (hastaHora === null y ninguna franja real aplica), hay hueco.
  for (let m = aperturaMin; m < cierreMin; m += 30) {
    const { hastaHora } = resolverDuraciones({
      fecha,
      hora: minutosToHora(m),
      canchaId,
      franjas,
      duracionDefault,
    });
    // hastaHora === null SOLO ocurre en el fallback o en una franja "toda
    // hora". Si NO hay franja "toda hora" configurada, null = fallback =
    // hueco. Distinguimos: si alguna franja sin horario aplica, no es hueco.
    if (hastaHora === null) {
      const cubrePorFranjaTodaHora = franjas.some(
        (f) =>
          f.activa &&
          f.desde_hora === null &&
          f.hasta_hora === null &&
          (f.cancha_id === null || f.cancha_id === canchaId),
      );
      if (!cubrePorFranjaTodaHora) return true;
    }
  }
  return false;
}
