import { cn } from '@/lib/utils';
import type { EstadoReserva } from '@/types/database';
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
 * El color de fondo refleja el estado via tokens del Sprint 1
 * (--estado-{pendiente,senada,pagada,jugada,cancelada}). Cambiar esos
 * tokens en globals.css reskinea automáticamente los bloques.
 *
 * Es un <button> que dispara `onClick(reserva)`. Como se posiciona
 * absolute encima de los slots vacíos, el click acá no llega al slot
 * debajo (no abre el modal de nueva reserva).
 */
export function BloqueReserva({
  reserva,
  top,
  height,
  onClick,
}: BloqueReservaProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(reserva)}
      aria-label={`Ver detalle: reserva de ${reserva.jugador?.nombre ?? 'sin titular'} ${formatearHora(reserva.hora_inicio)} a ${formatearHora(reserva.hora_fin)}`}
      className={cn(
        'absolute left-1 right-1 overflow-hidden rounded-md border border-black/10 px-2 py-1 text-left',
        'shadow-sm transition-shadow hover:shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        estadoClasses(reserva.estado),
      )}
      style={{ top, height }}
    >
      <div className="truncate text-xs font-medium">
        {reserva.jugador?.nombre ?? 'Sin titular'}
      </div>
      <div className="truncate text-[10px] opacity-90">
        {formatearHora(reserva.hora_inicio)}–{formatearHora(reserva.hora_fin)}
      </div>
    </button>
  );
}

function estadoClasses(estado: EstadoReserva): string {
  // Clases completas (no concatenadas en tiempo de ejecución) para que el
  // JIT de Tailwind las detecte y las incluya en el build.
  switch (estado) {
    case 'pendiente':
      return 'bg-estado-pendiente text-estado-pendiente-foreground';
    case 'senada':
      return 'bg-estado-senada text-estado-senada-foreground';
    case 'pagada':
      return 'bg-estado-pagada text-estado-pagada-foreground';
    case 'jugada':
      return 'bg-estado-jugada text-estado-jugada-foreground';
    case 'cancelada':
      return 'bg-estado-cancelada text-estado-cancelada-foreground';
  }
}
