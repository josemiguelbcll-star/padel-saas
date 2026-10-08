import type { Tarifa } from '@/types/database';
import { diaSemanaDe } from './fechaUtils';
import { compararHoras } from './horaUtils';

/**
 * Decide qué tarifa aplica a un slot dado y el monto sugerido.
 *
 * Regla de resolución:
 *   1. Filtra tarifas activas que aplican:
 *      - VIGENCIA TEMPORAL (0029): la fecha del slot cae en
 *        [vigente_desde, vigente_hasta]
 *      - dias_semana incluye el día  OR  dias_semana IS NULL
 *      - hora dentro de [desde_hora, hasta_hora)  OR  ambas NULL
 *      - DURACIÓN (0051): duracion_min NULL aplica a cualquiera;
 *        si se pasa `duracion`, la tarifa aplica si su duracion_min es
 *        NULL o == duracion.
 *   2. Ordena: duración ESPECÍFICA gana sobre NULL (solo cuando hay
 *      `duracion` objetivo), luego prioridad DESC, luego id DESC.
 *   3. Devuelve la primera.
 *   4. Si no hay tarifa aplicable, devuelve { tarifa: null, monto: 0 }.
 *      Es la señal para que el vendedor complete el monto a mano.
 *
 * Espejo client-side de fn_resolver_tarifa server-side (0029/0051). Ambos
 * algoritmos deben mantenerse en sintonía.
 *
 * `duracion` es OPCIONAL: si no se pasa (flujos de clases que no la
 * tienen), no se filtra por duración y el orden es prioridad/id —
 * comportamiento previo a la 2D.
 *
 * Nota: tarifas NO tienen cancha_id (a diferencia de franjas). Aplican
 * a todo el club; la dimensión cancha-específica del modelo está en
 * franjas, no en tarifas.
 */

export interface TarifaResuelta {
  /** La tarifa elegida, o null si ninguna aplicó. */
  tarifa: Tarifa | null;
  /** Monto sugerido para el slot. 0 si no hay tarifa que aplique. */
  monto: number;
}

export interface ResolverTarifaParams {
  /** 'YYYY-MM-DD' */
  fecha: string;
  /** 'HH:MM' o 'HH:MM:SS' — hora de inicio del slot */
  hora: string;
  tarifas: Tarifa[];
  /**
   * Duración (minutos) del turno. Opcional: si no se pasa, no se filtra
   * por duración (comportamiento previo a la 2D). Cuando se pasa, las
   * tarifas con duración específica ganan sobre las de "cualquier
   * duración" (duracion_min NULL).
   */
  duracion?: number;
  /**
   * Cantidad de alumnos. Opcional: solo aplica para tarifas de clases.
   */
  cantidad_alumnos?: number;
  /**
   * Tarifa fija asignada a la cancha (opcional). Si existe y está activa,
   * se prioriza esta tarifa sobre la resolución general por horario.
   */
  tarifaId?: number | null;
}

export function resolverTarifa(params: ResolverTarifaParams): TarifaResuelta {
  const { fecha, hora, tarifas, duracion, cantidad_alumnos, tarifaId } = params;

  // 0. Si la cancha tiene una tarifa asignada específica
  if (tarifaId) {
    const tarifaFija = tarifas.find(
      (t) => (t.id === tarifaId || t.lineage_id === tarifaId) && t.activa,
    );
    if (tarifaFija) {
      return { tarifa: tarifaFija, monto: tarifaFija.monto };
    }
  }

  const diaSemana = diaSemanaDe(fecha);

  // 1. Filtrar tarifas activas que aplican a fecha, día, hora y alumnos
  const activasEnFranja = tarifas.filter((t) =>
    tarifaAplicaFranja(t, fecha, diaSemana, hora, cantidad_alumnos),
  );

  if (activasEnFranja.length === 0) {
    return { tarifa: null, monto: 0 };
  }

  // 2. Coincidencia con filtro de duración (exacta o NULL = cualquier duración)
  // No inventar ni calcular proporcionales: solo tarifas que correspondan
  const aplicablesDuracion = activasEnFranja.filter(
    (t) =>
      duracion === undefined ||
      t.duracion_min === null ||
      t.duracion_min === duracion,
  );

  if (aplicablesDuracion.length === 0) {
    return { tarifa: null, monto: 0 };
  }

  const ordenadas = [...aplicablesDuracion].sort((a, b) => {
    // Exact match de duración primero
    const aExact =
      duracion !== undefined && a.duracion_min === duracion ? 1 : 0;
    const bExact =
      duracion !== undefined && b.duracion_min === duracion ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    // Duración genérica (NULL) segundo
    const aGen = a.duracion_min === null ? 1 : 0;
    const bGen = b.duracion_min === null ? 1 : 0;
    if (aGen !== bGen) return bGen - aGen;

    // Prioridad
    if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
    return b.id - a.id;
  });

  const elegida = ordenadas[0]!;
  return { tarifa: elegida, monto: elegida.monto };
}

export interface FranjasDisponiblesParams {
  tarifas: Tarifa[];
  fecha: string;
  hora: string;
  duracion?: number;
}

/**
 * Devuelve las franjas horarias ACTIVAS y VIGENTES para un turno (fecha, hora, duración).
 * - Excluye franjas inactivas.
 * - Toma únicamente la versión vigente en `fecha` para cada linaje (evita duplicar historial).
 * - No calcula proporcionales ficticios: solo toma tarifas que coincidan con la duración o apliquen a cualquier duración.
 */
export function obtenerFranjasDisponibles({
  tarifas,
  fecha,
  hora,
  duracion,
}: FranjasDisponiblesParams): Tarifa[] {
  // 1. Filtrar solo las vigentes y activas, deduplicando por linaje
  const porLinaje = new Map<number, Tarifa>();
  for (const t of (tarifas ?? [])) {
    if (!t.activa) continue;
    if (t.vigente_desde > fecha) continue;
    if (t.vigente_hasta !== null && t.vigente_hasta < fecha) continue;

    const existing = porLinaje.get(t.lineage_id);
    if (!existing || t.vigente_desde > existing.vigente_desde) {
      porLinaje.set(t.lineage_id, t);
    }
  }

  const vigentesActivas = Array.from(porLinaje.values());
  const diaSemana = diaSemanaDe(fecha);

  // 2. Franjas que coinciden con horario, día y duración (o cualquier duración)
  const queAplican = vigentesActivas.filter((t) => {
    if (duracion !== undefined && t.duracion_min !== null && t.duracion_min !== duracion) {
      return false;
    }
    return tarifaAplicaFranja(t, fecha, diaSemana, hora, undefined);
  });

  // Si hay franjas que aplican al horario/día/duración, mostramos esas.
  // Si no hay ninguna específica para la hora, mostramos las franjas activas vigentes para esa duración.
  const candidatas =
    queAplican.length > 0
      ? queAplican
      : vigentesActivas.filter(
          (t) => duracion === undefined || t.duracion_min === null || t.duracion_min === duracion,
        );

  return candidatas.sort((a, b) => {
    const aExact = duracion !== undefined && a.duracion_min === duracion ? 1 : 0;
    const bExact = duracion !== undefined && b.duracion_min === duracion ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
    return a.nombre.localeCompare(b.nombre);
  });
}

export function tarifaAplicaFranja(
  tarifa: Tarifa,
  fechaISO: string,
  diaSemana: number,
  hora: string,
  cantidad_alumnos: number | undefined,
): boolean {
  if (!tarifa.activa) return false;

  // Vigencia temporal (0029): comparación lexicográfica de strings ISO
  // 'YYYY-MM-DD' equivale a comparación cronológica.
  if (tarifa.vigente_desde > fechaISO) return false;
  if (tarifa.vigente_hasta !== null && tarifa.vigente_hasta < fechaISO) {
    return false;
  }

  if (tarifa.dias_semana !== null && !tarifa.dias_semana.includes(diaSemana)) {
    return false;
  }

  if (tarifa.desde_hora !== null && tarifa.hasta_hora !== null) {
    const hastaNorm =
      tarifa.hasta_hora === '00:00' || tarifa.hasta_hora === '00:00:00'
        ? '24:00:00'
        : tarifa.hasta_hora;
    if (compararHoras(hora, tarifa.desde_hora) < 0) return false;
    if (compararHoras(hora, hastaNorm) >= 0) return false;
  }

  // Tarifas de Clases escalonadas (0096)
  if (cantidad_alumnos !== undefined) {
    const minAlumnos = (tarifa as any).min_alumnos ?? 1;
    const maxAlumnos = (tarifa as any).max_alumnos ?? null;
    if (cantidad_alumnos < minAlumnos) return false;
    if (maxAlumnos !== null && cantidad_alumnos > maxAlumnos) return false;
  }

  return true;
}
