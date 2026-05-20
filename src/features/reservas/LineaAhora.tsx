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
 * canchas. Sólo se monta si la fecha mostrada es HOY. Si la hora actual
 * cae fuera de [apertura, cierre), no renderiza nada.
 *
 * Se auto-actualiza cada 60 segundos para que la línea vaya bajando con
 * el tiempo sin requerir refresh manual.
 *
 * No tiene pointer-events: se superpone visualmente sin interferir con
 * los clicks de slots y bloques debajo.
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
    // Refresh cada minuto para que la línea baje en tiempo real.
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (fecha !== fechaHoy()) return null;

  const aperturaMin = horaToMinutos(horaApertura);
  const cierreMin = horaToMinutos(horaCierre);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Fuera del horario operativo del club: no mostramos la línea.
  if (nowMin < aperturaMin || nowMin >= cierreMin) return null;

  // top = (minutos transcurridos desde apertura / 30 min) × slotHeight
  const top = ((nowMin - aperturaMin) / 30) * slotHeight;

  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="pointer-events-none absolute z-10"
      style={{
        top,
        left: leftOffset,
        right: 0,
      }}
    >
      <div className="relative h-[2px] bg-destructive">
        <div className="absolute -left-1 -top-[5px] h-3 w-3 rounded-full bg-destructive" />
      </div>
    </div>
  );
}
