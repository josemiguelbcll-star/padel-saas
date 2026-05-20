import type { Tarifa } from '@/types/database';
import { diaSemanaDe } from './fechaUtils';
import { compararHoras } from './horaUtils';

/**
 * Decide qué tarifa aplica a un slot dado y el monto sugerido.
 *
 * Regla de resolución:
 *   1. Filtra tarifas activas que aplican:
 *      - dias_semana incluye el día  OR  dias_semana IS NULL
 *      - hora dentro de [desde_hora, hasta_hora)  OR  ambas NULL
 *   2. Ordena por prioridad DESC, luego id DESC.
 *   3. Devuelve la primera.
 *   4. Si no hay tarifa aplicable, devuelve { tarifa: null, monto: 0 }.
 *      Es la señal para que el vendedor complete el monto a mano.
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
}

export function resolverTarifa(params: ResolverTarifaParams): TarifaResuelta {
  const { fecha, hora, tarifas } = params;
  const diaSemana = diaSemanaDe(fecha);

  const aplicables = tarifas.filter((t) => tarifaAplicaA(t, diaSemana, hora));

  if (aplicables.length === 0) {
    return { tarifa: null, monto: 0 };
  }

  const ordenadas = [...aplicables].sort((a, b) => {
    if (a.prioridad !== b.prioridad) return b.prioridad - a.prioridad;
    return b.id - a.id;
  });

  const elegida = ordenadas[0]!;
  return { tarifa: elegida, monto: elegida.monto };
}

function tarifaAplicaA(
  tarifa: Tarifa,
  diaSemana: number,
  hora: string,
): boolean {
  if (!tarifa.activa) return false;

  if (tarifa.dias_semana !== null && !tarifa.dias_semana.includes(diaSemana)) {
    return false;
  }

  if (tarifa.desde_hora !== null && tarifa.hasta_hora !== null) {
    if (compararHoras(hora, tarifa.desde_hora) < 0) return false;
    if (compararHoras(hora, tarifa.hasta_hora) >= 0) return false;
  }

  return true;
}
