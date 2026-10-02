import { Check, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { formatearHora, sumarMinutos } from './utils/horaUtils';

interface BloqueClaseProps {
  clase: ClaseConProfesor;
  /**
   * True si la ocurrencia (clase × fecha mostrada) tiene al menos un
   * pago registrado. Sin distinguir cuántos: un pago = tilde.
   */
  pagado: boolean;
  /** True si el costo total esperado de la clase está 100% cobrado. */
  totalmenteSaldada?: boolean;
  /** Posición absoluta dentro de la columna de la cancha (px). */
  top: number;
  /** Alto del bloque (px). Ya viene clamp-ado al alto visible de la grilla. */
  height: number;
  /** Click handler: abre el DetalleClaseDialog en el padre. */
  onClick: (clase: ClaseConProfesor) => void;
}

/**
 * Bloque visual de una clase dentro de la grilla del día.
 *
 * Diseño: tarjeta entera en VIOLETA (token --clase) o AMARILLO DORADO
 * (--turno-saldado) si está totalmente saldada.
 */
export function BloqueClase({
  clase,
  pagado,
  totalmenteSaldada = false,
  top,
  height,
  onClick,
}: BloqueClaseProps) {
  const profesorNombre = clase.profesor?.nombre ?? 'Sin profesor';
  const titulo = clase.nombre ?? `Clase · ${profesorNombre}`;
  const horaInicio = formatearHora(clase.hora_inicio);
  const horaFin = formatearHora(
    sumarMinutos(clase.hora_inicio, clase.duracion_min),
  );
  const compacto = height < 46;

  const bg = totalmenteSaldada ? 'hsl(var(--turno-saldado))' : 'hsl(var(--clase))';
  const fg = totalmenteSaldada ? 'hsl(var(--turno-saldado-foreground))' : 'hsl(var(--clase-foreground))';

  return (
    <button
      type="button"
      onClick={() => onClick(clase)}
      aria-label={`Ver detalle: ${titulo}, ${horaInicio} a ${horaFin}${totalmenteSaldada ? ' (Totalmente saldada)' : pagado ? ' (Con pagos)' : ' (Impaga)'}`}
      className={cn(
        'group absolute left-1 right-1 overflow-hidden rounded-md text-left',
        'shadow-sm ring-1 transition-all duration-150',
        totalmenteSaldada ? 'ring-amber-600/40' : 'ring-black/10',
        'hover:-translate-y-px hover:shadow-md hover:brightness-105',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
      style={{
        top,
        height: Math.max(12, height - 2),
        backgroundColor: bg,
        color: fg,
      }}
    >
      <div
        className={cn(
          'flex h-full flex-col px-2',
          compacto ? 'justify-center py-0.5' : 'py-1.5',
        )}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <GraduationCap className={cn("h-3 w-3 shrink-0", totalmenteSaldada && "text-black")} aria-hidden="true" />
            <span className={cn("truncate text-xs font-semibold leading-tight", totalmenteSaldada && "text-black font-bold")}>
              {titulo}
            </span>
          </span>
          {(totalmenteSaldada || pagado) && (
            <Check className={cn("h-3.5 w-3.5 shrink-0", totalmenteSaldada ? "text-black font-bold opacity-100" : "opacity-90")} aria-hidden="true" />
          )}
        </div>
        {!compacto && (
          <span className={cn("truncate text-[11px] leading-tight", totalmenteSaldada ? "text-black/85 font-medium" : "opacity-80")}>
            {horaInicio}–{horaFin}
          </span>
        )}
      </div>
    </button>
  );
}
