import { useMemo } from 'react';
import type { Cancha, ClaseCobro } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { BloqueClase } from './BloqueClase';
import { BloqueDisponible } from './BloqueDisponible';
import { BloqueReserva } from './BloqueReserva';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { calcularDisponibles } from './utils/disponibilidad';
import { normalizarHora } from './utils/horaUtils';

interface CanchaColumnaProps {
  cancha: Cancha;
  /** Slots del día como strings 'HH:MM:SS' (granularidad 30 min). Usados para
   *  calcular posiciones absolute via slots.indexOf(...). */
  slots: string[];
  /** Alto de cada slot en pixeles. */
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
  /** Hora de apertura del club, para calcular disponibles. */
  horaApertura: string;
  /** Hora de cierre del club, para calcular disponibles. */
  horaCierre: string;
  /** Callback al clickear un Disponible. */
  onSlotClick: (canchaId: number, hora: string) => void;
  /** Callback al clickear un bloque de reserva existente. */
  onReservaClick: (reserva: ReservaConTitular) => void;
  /** Callback al clickear un bloque de clase. */
  onClaseClick: (clase: ClaseConProfesor) => void;
}

/**
 * Una columna de la grilla = una cancha.
 *
 * Layout: alto explícito = slots.length * slotHeight, fondo `bg-muted/30`
 * sutil para separarla visualmente de las vecinas sin necesidad de bordes.
 * Todo el contenido va en absolute.
 *
 * Capas (de fondo a frente):
 *   1. Bloques "Disponible" (turnos de 90 min libres, tileados desde el
 *      inicio de cada hueco). Clickeables → abren NuevaReservaDialog.
 *   2. Bloques de clase. Clickeables → abren DetalleClaseDialog. Cubren
 *      los Disponibles que se solaparían con la clase, absorbiendo el
 *      click sin propagarlo a la capa de Disponibles debajo.
 *   3. Bloques de reserva. Clickeables → abren DetalleReservaDialog.
 *
 * Por construcción del algoritmo `calcularDisponibles`, los Disponibles
 * jamás se solapan con reservas ni clases — así no hay double-render
 * visual en las áreas ocupadas.
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
  onSlotClick,
  onReservaClick,
  onClaseClick,
}: CanchaColumnaProps) {
  const totalHeight = slots.length * slotHeight;

  const disponibles = useMemo(
    () =>
      calcularDisponibles({
        reservas,
        clases,
        horaApertura,
        horaCierre,
      }),
    [reservas, clases, horaApertura, horaCierre],
  );

  return (
    <div
      className="relative shrink-0 bg-muted/30"
      style={{ width, height: totalHeight }}
      role="group"
      aria-label={`Cancha ${cancha.nombre}`}
    >
      {/* Capa 1: Disponibles (turnos libres de 90 min) */}
      {disponibles.map((d) => {
        const startIdx = slots.indexOf(normalizarHora(d.hora));
        if (startIdx === -1) return null;
        const numSlots = d.duracionMin / 30;
        const top = startIdx * slotHeight;
        const height = numSlots * slotHeight;
        return (
          <BloqueDisponible
            key={`disp-${d.hora}`}
            canchaId={cancha.id}
            hora={d.hora}
            top={top}
            height={height}
            onClick={onSlotClick}
          />
        );
      })}

      {/* Capa 2: bloques de clase (clickeables) */}
      {clases.map((c) => {
        const startIdx = slots.indexOf(normalizarHora(c.hora_inicio));
        if (startIdx === -1) return null;
        const numSlotsClase = c.duracion_min / 30;
        const slotsRestantes = slots.length - startIdx;
        const slotsRender = Math.min(numSlotsClase, slotsRestantes);
        const top = startIdx * slotHeight;
        const height = slotsRender * slotHeight;
        return (
          <BloqueClase
            key={c.id}
            clase={c}
            pagado={(cobrosPorClase.get(c.id) ?? []).length > 0}
            top={top}
            height={height}
            onClick={onClaseClick}
          />
        );
      })}

      {/* Capa 3: bloques de reserva */}
      {reservas.map((r) => {
        const startIdx = slots.indexOf(normalizarHora(r.hora_inicio));
        if (startIdx === -1) return null;
        const numSlotsReserva = r.duracion_min / 30;
        const slotsRestantes = slots.length - startIdx;
        const slotsRender = Math.min(numSlotsReserva, slotsRestantes);
        const top = startIdx * slotHeight;
        const height = slotsRender * slotHeight;
        return (
          <BloqueReserva
            key={r.id}
            reserva={r}
            top={top}
            height={height}
            onClick={onReservaClick}
          />
        );
      })}
    </div>
  );
}
