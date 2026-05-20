import { cn } from '@/lib/utils';
import { formatearHora } from './utils/horaUtils';

interface BloqueDisponibleProps {
  canchaId: number;
  /** 'HH:MM:SS' — hora de inicio del slot disponible. */
  hora: string;
  /** Posición absoluta dentro de la columna (px). */
  top: number;
  /** Alto del bloque (px). Igual a duracionMin / 30 * slotHeight. */
  height: number;
  onClick: (canchaId: number, hora: string) => void;
}

/**
 * Slot disponible para crear una reserva nueva. Render como tarjeta con
 * borde dashed sutil + label "Disponible" centrado. Hover ilumina con
 * un fondo muted para invitar al click.
 *
 * Click → abre el modal de nueva reserva con la hora del slot pre-cargada.
 *
 * Cada Disponible representa UN turno concreto (90 min por default,
 * sprint 3a). Las posiciones las computa `calcularDisponibles`.
 */
export function BloqueDisponible({
  canchaId,
  hora,
  top,
  height,
  onClick,
}: BloqueDisponibleProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(canchaId, hora)}
      aria-label={`Nueva reserva a las ${formatearHora(hora)}`}
      className={cn(
        'absolute left-1 right-1 flex items-center justify-center',
        'rounded-md border border-dashed border-border bg-transparent',
        'transition-colors hover:bg-muted/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
      )}
      style={{ top, height }}
    >
      <span className="text-[11px] font-medium text-muted-foreground">
        Disponible
      </span>
    </button>
  );
}
