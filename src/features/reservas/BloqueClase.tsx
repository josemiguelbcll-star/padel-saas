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
 * Diseño cohesivo con el rediseño "color sólido": tarjeta entera en VIOLETA
 * (token --clase) con texto blanco + birrete, distinta de los estados de
 * reserva. Si la ocurrencia ya está cobrada, un tilde a la derecha. Hover:
 * leve elevación + brillo. El click abre el DetalleClaseDialog.
 */
export function BloqueClase({
  clase,
  pagado,
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

  return (
    <button
      type="button"
      onClick={() => onClick(clase)}
      aria-label={`Ver detalle: ${titulo}, ${horaInicio} a ${horaFin}${pagado ? ', pagada' : ', impaga'}`}
      className={cn(
        'group absolute left-1 right-1 overflow-hidden rounded-md text-left',
        'shadow-sm ring-1 ring-black/10 transition-all duration-150',
        'hover:-translate-y-px hover:shadow-md hover:brightness-110',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
      style={{
        top,
        height,
        backgroundColor: 'hsl(var(--clase))',
        color: 'hsl(var(--clase-foreground))',
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
            <GraduationCap className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate text-xs font-semibold leading-tight">
              {titulo}
            </span>
          </span>
          {pagado && (
            <Check className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden="true" />
          )}
        </div>
        {!compacto && (
          <span className="truncate text-[11px] leading-tight opacity-80">
            {horaInicio}–{horaFin}
          </span>
        )}
      </div>
    </button>
  );
}
