import { GraduationCap, Plus, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TurnoFijo } from '@/types/database';
import { formatearHora, minutosToHora } from '@/features/reservas/utils/horaUtils';
import type { OcupacionFijo } from './utils/ocupacionTurnoFijo';

interface DiaColumnaTurnosFijosProps {
  width: number;
  /** Turnos fijos del día, posicionados en minutos. */
  ocupacion: OcupacionFijo[];
  /** Clases del día que ocupan slot (bloquean disponibilidad). */
  clases: { id: number; inicioMin: number; finMin: number; label: string }[];
  /** Slots libres ofrecidos (duración = paso de la franja). */
  slotsDisponibles: { inicioMin: number; finMin: number; duracionMin: number }[];
  /** Ids de turnos fijos involucrados en algún cruce (data sucia). */
  idsCruce: Set<number>;
  aperturaMin: number;
  cierreMin: number;
  slotHeight: number;
  granularidadMin: number;
  /** Marcas de hora (HH:00) en minutos, para las hairlines. */
  horas: number[];
  esHoy: boolean;
  resolverTitular: (t: TurnoFijo) => string;
  /** Crear un turno fijo que arranca en `inicioMin` con `duracionMin`. */
  onCrearSlot: (inicioMin: number, duracionMin: number) => void;
  onEditarTurno: (t: TurnoFijo) => void;
}

/**
 * Una columna del calendario semanal = un día de la semana para la cancha
 * seleccionada. Posiciona todo por minutos desde apertura × alto de slot
 * (mismo sistema que la grilla de reservas, sin solapes).
 *
 *  - Turnos fijos existentes: bloques sólidos (con su duración real).
 *    Clickeables → editar.
 *  - Slots disponibles: bloques punteados de 90' → click crea el turno
 *    fijo precargado en ese horario.
 */
export function DiaColumnaTurnosFijos({
  width,
  ocupacion,
  clases,
  slotsDisponibles,
  idsCruce,
  aperturaMin,
  cierreMin,
  slotHeight,
  granularidadMin,
  horas,
  esHoy,
  resolverTitular,
  onCrearSlot,
  onEditarTurno,
}: DiaColumnaTurnosFijosProps) {
  const altura = ((cierreMin - aperturaMin) / granularidadMin) * slotHeight;
  const topDe = (min: number) => ((min - aperturaMin) / granularidadMin) * slotHeight;
  const altoDe = (durMin: number) => (durMin / granularidadMin) * slotHeight;

  return (
    <div
      className={cn(
        'relative shrink-0 border-l border-border/50',
        esHoy && 'bg-primary/[0.03]',
      )}
      style={{ width, height: altura }}
    >
      {/* Hairlines por hora (alineadas con el eje de horas). */}
      {horas.map((m) => (
        <div
          key={m}
          className="pointer-events-none absolute inset-x-0 border-t border-border/40"
          style={{ top: topDe(m) }}
          aria-hidden="true"
        />
      ))}

      {/* Slots disponibles (90'). */}
      {slotsDisponibles.map((s) => (
        <button
          key={`slot-${s.inicioMin}`}
          type="button"
          onClick={() => onCrearSlot(s.inicioMin, s.duracionMin)}
          title={`Crear turno fijo · ${formatearHora(minutosToHora(s.inicioMin))}–${formatearHora(minutosToHora(s.finMin))}`}
          className={cn(
            'group absolute inset-x-0.5 flex flex-col items-center justify-center gap-0.5 rounded-md',
            'border border-dashed border-border/70 text-muted-foreground transition-colors',
            'hover:border-primary/60 hover:bg-primary/[0.07] hover:text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          style={{ top: topDe(s.inicioMin) + 1, height: altoDe(s.finMin - s.inicioMin) - 2 }}
        >
          <span className="inline-flex items-center gap-1 text-[11px] font-medium opacity-70 transition-opacity group-hover:opacity-100">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Disponible
          </span>
          <span className="text-[10px] tabular-nums opacity-0 transition-opacity group-hover:opacity-100">
            {formatearHora(minutosToHora(s.inicioMin))}–{formatearHora(minutosToHora(s.finMin))}
          </span>
        </button>
      ))}

      {/* Clases (ocupan slot — no se ofrecen como disponibles). */}
      {clases.map((c) => {
        const h = altoDe(c.finMin - c.inicioMin);
        return (
          <div
            key={`clase-${c.id}`}
            title={`Clase · ${c.label} · ${formatearHora(minutosToHora(c.inicioMin))}–${formatearHora(minutosToHora(c.finMin))}`}
            className="absolute inset-x-0.5 overflow-hidden rounded-md border border-border bg-secondary px-1.5 py-1 text-left shadow-sm"
            style={{ top: topDe(c.inicioMin) + 1, height: Math.max(h - 2, 16) }}
          >
            <span className="flex items-center gap-1 truncate text-[11px] font-semibold text-secondary-foreground">
              <GraduationCap className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{c.label}</span>
            </span>
            {h >= 34 && (
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {formatearHora(minutosToHora(c.inicioMin))}–{formatearHora(minutosToHora(c.finMin))}
              </span>
            )}
          </div>
        );
      })}

      {/* Turnos fijos existentes. */}
      {ocupacion.map((o) => {
        const cruza = idsCruce.has(o.turno.id);
        const h = altoDe(o.finMin - o.inicioMin);
        return (
          <button
            key={o.turno.id}
            type="button"
            onClick={() => onEditarTurno(o.turno)}
            title={`${resolverTitular(o.turno)} · ${formatearHora(minutosToHora(o.inicioMin))}–${formatearHora(minutosToHora(o.finMin))} · ${o.turno.duracion_min} min`}
            className={cn(
              'absolute inset-x-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left shadow-sm transition-shadow',
              'hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              cruza
                ? 'border-destructive/50 bg-destructive/10'
                : 'border-primary/40 bg-primary/10',
            )}
            style={{ top: topDe(o.inicioMin) + 1, height: Math.max(h - 2, 16) }}
          >
            <span className="flex items-center gap-1 truncate text-[11px] font-semibold text-foreground">
              <Repeat className="h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">{resolverTitular(o.turno)}</span>
            </span>
            {h >= 34 && (
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {formatearHora(minutosToHora(o.inicioMin))}–{formatearHora(minutosToHora(o.finMin))}
              </span>
            )}
            {cruza && (
              <span className="mt-0.5 block text-[9px] font-medium text-destructive">
                ⚠ se cruza con otro fijo
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
