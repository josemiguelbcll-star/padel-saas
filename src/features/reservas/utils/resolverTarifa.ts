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

interface ResolverTarifaParams {
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
}

export function resolverTarifa(params: ResolverTarifaParams): TarifaResuelta {
  const { fecha, hora, tarifas, duracion, cantidad_alumnos } = params;
  const diaSemana = diaSemanaDe(fecha);

  // 1. Filtrar tarifas activas que aplican a fecha, día, hora y alumnos
  const activasEnFranja = tarifas.filter((t) =>
    tarifaAplicaFranja(t, fecha, diaSemana, hora, cantidad_alumnos),
  );

  if (activasEnFranja.length === 0) {
    return { tarifa: null, monto: 0 };
  }

  // 2. Intentar buscar coincidencia con filtro de duración (exacta o NULL)
  const aplicablesDuracion = activasEnFranja.filter(
    (t) =>
      duracion === undefined ||
      t.duracion_min === null ||
      t.duracion_min === duracion,
  );

  const listaParaOrdenar =
    aplicablesDuracion.length > 0 ? aplicablesDuracion : activasEnFranja;

  const ordenadas = [...listaParaOrdenar].sort((a, b) => {
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
  
  // Si la tarifa tiene una duración fija diferente a la requerida, calculamos el proporcional
  let montoCalculado = elegida.monto;
  if (
    duracion !== undefined &&
    elegida.duracion_min !== null &&
    elegida.duracion_min !== duracion &&
    elegida.duracion_min > 0
  ) {
    montoCalculado = Math.round(
      (elegida.monto / elegida.duracion_min) * duracion,
    );
  }

  return { tarifa: elegida, monto: montoCalculado };
}

function tarifaAplicaFranja(
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
