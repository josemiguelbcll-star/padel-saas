import { useEffect, useState } from 'react';
import { fechaHoy } from './utils/fechaUtils';
import { horaToMinutos } from './utils/horaUtils';

interface LineaAhoraProps {
  /** Fecha que muestra la grilla, 'YYYY-MM-DD'. La línea sólo se renderiza si === hoy. */
  fecha: string;
  /** Hora de apertura del club, 'HH:MM' o 'HH:MM:SS' (para offset desde tope). */
  horaApertura: string;
  /** Hora de cierre del club (para clamp si la hora actual queda fuera). */
  horaCierre: string;
  /** Alto de cada slot de 30 min en pixels (mismo valor que usa GrillaDia). */
  slotHeight: number;
  /** Offset horizontal desde el borde izquierdo del contenedor (px), para
   *  saltarse la columna de horarios y arrancar sobre las canchas. */
  leftOffset: number;
}

/**
 * Línea horizontal roja que marca la hora actual sobre las columnas de
 * canchas, con una pastilla de hora ("HH:MM") en el gutter de horarios.
 * Sólo se monta si la fecha mostrada es HOY y la hora cae dentro del
 * horario operativo. Se auto-actualiza cada 60 s. No tiene pointer-events.
 */
export function LineaAhora({
  fecha,
  horaApertura,
  horaCierre,
  slotHeight,
  leftOffset,
}: LineaAhoraProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (fecha !== fechaHoy()) return null;

  const aperturaMin = horaToMinutos(horaApertura);
  let cierreMin = horaToMinutos(horaCierre);
  if (cierreMin === 0) cierreMin = 1440;
  if (cierreMin <= aperturaMin) cierreMin += 1440;

  let nowMin = now.getHours() * 60 + now.getMinutes();
  if (cierreMin > 1440 && nowMin < aperturaMin) {
    if (nowMin + 1440 < cierreMin) {
      nowMin += 1440;
    }
  }

  if (nowMin < aperturaMin || nowMin >= cierreMin) return null;

  const top = ((nowMin - aperturaMin) / 30) * slotHeight;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="pointer-events-none absolute z-10"
      style={{ top, left: leftOffset, right: 0 }}
    >
      <div
        className="relative h-[2px]"
        style={{ backgroundColor: 'hsl(var(--destructive))' }}
      >
        {/* Punto al inicio de la línea (sobre el borde de las canchas). */}
        <div
          className="absolute -left-1 -top-[5px] h-3 w-3 rounded-full shadow"
          style={{ backgroundColor: 'hsl(var(--destructive))' }}
        />
        {/* Pastilla de hora en el gutter de horarios (a la izquierda). */}
        <span
          className="absolute -translate-x-full -translate-y-1/2 rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums shadow"
          style={{
            left: -6,
            top: '1px',
            backgroundColor: 'hsl(var(--destructive))',
            color: 'hsl(var(--destructive-foreground))',
          }}
        >
          {hh}:{mm}
        </span>
      </div>
    </div>
  );
}
