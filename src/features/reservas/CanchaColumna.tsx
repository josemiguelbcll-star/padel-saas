import { useMemo } from 'react';
import type { Cancha, ClaseCobro, FranjaTurno } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { BloqueClase } from './BloqueClase';
import { BloqueDisponible } from './BloqueDisponible';
import { BloqueReserva } from './BloqueReserva';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { calcularDisponibles } from './utils/disponibilidad';
import { horaToMinutos } from './utils/horaUtils';

interface CanchaColumnaProps {
  cancha: Cancha;
  /** Slots del día como strings 'HH:MM:SS' (granularidad 30 min). Solo se
   *  usan para el alto total de la columna (alineación con el eje de horas
   *  de GrillaDia). El posicionamiento de bloques es por minutos. */
  slots: string[];
  /** Alto de cada slot de 30 min en pixeles. */
  slotHeight: number;
  /** Reservas (no canceladas) que pertenecen a esta cancha. */
  reservas: ReservaConTitular[];
  /** Clases activas que aplican a esta cancha en el día mostrado. */
  clases: ClaseConProfesor[];
  /**
   * Pagos de cada clase para la fecha mostrada, indexados por clase_id.
   * Una ocurrencia puede tener 0/1/N pagos (desde la 0008). El tilde
   * "Pagada" en el bloque aparece si la lista correspondiente tiene
   * al menos un elemento; el detalle/total vive en el dialog.
   */
  cobrosPorClase: Map<number, ClaseCobro[]>;
  /** Ancho de la columna en pixeles. */
  width: number;
  /** Hora de apertura del club, para calcular disponibles + posicionar. */
  horaApertura: string;
  /** Hora de cierre del club, para calcular disponibles + posicionar. */
  horaCierre: string;
  /** Fecha del día ('YYYY-MM-DD') — para resolver franjas por día. */
  fecha: string;
  /** Franjas de turno del club (duraciones por franja). */
  franjas: FranjaTurno[];
  /** Duración por defecto del club (fallback sin franja). */
  duracionDefault: number;
  /** Callback al clickear un Disponible (con las duraciones que la franja permite ahí). */
  onSlotClick: (canchaId: number, hora: string, duracionesPermitidas: number[]) => void;
  /** Callback al clickear un bloque de reserva existente. */
  onReservaClick: (reserva: ReservaConTitular) => void;
  /** Callback al clickear un bloque de clase. */
  onClaseClick: (clase: ClaseConProfesor) => void;
}

/**
 * Una columna de la grilla = una cancha.
 *
 * Layout: alto explícito = slots.length * slotHeight (alineado con el eje
 * de horas), fondo `bg-muted/30` sutil. Todo el contenido va en absolute.
 *
 * ⭐ Posicionamiento POR MINUTOS desde la apertura (fix de layout): todos
 * los bloques (disponibles, clases, reservas) usan la MISMA base —
 *   top    = (minutos desde apertura) * (slotHeight / 30)
 *   height = (duración en minutos)     * (slotHeight / 30)
 * — en vez del viejo slots.indexOf(hora), que desalineaba bloques cuyo
 * inicio no caía exacto en un slot de 30 min.
 *
 * Capas (de fondo a frente):
 *   1. Bloques "Disponible" (inicios flexibles por franja). Clickeables.
 *   2. Bloques de clase. Clickeables. Cubren los Disponibles que se
 *      solaparían (por construcción de calcularDisponibles no hay solape).
 *   3. Bloques de reserva. Clickeables.
 */
export function CanchaColumna({
  cancha,
  slots,
  slotHeight,
  reservas,
  clases,
  cobrosPorClase,
  width,
  horaApertura,
  horaCierre,
  fecha,
  franjas,
  duracionDefault,
  onSlotClick,
  onReservaClick,
  onClaseClick,
}: CanchaColumnaProps) {
  const aperturaMin = horaToMinutos(horaApertura);
  const cierreMin = horaToMinutos(horaCierre);
  const pxPorMin = slotHeight / 30;
  const totalHeight = slots.length * slotHeight;

  /**
   * Posición absoluta de un bloque por minutos desde la apertura.
   * Clampa a la ventana visible [apertura, cierre); devuelve null si el
   * bloque queda completamente fuera.
   */
  function posicionar(
    horaInicio: string,
    duracionMin: number,
  ): { top: number; height: number } | null {
    const startMin = horaToMinutos(horaInicio);
    const endMin = startMin + duracionMin;
    if (endMin <= aperturaMin || startMin >= cierreMin) return null;
    const visStart = Math.max(startMin, aperturaMin);
    const visEnd = Math.min(endMin, cierreMin);
    return {
      top: (visStart - aperturaMin) * pxPorMin,
      height: (visEnd - visStart) * pxPorMin,
    };
  }

  const disponibles = useMemo(
    () =>
      calcularDisponibles({
        reservas,
        clases,
        horaApertura,
        horaCierre,
        fecha,
        canchaId: cancha.id,
        franjas,
        duracionDefault,
      }),
    [reservas, clases, horaApertura, horaCierre, fecha, cancha.id, franjas, duracionDefault],
  );

  return (
    <div
      className="relative shrink-0 bg-muted/30"
      style={{ width, height: totalHeight }}
      role="group"
      aria-label={`Cancha ${cancha.nombre}`}
    >
      {/* Capa 1: Disponibles. Altura = duración más corta ofrecida (las
          duraciones más largas se eligen al reservar — PARTE C). */}
      {disponibles.map((d) => {
        const pos = posicionar(d.hora, d.duracionesPermitidas[0]!);
        if (!pos) return null;
        return (
          <BloqueDisponible
            key={`disp-${d.hora}`}
            canchaId={cancha.id}
            hora={d.hora}
            duracionesPermitidas={d.duracionesPermitidas}
            top={pos.top}
            height={pos.height}
            onClick={onSlotClick}
          />
        );
      })}

      {/* Capa 2: bloques de clase (clickeables) */}
      {clases.map((c) => {
        const pos = posicionar(c.hora_inicio, c.duracion_min);
        if (!pos) return null;
        return (
          <BloqueClase
            key={c.id}
            clase={c}
            pagado={(cobrosPorClase.get(c.id) ?? []).length > 0}
            top={pos.top}
            height={pos.height}
            onClick={onClaseClick}
          />
        );
      })}

      {/* Capa 3: bloques de reserva */}
      {reservas.map((r) => {
        const pos = posicionar(r.hora_inicio, r.duracion_min);
        if (!pos) return null;
        return (
          <BloqueReserva
            key={r.id}
            reserva={r}
            top={pos.top}
            height={pos.height}
            onClick={onReservaClick}
          />
        );
      })}
    </div>
  );
}
