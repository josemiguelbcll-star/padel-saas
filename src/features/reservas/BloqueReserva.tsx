import { cn } from '@/lib/utils';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { formatearHora } from './utils/horaUtils';

interface BloqueReservaProps {
  reserva: ReservaConTitular;
  /** Posición absoluta dentro de la columna de la cancha (px). */
  top: number;
  /** Alto del bloque (px). Ya viene clamp-ado al alto visible de la grilla. */
  height: number;
  /** Click handler: abre el DetalleReservaDialog en el padre. */
  onClick: (reserva: ReservaConTitular) => void;
}

/**
 * Bloque visual de una reserva dentro de la grilla del día.
 *
 * Diseño: tarjeta blanca con sombra sutil + barra vertical de 3px a la
 * izquierda con el color del estado (verde pagada, amarillo señada,
 * gris pendiente, azul jugada, rojo cancelada). Los tokens
 * --estado-{X} viven en globals.css; el color se aplica por inline
 * style para evitar los issues de cache del JIT de Tailwind con
 * tokens nuevos.
 *
 * Es un <button>: el click abre el DetalleReservaDialog. La posición
 * absolute hace que cubra los slots de Disponible debajo, absorbiendo
 * el click sin propagarlo.
 */
export function BloqueReserva({
  reserva,
  top,
  height,
  onClick,
}: BloqueReservaProps) {
  const titular = reserva.jugador?.nombre ?? 'Sin titular';
  const horaInicio = formatearHora(reserva.hora_inicio);
  const horaFin = formatearHora(reserva.hora_fin);
  const colorEstado = `hsl(var(--estado-${reserva.estado}))`;

  return (
    <button
      type="button"
      onClick={() => onClick(reserva)}
      aria-label={`Ver detalle: reserva de ${titular} ${horaInicio} a ${horaFin}`}
      className={cn(
        'absolute left-1 right-1 overflow-hidden text-left',
        'rounded-md border border-border bg-card',
        'shadow-sm transition-shadow hover:shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
      style={{
        top,
        height,
        borderLeftWidth: '3px',
        borderLeftColor: colorEstado,
      }}
    >
      <div className="px-2 py-1.5">
        <div className="truncate text-xs font-medium text-foreground">
          {titular}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {horaInicio}–{horaFin}
        </div>
      </div>
    </button>
  );
}
