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
}

export function resolverTarifa(params: ResolverTarifaParams): TarifaResuelta {
  const { fecha, hora, tarifas, duracion } = params;
  const diaSemana = diaSemanaDe(fecha);

  const aplicables = tarifas.filter((t) =>
    tarifaAplicaA(t, fecha, diaSemana, hora, duracion),
  );

  if (aplicables.length === 0) {
    return { tarifa: null, monto: 0 };
  }

  const ordenadas = [...aplicables].sort((a, b) => {
    // Duración específica gana sobre NULL (solo si hay duración objetivo),
    // igual que el ORDER BY del SQL.
    const aEsp = duracion !== undefined && a.duracion_min !== null ? 1 : 0;
    const bEsp = duracion !== undefined && b.duracion_min !== null ? 1 : 0;
    if (aEsp !== bEsp) return bEsp - aEsp;
    if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
    return b.id - a.id;
  });

  const elegida = ordenadas[0]!;
  return { tarifa: elegida, monto: elegida.monto };
}

function tarifaAplicaA(
  tarifa: Tarifa,
  fechaISO: string,
  diaSemana: number,
  hora: string,
  duracion: number | undefined,
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
    if (compararHoras(hora, tarifa.desde_hora) < 0) return false;
    if (compararHoras(hora, tarifa.hasta_hora) >= 0) return false;
  }

  // Duración (0051): se excluye solo si hay duración objetivo Y la tarifa
  // es de una duración específica distinta. (NULL = cualquier duración.)
  if (
    duracion !== undefined &&
    tarifa.duracion_min !== null &&
    tarifa.duracion_min !== duracion
  ) {
    return false;
  }

  return true;
}
