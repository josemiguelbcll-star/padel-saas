import { useMemo } from 'react';
import type { Cancha, ClaseCobro, FranjaTurno } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { CanchaColumna } from './CanchaColumna';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { LeyendaGrilla } from './LeyendaGrilla';
import { LineaAhora } from './LineaAhora';
import type { InfoReservaVisual } from './utils/derivarEstadoOperativo';
import { formatearHora, generarSlots, horaToMinutos } from './utils/horaUtils';

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
  /** Fecha mostrada 'YYYY-MM-DD' (LineaAhora + resolución de franjas por día). */
  fecha: string;
  /** Franjas de turno del club (duraciones por franja). Vacío = fallback. */
  franjas: FranjaTurno[];
  /** Duración por defecto del club (fallback sin franja). */
  duracionDefault: number;
  /** Info visual por reserva id (estado operativo + flags de actividad). */
  infoReservas: Map<number, InfoReservaVisual>;
  loading?: boolean;
  /** Callback al clickear un Disponible (con las duraciones que la franja permite ahí). */
  onSlotClick: (canchaId: number, hora: string, duracionesPermitidas: number[]) => void;
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
  franjas,
  duracionDefault,
  infoReservas,
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

  // Ocupación por cancha para el encabezado (sin queries: usa lo cargado).
  const aperturaMin = horaToMinutos(horaApertura);
  let cierreMin = horaToMinutos(horaCierre);
  if (cierreMin === 0) cierreMin = 1440;
  const operatingMin = Math.max(0, cierreMin - aperturaMin);

  function ocupacionDe(canchaId: number): {
    turnos: number;
    pct: number;
    horasLibres: number;
  } {
    const rs = reservasPorCancha.get(canchaId) ?? [];
    const cs = clasesPorCancha.get(canchaId) ?? [];
    let ocupMin = 0;
    for (const r of rs) {
      const s = Math.max(horaToMinutos(r.hora_inicio), aperturaMin);
      let endMin = horaToMinutos(r.hora_fin);
      if (endMin === 0 || endMin < s) endMin = 1440;
      const e = Math.min(endMin, cierreMin);
      if (e > s) ocupMin += e - s;
    }
    for (const c of cs) {
      const s = Math.max(horaToMinutos(c.hora_inicio), aperturaMin);
      const e = Math.min(horaToMinutos(c.hora_inicio) + c.duracion_min, cierreMin);
      if (e > s) ocupMin += e - s;
    }
    ocupMin = Math.min(ocupMin, operatingMin);
    const pct = operatingMin > 0 ? Math.round((ocupMin / operatingMin) * 100) : 0;
    const horasLibres = Math.max(0, (operatingMin - ocupMin) / 60);
    return { turnos: rs.length, pct, horasLibres };
  }

  function fmtHoras(h: number): string {
    const r = Math.round(h * 10) / 10;
    return Number.isInteger(r) ? `${r}h` : `${r.toFixed(1)}h`;
  }

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
      <div className="relative overflow-x-auto rounded-xl border border-border bg-card p-3 shadow-sm">
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
          {canchas.map((c) => {
            const occ = ocupacionDe(c.id);
            return (
              <div
                key={c.id}
                className="shrink-0 px-3 pb-2"
                style={{ width: COL_CANCHA_WIDTH }}
              >
                <div className="truncate text-sm font-semibold text-foreground">
                  {c.nombre}
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${occ.pct}%` }}
                  />
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                  <span>
                    {occ.turnos} turno{occ.turnos === 1 ? '' : 's'}
                  </span>
                  <span className="tabular-nums">
                    {occ.pct}% · {fmtHoras(occ.horasLibres)} libre
                  </span>
                </div>
              </div>
            );
          })}
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
              fecha={fecha}
              franjas={franjas}
              duracionDefault={duracionDefault}
              infoReservas={infoReservas}
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
