import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatearHora } from './utils/horaUtils';

interface BloqueDisponibleProps {
  canchaId: number;
  /** 'HH:MM:SS' — hora de inicio del slot disponible. */
  hora: string;
  /**
   * Duraciones (minutos) reservables arrancando en este inicio, según la
   * franja. Se pasan al abrir el modal para que el usuario elija (cuando
   * hay más de una). El alto del bloque corresponde a la más corta.
   */
  duracionesPermitidas: number[];
  /** Posición absoluta dentro de la columna (px). */
  top: number;
  /** Alto del bloque (px). Igual a (duración más corta) / 30 * slotHeight. */
  height: number;
  onClick: (canchaId: number, hora: string, duracionesPermitidas: number[]) => void;
}

/**
 * Slot disponible para crear una reserva nueva. Por defecto discreto (borde
 * dashed tenue) para que ceda visualmente ante los bloques de color de las
 * reservas; en hover se ilumina con tinte primario + un "+" que invita al
 * click. Posiciones de `calcularDisponibles`.
 */
export function BloqueDisponible({
  canchaId,
  hora,
  duracionesPermitidas,
  top,
  height,
  onClick,
}: BloqueDisponibleProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(canchaId, hora, duracionesPermitidas)}
      aria-label={`Nueva reserva a las ${formatearHora(hora)}`}
      className={cn(
        'group absolute left-1 right-1 flex items-center justify-center gap-1 rounded-md',
        'border border-dashed border-border/60 bg-transparent',
        'transition-colors hover:border-primary/50 hover:bg-primary/[0.06]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
      )}
      style={{ top, height }}
    >
      <Plus
        className="h-3 w-3 text-muted-foreground opacity-0 transition-all group-hover:text-primary group-hover:opacity-100"
        aria-hidden="true"
      />
      <span className="text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-primary">
        Disponible
      </span>
    </button>
  );
}
