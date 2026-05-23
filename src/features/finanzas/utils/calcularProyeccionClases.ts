import type { Tarifa } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { resolverTarifa } from '@/features/reservas/utils/resolverTarifa';
import { ocurrenciasDelMes } from './ocurrenciasDelMes';
import type { ProyeccionPorOrigen } from './calcularProyeccionTurnosFijos';

/**
 * Fila mínima de clase_cobros para el cálculo.
 */
export interface CobroClaseMinimo {
  clase_id: number;
  /** YYYY-MM-DD — fecha puntual de la ocurrencia (no fecha_hora). */
  fecha: string;
  monto: number;
}

/**
 * Calcula la proyección de alquileres del mes desde clases (modelo B,
 * 0035: el alquiler se resuelve via tarifa_clase).
 *
 * Iteración por cada clase activa:
 *  - Lista ocurrencias del mes (días en `dias_semana`).
 *  - Para cada (clase_id, fecha):
 *      * Si hay cobros en clase_cobros (≥ 1 fila por 0008) →
 *        ya_cobrado += SUM(monto de esos cobros).
 *      * Si NO hay → falta_cobrar += tarifa de clase resuelta para
 *        (fecha, clase.hora_inicio).
 *
 * Garantía anti-doble-conteo: cada par (clase_id, fecha) entra una
 * sola vez.
 */
export function calcularProyeccionClases(params: {
  anio: number;
  mes: number;
  clases: ClaseConProfesor[];
  cobrosDelMes: CobroClaseMinimo[];
  tarifasClases: Tarifa[];
}): ProyeccionPorOrigen {
  const { anio, mes, clases, cobrosDelMes, tarifasClases } = params;

  // Index de cobros: clave "claseId|fecha" → suma de montos.
  // Una ocurrencia puede tener varios pagos (0008).
  const cobrosIndex = new Map<string, number>();
  for (const c of cobrosDelMes) {
    const key = `${c.clase_id}|${c.fecha}`;
    const prev = cobrosIndex.get(key) ?? 0;
    cobrosIndex.set(key, prev + (Number(c.monto) || 0));
  }

  let ya_cobrado = 0;
  let falta_cobrar = 0;

  for (const clase of clases) {
    if (!clase.activa) continue;
    const fechas = ocurrenciasDelMes({
      anio,
      mes,
      diasSemana: clase.dias_semana,
    });

    for (const fecha of fechas) {
      const key = `${clase.id}|${fecha}`;
      const cobradoEnOcurrencia = cobrosIndex.get(key);

      if (cobradoEnOcurrencia !== undefined && cobradoEnOcurrencia > 0) {
        // Hay cobro(s): cuenta como ya cobrado, no proyectamos tarifa.
        ya_cobrado += cobradoEnOcurrencia;
      } else {
        // Sin cobro: proyectamos vía tarifa de clase.
        const r = resolverTarifa({
          fecha,
          hora: clase.hora_inicio,
          tarifas: tarifasClases,
        });
        falta_cobrar += r.monto;
      }
    }
  }

  return { ya_cobrado, falta_cobrar };
}
