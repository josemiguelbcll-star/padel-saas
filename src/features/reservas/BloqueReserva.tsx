import { AlertTriangle, CupSoda, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import type { InfoReservaVisual } from './utils/derivarEstadoOperativo';
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
  const esBloqueadoPorTorneo = reserva.observaciones?.includes('[Bloqueado por Torneo:');
  const esTurnoFijo = Boolean(reserva.turno_fijo_id);

  // Totalmente saldada: viene en info.totalmenteSaldada (calculado en ReservasPage comparando total alquiler + consumos vs pagos)
  // Fallback si no viene: si tiene precio > 0, lo pagado cubre el total y no hay consumo pendiente.
  const esTotalmenteSaldada = !esBloqueadoPorTorneo && Boolean(
    info.totalmenteSaldada ?? (reserva.monto_total > 0 && reserva.monto_pagado >= reserva.monto_total && !info.tieneConsumo),
  );

  // Colores diferenciados:
  // - Torneo: Rojo destructivo
  // - Totalmente saldada: Amarillo dorado vibrante (--turno-saldado)
  // - Cerrado: Azul marino/slate de cerrado
  // - Turno Fijo: Cobalto / Azul Zafiro (--turno-fijo)
  // - Turno al momento / suelto: Ámbar cálido / Terracota (--turno-suelto)
  const colorTipo = esTurnoFijo ? 'hsl(var(--turno-fijo))' : 'hsl(var(--turno-suelto))';
  let bg = colorTipo;
  let fg = '#ffffff';

  if (esBloqueadoPorTorneo) {
    bg = 'hsl(var(--destructive) / 0.15)';
    fg = 'hsl(var(--destructive))';
  } else if (esTotalmenteSaldada) {
    bg = 'hsl(var(--turno-saldado))';
    fg = 'hsl(var(--turno-saldado-foreground))';
  } else if (info.estado === 'cerrado') {
    bg = 'hsl(var(--estado-op-cerrado))';
    fg = 'hsl(var(--estado-op-cerrado-foreground))';
  }

  // Bloques cortos (clamp en bordes / 60' apretado): solo una línea.
  const compacto = height < 46;

  const pct = reserva.monto_total > 0
    ? Math.min(100, Math.max(0, (reserva.monto_pagado / reserva.monto_total) * 100))
    : 100;

  const buttonStyle: React.CSSProperties = {
    top,
    height: Math.max(12, height - 2),
    backgroundColor: bg,
    color: fg,
  };

  if (!esBloqueadoPorTorneo && !esTotalmenteSaldada && info.estado !== 'cerrado') {
    if (info.estado === 'abierto' && pct < 100) {
      buttonStyle.background = `linear-gradient(to right, hsl(var(--estado-op-abierto)) ${pct}%, ${colorTipo} ${pct}%)`;
    } else {
      buttonStyle.backgroundColor = colorTipo;
    }
  }

  return (
    <button
      type="button"
      onClick={() => onClick(reserva)}
      aria-label={`Ver detalle: ${esTurnoFijo ? 'Turno fijo' : 'Turno'} de ${titular} ${horaInicio} a ${horaFin}${esTotalmenteSaldada ? ' (Totalmente saldado)' : ''}`}
      className={cn(
        'group absolute left-1 right-1 overflow-hidden rounded-md text-left',
        'shadow-sm ring-1 transition-all duration-150',
        esTotalmenteSaldada ? 'ring-amber-600/40' : 'ring-black/10',
        esBloqueadoPorTorneo && 'border border-destructive',
        'hover:-translate-y-px hover:shadow-md hover:brightness-105',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
      style={buttonStyle}
    >
      <div
        className={cn(
          'flex h-full flex-col px-2',
          compacto ? 'justify-center py-0.5' : 'py-1.5',
        )}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="truncate text-xs font-semibold leading-tight flex items-center gap-1.5 min-w-0">
            {esBloqueadoPorTorneo && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
            {!esBloqueadoPorTorneo && (
              <span
                className={cn(
                  'shrink-0 rounded px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider shadow-xs',
                  esTotalmenteSaldada
                    ? 'bg-black/15 text-black ring-1 ring-black/25'
                    : 'bg-black/25 text-white ring-1 ring-white/20'
                )}
              >
                {esTurnoFijo ? 'Fijo' : 'Turno'}
              </span>
            )}
            <span className={cn('truncate', esTotalmenteSaldada && 'font-bold text-black')}>{titular}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {info.estado === 'abierto' && (
              <span
                className={cn(
                  'h-2 w-2 rounded-full animate-pulse',
                  esTotalmenteSaldada
                    ? 'bg-emerald-600 ring-1 ring-black/40'
                    : 'bg-emerald-400 ring-1 ring-white/50'
                )}
                title="En juego"
              />
            )}
            {(info.tienePago || info.tieneConsumo) && (
              <span className={cn('flex shrink-0 items-center gap-0.5', esTotalmenteSaldada ? 'text-black opacity-95' : 'opacity-90')}>
                {info.tienePago && (
                  <DollarSign className="h-3 w-3" aria-hidden="true" />
                )}
                {info.tieneConsumo && (
                  <CupSoda className="h-3 w-3" aria-hidden="true" />
                )}
              </span>
            )}
          </div>
        </div>
        {!compacto && (
          <span className={cn('truncate text-[11px] leading-tight', esTotalmenteSaldada ? 'text-black/85 font-medium' : 'opacity-85')}>
            {horaInicio}–{horaFin} · {reserva.duracion_min} min
            {esBloqueadoPorTorneo && <span className="block text-[9px] font-semibold text-destructive mt-0.5">BLOQUEADO POR TORNEO</span>}
          </span>
        )}
      </div>
    </button>
  );
}
