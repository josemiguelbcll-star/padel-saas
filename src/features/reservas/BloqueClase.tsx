import { GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { formatearHora, sumarMinutos } from './utils/horaUtils';

interface BloqueClaseProps {
  clase: ClaseConProfesor;
  /** Posición absoluta dentro de la columna de la cancha (px). */
  top: number;
  /** Alto del bloque (px). Ya viene clamp-ado al alto visible de la grilla. */
  height: number;
}

/**
 * Bloque visual de una clase dentro de la grilla del día.
 *
 * - Display-only: no es clickeable. Como se posiciona en absolute encima
 *   de los slots vacíos, intercepta el click visualmente — el slot debajo
 *   no se llega a accionar. La clase no abre modal ni interactúa.
 * - Color: `bg-clase` (violeta) con `text-clase-foreground` (blanco),
 *   tokens propios definidos en globals.css. Distinto deliberadamente
 *   de los 5 estados de reserva (que usan `bg-estado-*`).
 * - Texto: el `nombre` de la clase si lo tiene, sino "Clase · {Profesor}".
 *   Icono de birrete al inicio como marca visual de "esto es una clase".
 */
export function BloqueClase({ clase, top, height }: BloqueClaseProps) {
  const profesorNombre = clase.profesor?.nombre ?? 'Sin profesor';
  const titulo = clase.nombre ?? `Clase · ${profesorNombre}`;
  const horaInicio = formatearHora(clase.hora_inicio);
  const horaFin = formatearHora(
    sumarMinutos(clase.hora_inicio, clase.duracion_min),
  );

  return (
    <div
      role="img"
      aria-label={`${titulo}, ${horaInicio} a ${horaFin}`}
      className={cn(
        'absolute left-1 right-1 overflow-hidden rounded-md border border-black/10 px-2 py-1',
        'cursor-default select-none shadow-sm',
      )}
      // Aplicamos los tokens --clase / --clase-foreground via style inline
      // en lugar de utilities de Tailwind (`bg-clase` / `text-clase-foreground`).
      // Razón: cambios en theme.extend.colors del tailwind.config.ts
      // requieren restart del dev server para que el JIT los reincorpore,
      // mientras que las CSS custom properties de globals.css se actualizan
      // sin restart. Style inline → siempre lee la variable en runtime.
      // Trade-off: no podemos usar variantes como `bg-clase/50` o
      // `hover:bg-clase`. Para los bloques de clase (display-only) no las
      // necesitamos. Si más adelante hacen falta, hay que asegurar el
      // restart del dev server al introducirlas y volver a bg-clase.
      style={{
        top,
        height,
        backgroundColor: 'hsl(var(--clase))',
        color: 'hsl(var(--clase-foreground))',
      }}
    >
      <div className="flex items-center gap-1.5">
        <GraduationCap
          className="h-3 w-3 shrink-0"
          aria-hidden="true"
        />
        <span className="truncate text-xs font-medium">{titulo}</span>
      </div>
      <div className="truncate text-[10px] opacity-90">
        {horaInicio}–{horaFin}
      </div>
    </div>
  );
}
