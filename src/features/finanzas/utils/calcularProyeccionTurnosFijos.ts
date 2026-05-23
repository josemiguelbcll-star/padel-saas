import type { Tarifa, TurnoFijo } from '@/types/database';
import { resolverTarifa } from '@/features/reservas/utils/resolverTarifa';
import { ocurrenciasDelMes } from './ocurrenciasDelMes';

/**
 * Reserva mínima necesaria para el cálculo de proyección. Conservamos
 * solo las columnas que importan para evitar acoplar a `Reserva` entera.
 */
export interface ReservaMinima {
  id: number;
  turno_fijo_id: number | null;
  fecha: string;
  estado: 'pendiente' | 'senada' | 'pagada' | 'jugada' | 'cancelada';
  monto_total: number;
  monto_pagado: number;
}

export interface ProyeccionPorOrigen {
  /** Dinero efectivamente cobrado (devengado al mes). */
  ya_cobrado: number;
  /** Dinero pendiente de cobro del mes (estimación). */
  falta_cobrar: number;
}

/**
 * Calcula la proyección de alquileres del mes desde turnos fijos.
 *
 * Iteración por cada turno fijo activo cuya vigencia toque el mes:
 *  - Lista ocurrencias del mes (días en `dia_semana` ∩ vigencia).
 *  - Para cada ocurrencia (cancha + fecha + hora_inicio del fijo):
 *      * Si hay reserva materializada con (turno_fijo_id, fecha):
 *          - estado='cancelada' → cuenta 0 (excluida).
 *          - estado='pagada'|'jugada' → ya_cobrado += monto_pagado.
 *          - estado='pendiente'|'senada' →
 *              ya_cobrado += monto_pagado;
 *              falta_cobrar += monto_total − monto_pagado.
 *      * Si NO hay reserva (no materializada) → falta_cobrar +=
 *        tarifa resuelta por (fecha, hora_inicio del fijo).
 *
 * Garantía anti-doble-conteo: cada ocurrencia se evalúa una vez. Una
 * reserva materializada NO entra en la pata de reservas sueltas (esa
 * usa `turno_fijo_id IS NULL`).
 */
export function calcularProyeccionTurnosFijos(params: {
  anio: number;
  mes: number;
  turnosFijos: TurnoFijo[];
  reservasDelMes: ReservaMinima[];
  tarifas: Tarifa[];
}): ProyeccionPorOrigen {
  const { anio, mes, turnosFijos, reservasDelMes, tarifas } = params;

  // Index de reservas materializadas: clave "tfId|fecha".
  const reservasIndex = new Map<string, ReservaMinima>();
  for (const r of reservasDelMes) {
    if (r.turno_fijo_id !== null) {
      reservasIndex.set(`${r.turno_fijo_id}|${r.fecha}`, r);
    }
  }

  let ya_cobrado = 0;
  let falta_cobrar = 0;

  for (const tf of turnosFijos) {
    if (!tf.activo) continue;
    const fechas = ocurrenciasDelMes({
      anio,
      mes,
      diasSemana: tf.dia_semana,
      fechaDesde: tf.fecha_desde,
      fechaHasta: tf.fecha_hasta,
    });

    for (const fecha of fechas) {
      const reserva = reservasIndex.get(`${tf.id}|${fecha}`);

      if (reserva) {
        // Materializada. Distinguimos por estado.
        if (reserva.estado === 'cancelada') {
          // Excluida del cálculo (decisión 2 del plan).
          continue;
        }
        const cobrado = Number(reserva.monto_pagado) || 0;
        const total = Number(reserva.monto_total) || 0;
        ya_cobrado += cobrado;
        if (reserva.estado === 'pendiente' || reserva.estado === 'senada') {
          falta_cobrar += Math.max(0, total - cobrado);
        }
      } else {
        // No materializada → proyectamos vía tarifa.
        const r = resolverTarifa({
          fecha,
          hora: tf.hora_inicio,
          tarifas,
        });
        falta_cobrar += r.monto;
      }
    }
  }

  return { ya_cobrado, falta_cobrar };
}

/**
 * Calcula el aporte de las reservas SUELTAS del mes (las que no vienen
 * de un turno fijo). Iteración directa sobre las filas con
 * `turno_fijo_id IS NULL`, excluyendo canceladas.
 *
 * No hay "ocurrencias no materializadas" acá — las reservas sueltas
 * existen o no existen. No se proyectan a futuro.
 */
export function calcularProyeccionReservasSueltas(
  reservasDelMes: ReservaMinima[],
): ProyeccionPorOrigen {
  let ya_cobrado = 0;
  let falta_cobrar = 0;

  for (const r of reservasDelMes) {
    if (r.turno_fijo_id !== null) continue; // ese se contó en turnos fijos
    if (r.estado === 'cancelada') continue;
    const cobrado = Number(r.monto_pagado) || 0;
    const total = Number(r.monto_total) || 0;
    ya_cobrado += cobrado;
    if (r.estado === 'pendiente' || r.estado === 'senada') {
      falta_cobrar += Math.max(0, total - cobrado);
    }
  }

  return { ya_cobrado, falta_cobrar };
}
