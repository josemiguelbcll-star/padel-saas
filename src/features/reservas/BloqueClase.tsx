import { Check, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { formatearHora, sumarMinutos } from './utils/horaUtils';

interface BloqueClaseProps {
  clase: ClaseConProfesor;
  /**
   * True si la ocurrencia (clase × fecha mostrada) tiene al menos un
   * pago registrado. Sin distinguir cuántos: un pago = tilde. El total
   * cobrado y el detalle viven en el DetalleClaseDialog.
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
 * Es un <button>: el click abre el DetalleClaseDialog (ver/cobrar la
 * ocurrencia). Mantiene la absorción del click sobre los slots de
 * Disponible que cubre debajo — el click no atraviesa al modal de
 * nueva reserva.
 *
 * Diseño: fondo violeta clarito + barra izq violeta + birrete violeta.
 * Si la ocurrencia ya está cobrada, aparece un tilde violeta (Check) en
 * la esquina superior derecha; el resto del look queda igual para no
 * romper la coherencia visual con las impagas.
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

  return (
    <button
      type="button"
      onClick={() => onClick(clase)}
      aria-label={`Ver detalle: ${titulo}, ${horaInicio} a ${horaFin}${pagado ? ', pagada' : ', impaga'}`}
      className={cn(
        'absolute left-1 right-1 overflow-hidden text-left',
        'rounded-md border border-border shadow-sm transition-shadow hover:shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
      style={{
        top,
        height,
        // Fondo violeta clarito (12% de opacidad sobre el token saturado).
        backgroundColor: 'hsl(var(--clase) / 0.12)',
        // Barra de 3px a la izquierda en violeta saturado.
        borderLeftWidth: '3px',
        borderLeftColor: 'hsl(var(--clase))',
      }}
    >
      <div className="flex items-start justify-between gap-1.5 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <GraduationCap
              className="h-3 w-3 shrink-0"
              style={{ color: 'hsl(var(--clase))' }}
              aria-hidden="true"
            />
            <span className="truncate text-xs font-medium text-foreground">
              {titulo}
            </span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {horaInicio}–{horaFin}
          </div>
        </div>
        {pagado && (
          <Check
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: 'hsl(var(--clase))' }}
            aria-hidden="true"
          />
        )}
      </div>
    </button>
  );
}
