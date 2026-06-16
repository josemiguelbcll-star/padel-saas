import { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Cancha, FranjaTurno, TurnoFijo } from '@/types/database';
import {
  formatearHora,
  horaToMinutos,
  minutosToHora,
  normalizarHora,
} from '@/features/reservas/utils/horaUtils';
import {
  diaSemanaDe,
  fechaHoy,
  formatearFechaISO,
} from '@/features/reservas/utils/fechaUtils';
import {
  calcularDisponiblesCore,
  type Intervalo,
} from '@/features/reservas/utils/disponibilidad';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { DiaColumnaTurnosFijos } from './DiaColumnaTurnosFijos';
import { idsConCruce, ocupacionDelDia } from './utils/ocupacionTurnoFijo';
import type { TurnoFijoPrefill } from './NuevoTurnoFijoDialog';

const SLOT_HEIGHT = 36;
const GRAN = 30;
const TIME_COL_W = 56;
const DAY_COL_W = 132;

const DIAS = [
  { n: 1, ab: 'LUN' },
  { n: 2, ab: 'MAR' },
  { n: 3, ab: 'MIÉ' },
  { n: 4, ab: 'JUE' },
  { n: 5, ab: 'VIE' },
  { n: 6, ab: 'SÁB' },
  { n: 7, ab: 'DOM' },
] as const;

/**
 * Próxima fecha real (hoy incluido) cuyo weekday = `dia`. `resolverDuraciones`
 * usa solo el weekday de la fecha para elegir la franja, así que cualquier
 * fecha con ese día de semana sirve.
 */
function fechaRepresentativa(dia: number, hoyDia: number): string {
  const delta = (dia - hoyDia + 7) % 7;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + delta);
  return formatearFechaISO(d);
}

interface CalendarioSemanalTurnosFijosProps {
  /** Turnos fijos activos del club (de useTurnosFijos). */
  turnos: TurnoFijo[];
  canchas: Cancha[];
  resolverTitular: (t: TurnoFijo) => string;
  horaApertura: string | null;
  horaCierre: string | null;
  /** Franjas del club (0050) — definen inicios y duraciones por horario. */
  franjas: FranjaTurno[];
  /** clubes.duracion_turno_default — fallback del motor cuando no hay franja. */
  duracionDefault: number;
  /** Clases del club (de useClases). Las activas ocupan slot y no se ofrecen. */
  clases: ClaseConProfesor[];
  /** Abre el alta precargada con el slot elegido. */
  onCrearEnSlot: (prefill: TurnoFijoPrefill) => void;
  /** Click en un turno fijo existente → editar. */
  onEditarTurno: (t: TurnoFijo) => void;
  readOnly?: boolean;
}

/**
 * Calendario "semana tipo" (Lun→Dom) de UNA cancha (selector arriba). El
 * indicador de ocupación son los OTROS turnos fijos; las reservas sueltas
 * no bloquean. Los huecos se ofrecen tilados en bloques de 90' (regla del
 * club) y al clickearlos abren el alta precargada con cancha+día+hora+90'.
 */
export function CalendarioSemanalTurnosFijos({
  turnos,
  canchas,
  resolverTitular,
  horaApertura,
  horaCierre,
  franjas,
  duracionDefault,
  clases,
  onCrearEnSlot,
  onEditarTurno,
  readOnly,
}: CalendarioSemanalTurnosFijosProps) {
  const [canchaIdSel, setCanchaIdSel] = useState<number | null>(null);

  // Cancha efectiva: la elegida si sigue válida, si no la primera.
  const canchaSel = useMemo(() => {
    if (canchaIdSel !== null && canchas.some((c) => c.id === canchaIdSel)) {
      return canchaIdSel;
    }
    return canchas[0]?.id ?? null;
  }, [canchaIdSel, canchas]);

  const hoy = fechaHoy();
  const hoyDia = diaSemanaDe(hoy);

  // Turnos fijos vigentes (no vencidos) de la cancha elegida.
  const turnosCancha = useMemo(() => {
    if (canchaSel === null) return [];
    return turnos.filter(
      (t) =>
        t.cancha_id === canchaSel &&
        (t.fecha_hasta === null || t.fecha_hasta >= hoy),
    );
  }, [turnos, canchaSel, hoy]);

  // Clases activas de la cancha (ocupan slot → bloquean disponibilidad).
  const clasesCancha = useMemo(() => {
    if (canchaSel === null) return [];
    return clases.filter((c) => c.cancha_id === canchaSel && c.activa);
  }, [clases, canchaSel]);

  // Datos por día: ocupación (fijos + clases) + slots disponibles del MOTOR
  // REAL (calcularDisponiblesCore — el mismo que la grilla de reservas).
  const porDia = useMemo(() => {
    return DIAS.map((d) => {
      const ocup = ocupacionDelDia(turnosCancha, d.n);
      const clasesDia = clasesCancha
        .filter((c) => c.dias_semana.includes(d.n))
        .map((c) => {
          const inicioMin = horaToMinutos(c.hora_inicio);
          return {
            id: c.id,
            inicioMin,
            finMin: inicioMin + c.duracion_min,
            label: c.nombre ?? c.profesor?.nombre ?? 'Clase',
          };
        });

      // Ocupado = turnos fijos + clases. Las reservas sueltas NO entran.
      let slots: { inicioMin: number; finMin: number; duracionMin: number }[] = [];
      if (canchaSel !== null && horaApertura && horaCierre) {
        const ocupados: Intervalo[] = [
          ...ocup.map((o) => ({ start: o.inicioMin, end: o.finMin })),
          ...clasesDia.map((c) => ({ start: c.inicioMin, end: c.finMin })),
        ];
        const disponibles = calcularDisponiblesCore({
          ocupados,
          horaApertura,
          horaCierre,
          fecha: fechaRepresentativa(d.n, hoyDia),
          canchaId: canchaSel,
          franjas,
          duracionDefault,
        });
        slots = disponibles.map((s) => {
          const inicioMin = horaToMinutos(s.hora);
          const dur = s.duracionesPermitidas[0]!; // paso = duración más corta
          return { inicioMin, finMin: inicioMin + dur, duracionMin: dur };
        });
      }

      return {
        dia: d.n,
        ocupacion: ocup,
        clases: clasesDia,
        slots,
        cruces: idsConCruce(ocup),
      };
    });
  }, [
    turnosCancha,
    clasesCancha,
    horaApertura,
    horaCierre,
    canchaSel,
    franjas,
    duracionDefault,
    hoyDia,
  ]);

  if (canchas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No hay canchas configuradas. Cargá canchas en Configuración para
        usar el calendario.
      </div>
    );
  }

  if (!horaApertura || !horaCierre) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Configurá el horario de apertura y cierre del club en Configuración
        → Horarios para ver el calendario.
      </div>
    );
  }

  const aperturaMin = horaToMinutos(normalizarHora(horaApertura));
  const cierreMin = horaToMinutos(normalizarHora(horaCierre));

  if (cierreMin <= aperturaMin) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        El horario del club es inválido (apertura ≥ cierre). Revisalo en
        Configuración → Horarios.
      </div>
    );
  }

  // El borde de una franja puede exceder el cierre nominal del club (ej.
  // último turno 22:00–23:30 con cierre 23:00). Extendemos la grilla
  // visible hasta el final real de lo que hay que mostrar.
  const cierreVisibleMin = porDia.reduce((max, d) => {
    let m = max;
    for (const s of d.slots) m = Math.max(m, s.finMin);
    for (const o of d.ocupacion) m = Math.max(m, o.finMin);
    for (const c of d.clases) m = Math.max(m, c.finMin);
    return m;
  }, cierreMin);

  const altura = ((cierreVisibleMin - aperturaMin) / GRAN) * SLOT_HEIGHT;
  const topDe = (min: number) => ((min - aperturaMin) / GRAN) * SLOT_HEIGHT;

  // Marcas de hora en punto dentro del rango (eje + hairlines).
  const horas: number[] = [];
  for (let m = Math.ceil(aperturaMin / 60) * 60; m < cierreVisibleMin; m += 60) {
    horas.push(m);
  }

  function handleCrear(dia: number, inicioMin: number, duracionMin: number): void {
    if (canchaSel === null) return;
    onCrearEnSlot({
      cancha_id: canchaSel,
      dia_semana: dia,
      hora_inicio: formatearHora(minutosToHora(inicioMin)),
      duracion_min: duracionMin,
    });
  }

  return (
    <div className="space-y-3">
      {/* Selector de cancha */}
      {canchas.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Cancha:
          </span>
          {canchas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCanchaIdSel(c.id)}
              aria-pressed={c.id === canchaSel}
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                c.id === canchaSel
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {c.nombre}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="min-w-[980px]">
          {/* Header de días */}
          <div className="flex border-b border-border">
            <div className="shrink-0" style={{ width: TIME_COL_W }} aria-hidden="true" />
            {porDia.map((d) => {
              const esHoy = d.dia === hoyDia;
              const cant = d.ocupacion.length;
              const ab = DIAS.find((x) => x.n === d.dia)?.ab ?? '';
              return (
                <div
                  key={d.dia}
                  className={cn(
                    'shrink-0 px-2 py-2 text-center',
                    esHoy && 'bg-primary/[0.04]',
                  )}
                  style={{ width: DAY_COL_W }}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        esHoy ? 'text-primary' : 'text-foreground',
                      )}
                    >
                      {ab}
                    </span>
                    {esHoy && (
                      <span className="rounded bg-primary/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-primary">
                        hoy
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {cant === 0 ? 'sin fijos' : `${cant} fijo${cant > 1 ? 's' : ''}`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Cuerpo: eje de horas + 7 columnas */}
          <div className="flex">
            <div className="relative shrink-0" style={{ width: TIME_COL_W, height: altura }}>
              {horas.map((m) => (
                <span
                  key={m}
                  className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
                  style={{ top: topDe(m) }}
                >
                  {formatearHora(minutosToHora(m))}
                </span>
              ))}
            </div>

            {porDia.map((d) => (
              <DiaColumnaTurnosFijos
                key={d.dia}
                width={DAY_COL_W}
                ocupacion={d.ocupacion}
                clases={d.clases}
                slotsDisponibles={d.slots}
                idsCruce={d.cruces}
                aperturaMin={aperturaMin}
                cierreMin={cierreVisibleMin}
                slotHeight={SLOT_HEIGHT}
                granularidadMin={GRAN}
                horas={horas}
                esHoy={d.dia === hoyDia}
                resolverTitular={resolverTitular}
                onCrearSlot={(inicioMin, duracionMin) => handleCrear(d.dia, inicioMin, duracionMin)}
                onEditarTurno={onEditarTurno}
                readOnly={readOnly}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-primary/40 bg-primary/10" />
          Turno fijo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-border bg-secondary" />
          Clase
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-dashed border-border bg-background" />
          Disponible — click para crear
        </span>
      </div>
    </div>
  );
}
