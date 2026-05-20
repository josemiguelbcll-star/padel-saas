import { useMemo } from 'react';
import type { Cancha, ClaseCobro } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { CanchaColumna } from './CanchaColumna';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { LeyendaGrilla } from './LeyendaGrilla';
import { LineaAhora } from './LineaAhora';
import { formatearHora, generarSlots } from './utils/horaUtils';

interface GrillaDiaProps {
  /** Canchas activas, ya ordenadas (vienen del hook que ordena por orden + nombre). */
  canchas: Cancha[];
  /** Reservas del día (titular joineado). Ya filtradas: sin canceladas. */
  reservas: ReservaConTitular[];
  /** Clases activas que aplican al día mostrado (filtro por dias_semana lo hace el padre). */
  clases: ClaseConProfesor[];
  /** Pagos de cada clase para la fecha mostrada, indexados por clase_id.
   *  Una ocurrencia puede tener 0/1/N pagos (desde la 0008). */
  cobrosPorClase: Map<number, ClaseCobro[]>;
  /** Hora de apertura del club, 'HH:MM:SS' o 'HH:MM'. NO null acá — el padre garantiza. */
  horaApertura: string;
  /** Hora de cierre del club, 'HH:MM:SS' o 'HH:MM'. */
  horaCierre: string;
  /** Fecha mostrada 'YYYY-MM-DD' (para que LineaAhora sepa si renderizar). */
  fecha: string;
  loading?: boolean;
  /** Callback al clickear un Disponible. */
  onSlotClick: (canchaId: number, hora: string) => void;
  /** Callback al clickear un bloque de reserva existente. */
  onReservaClick: (reserva: ReservaConTitular) => void;
  /** Callback al clickear un bloque de clase. */
  onClaseClick: (clase: ClaseConProfesor) => void;
}

const SLOT_HEIGHT = 36;
const SLOT_GRANULARIDAD_MIN = 30;
const COL_CANCHA_WIDTH = 168;
const COL_TIME_WIDTH = 56;

/**
 * Grilla del día. Rediseño visual (no logic): sin líneas de grilla, las
 * columnas de cancha llevan un fondo `bg-muted/30` para separarse sin
 * bordes. La columna de horarios queda transparente y sólo muestra el
 * label en los slots que caen en hora redonda (HH:00).
 *
 * Sobre las columnas de cancha se monta una <LineaAhora /> absolute en
 * rojo que cruza horizontalmente a la altura de la hora actual (sólo si
 * la fecha mostrada es hoy).
 *
 * Debajo de la grilla, una <LeyendaGrilla /> chica con los colores de
 * cada tipo de bloque.
 */
export function GrillaDia({
  canchas,
  reservas,
  clases,
  cobrosPorClase,
  horaApertura,
  horaCierre,
  fecha,
  loading,
  onSlotClick,
  onReservaClick,
  onClaseClick,
}: GrillaDiaProps) {
  const slots = useMemo(
    () => generarSlots(horaApertura, horaCierre, SLOT_GRANULARIDAD_MIN),
    [horaApertura, horaCierre],
  );

  // Index reservas por cancha_id para evitar O(N×M) en el render.
  const reservasPorCancha = useMemo(() => {
    const m = new Map<number, ReservaConTitular[]>();
    for (const r of reservas) {
      if (r.estado === 'cancelada') continue;
      const lista = m.get(r.cancha_id);
      if (lista) lista.push(r);
      else m.set(r.cancha_id, [r]);
    }
    return m;
  }, [reservas]);

  // Index clases por cancha_id (las clases ya vienen filtradas por día).
  const clasesPorCancha = useMemo(() => {
    const m = new Map<number, ClaseConProfesor[]>();
    for (const c of clases) {
      const lista = m.get(c.cancha_id);
      if (lista) lista.push(c);
      else m.set(c.cancha_id, [c]);
    }
    return m;
  }, [clases]);

  if (slots.length === 0) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        El horario del club es inválido (apertura ≥ cierre). Revisalo en
        Configuración → Horarios.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-x-auto">
        {loading && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center pt-12">
            <div className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              Cargando reservas…
            </div>
          </div>
        )}

        {/* Header row: nombres de canchas. Sin bordes, sólo texto. */}
        <div className="flex">
          <div
            className="shrink-0"
            style={{ width: COL_TIME_WIDTH }}
            aria-hidden="true"
          />
          {canchas.map((c) => (
            <div
              key={c.id}
              className="shrink-0 px-3 pb-2 text-sm font-medium text-foreground"
              style={{ width: COL_CANCHA_WIDTH }}
            >
              {c.nombre}
            </div>
          ))}
        </div>

        {/* Body: columna de horas + N columnas de canchas + LineaAhora sobre las canchas */}
        <div className="relative flex">
          {/* Columna de horarios — sólo labels en hora en punto. */}
          <div className="shrink-0" style={{ width: COL_TIME_WIDTH }}>
            {slots.map((slot) => {
              const enHoraEnPunto = slot.endsWith(':00:00');
              return (
                <div
                  key={slot}
                  className="flex items-start justify-end pr-2 pt-0.5"
                  style={{ height: SLOT_HEIGHT }}
                >
                  {enHoraEnPunto && (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {formatearHora(slot)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Columnas de canchas */}
          {canchas.map((c) => (
            <CanchaColumna
              key={c.id}
              cancha={c}
              slots={slots}
              slotHeight={SLOT_HEIGHT}
              width={COL_CANCHA_WIDTH}
              reservas={reservasPorCancha.get(c.id) ?? []}
              clases={clasesPorCancha.get(c.id) ?? []}
              cobrosPorClase={cobrosPorClase}
              horaApertura={horaApertura}
              horaCierre={horaCierre}
              onSlotClick={onSlotClick}
              onReservaClick={onReservaClick}
              onClaseClick={onClaseClick}
            />
          ))}

          {/* Línea de hora actual — sólo si fecha = hoy, sólo sobre las canchas. */}
          <LineaAhora
            fecha={fecha}
            horaApertura={horaApertura}
            horaCierre={horaCierre}
            slotHeight={SLOT_HEIGHT}
            leftOffset={COL_TIME_WIDTH}
          />
        </div>
      </div>

      <LeyendaGrilla />
    </div>
  );
}
