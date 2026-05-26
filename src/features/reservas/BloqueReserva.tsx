import { CupSoda, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import {
  estadoOperativoColorFgVar,
  estadoOperativoColorVar,
  type InfoReservaVisual,
} from './utils/derivarEstadoOperativo';
import { formatearHora } from './utils/horaUtils';

interface BloqueReservaProps {
  reserva: ReservaConTitular;
  /** Estado operativo + flags de actividad (color sólido + micro-íconos). */
  info: InfoReservaVisual;
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
 * Diseño (rediseño "color sólido"): la tarjeta entera va pintada del color
 * del ESTADO OPERATIVO (slate=reservado, verde=abierto, azul=cerrado) con
 * texto blanco, así el estado se identifica de un vistazo. Micro-íconos a la
 * derecha: $ si el turno tiene algún pago, vaso si tiene consumo cargado.
 * Hover: leve elevación + brillo. Ring sutil para separar bloques contiguos
 * del mismo color.
 *
 * Es un <button>: el click abre el DetalleReservaDialog. La posición
 * absolute cubre los slots de Disponible debajo, absorbiendo el click.
 */
export function BloqueReserva({
  reserva,
  info,
  top,
  height,
  onClick,
}: BloqueReservaProps) {
  const titular = reserva.jugador?.nombre ?? 'Sin titular';
  const horaInicio = formatearHora(reserva.hora_inicio);
  const horaFin = formatearHora(reserva.hora_fin);
  const bg = estadoOperativoColorVar(info.estado);
  const fg = estadoOperativoColorFgVar(info.estado);
  // Bloques cortos (clamp en bordes / 60' apretado): solo una línea.
  const compacto = height < 46;

  return (
    <button
      type="button"
      onClick={() => onClick(reserva)}
      aria-label={`Ver detalle: reserva de ${titular} ${horaInicio} a ${horaFin}`}
      className={cn(
        'group absolute left-1 right-1 overflow-hidden rounded-md text-left',
        'shadow-sm ring-1 ring-black/10 transition-all duration-150',
        'hover:-translate-y-px hover:shadow-md hover:brightness-110',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
      style={{ top, height, backgroundColor: bg, color: fg }}
    >
      <div
        className={cn(
          'flex h-full flex-col px-2',
          compacto ? 'justify-center py-0.5' : 'py-1.5',
        )}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="truncate text-xs font-semibold leading-tight">
            {titular}
          </span>
          {(info.tienePago || info.tieneConsumo) && (
            <span className="flex shrink-0 items-center gap-0.5 opacity-90">
              {info.tienePago && (
                <DollarSign className="h-3 w-3" aria-hidden="true" />
              )}
              {info.tieneConsumo && (
                <CupSoda className="h-3 w-3" aria-hidden="true" />
              )}
            </span>
          )}
        </div>
        {!compacto && (
          <span className="truncate text-[11px] leading-tight opacity-80">
            {horaInicio}–{horaFin} · {reserva.duracion_min} min
          </span>
        )}
      </div>
    </button>
  );
}
