import type { Cancha } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { BloqueClase } from './BloqueClase';
import { BloqueReserva } from './BloqueReserva';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { formatearHora, normalizarHora } from './utils/horaUtils';

interface CanchaColumnaProps {
  cancha: Cancha;
  /** Slots del día como strings 'HH:MM:SS' (granularidad 30 min). */
  slots: string[];
  /** Alto de cada slot en pixeles. */
  slotHeight: number;
  /** Reservas (no canceladas) que pertenecen a esta cancha. */
  reservas: ReservaConTitular[];
  /** Clases activas que aplican a esta cancha en el día mostrado. */
  clases: ClaseConProfesor[];
  /** Ancho de la columna en pixeles. */
  width: number;
  /** Callback al clickear un slot vacío. */
  onSlotClick: (canchaId: number, hora: string) => void;
  /** Callback al clickear un bloque de reserva existente. */
  onReservaClick: (reserva: ReservaConTitular) => void;
}

/**
 * Una columna de la grilla = una cancha.
 *
 * Renderiza tres capas (en orden DOM, lo que da el orden visual de
 * abajo hacia arriba):
 *
 *   1. Slots vacíos (background grid, botones clickeables).
 *   2. Bloques de clase (display-only). Posicionados absolute, interceptan
 *      el click sobre su área visible y NO abren el modal de reserva.
 *   3. Bloques de reserva. También absolute, clickeables (su click va a
 *      abrir el detalle en el bloque 7 de esta secuencia).
 *
 * Tanto las clases como las reservas se clamp-an verticalmente si se
 * extienden más allá de hora_cierre del club (datos legacy o ajustes
 * posteriores). Las clases que arrancan FUERA del grid (antes de
 * hora_apertura) se omiten.
 */
export function CanchaColumna({
  cancha,
  slots,
  slotHeight,
  reservas,
  clases,
  width,
  onSlotClick,
  onReservaClick,
}: CanchaColumnaProps) {
  return (
    <div
      className="relative shrink-0 border-l border-border"
      style={{ width }}
      role="group"
      aria-label={`Cancha ${cancha.nombre}`}
    >
      {/* Capa 1: slots vacíos clickeables */}
      {slots.map((slot) => (
        <button
          key={slot}
          type="button"
          onClick={() => onSlotClick(cancha.id, slot)}
          aria-label={`Nueva reserva en ${cancha.nombre} a las ${formatearHora(slot)}`}
          className="block w-full border-t border-border transition-colors hover:bg-accent/40 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          style={{ height: slotHeight }}
        />
      ))}

      {/* Capa 2: bloques de clase (display-only) */}
      {clases.map((c) => {
        const startIdx = slots.indexOf(normalizarHora(c.hora_inicio));
        if (startIdx === -1) return null;
        const numSlotsClase = c.duracion_min / 30;
        const slotsRestantes = slots.length - startIdx;
        const slotsRender = Math.min(numSlotsClase, slotsRestantes);
        const top = startIdx * slotHeight;
        const height = slotsRender * slotHeight;
        return (
          <BloqueClase key={c.id} clase={c} top={top} height={height} />
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
