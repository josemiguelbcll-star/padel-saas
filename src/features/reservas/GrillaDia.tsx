import { useMemo } from 'react';
import type { Cancha } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { CanchaColumna } from './CanchaColumna';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { formatearHora, generarSlots } from './utils/horaUtils';

interface GrillaDiaProps {
  /** Canchas activas, ya ordenadas (vienen del hook que ordena por orden + nombre). */
  canchas: Cancha[];
  /** Reservas del día (titular joineado). Ya filtradas: sin canceladas. */
  reservas: ReservaConTitular[];
  /** Clases activas que aplican al día mostrado (filtro por dias_semana lo hace el padre). */
  clases: ClaseConProfesor[];
  /** Hora de apertura del club, 'HH:MM:SS' o 'HH:MM'. NO null acá — el padre garantiza. */
  horaApertura: string;
  /** Hora de cierre del club, 'HH:MM:SS' o 'HH:MM'. */
  horaCierre: string;
  loading?: boolean;
  /** Callback al clickear un slot vacío de cualquier cancha. */
  onSlotClick: (canchaId: number, hora: string) => void;
  /** Callback al clickear un bloque de reserva existente. */
  onReservaClick: (reserva: ReservaConTitular) => void;
}

const SLOT_HEIGHT = 40;
const SLOT_GRANULARIDAD_MIN = 30;
const COL_CANCHA_WIDTH = 160;
const COL_TIME_WIDTH = 64;

/**
 * Grilla del día. Layout:
 *
 *   ┌─────────┬──────────┬──────────┬──────────┐
 *   │         │ Cancha 1 │ Cancha 2 │ Cancha 3 │  ← header (cancha names)
 *   ├─────────┼──────────┼──────────┼──────────┤
 *   │  08:00  │  [slot]  │  [slot]  │  [slot]  │
 *   │  08:30  │  [slot]  │ [Reser]  │  [slot]  │
 *   │  09:00  │  [Res ]  │ [    ]   │  [slot]  │
 *   │  09:30  │  [   ]   │  [slot]  │  [slot]  │
 *   │   ...                                     │
 *   └─────────┴──────────┴──────────┴──────────┘
 *
 * - Rejilla de 30 min (común divisor de 60 y 90).
 * - Las reservas son bloques absolutos sobre las columnas (cada
 *   CanchaColumna las posiciona en su scope).
 * - Sin sticky headers en sprint 3a; el scroll vertical es del page.
 * - overflow-x-auto cuando hay muchas canchas y no entran en viewport.
 */
export function GrillaDia({
  canchas,
  reservas,
  clases,
  horaApertura,
  horaCierre,
  loading,
  onSlotClick,
  onReservaClick,
}: GrillaDiaProps) {
  const slots = useMemo(
    () => generarSlots(horaApertura, horaCierre, SLOT_GRANULARIDAD_MIN),
    [horaApertura, horaCierre],
  );

  // Index reservas por cancha_id para evitar O(N×M) en el render.
  const reservasPorCancha = useMemo(() => {
    const m = new Map<number, ReservaConTitular[]>();
    for (const r of reservas) {
      // Filtramos canceladas: no ocupan slot en la grilla operativa.
      if (r.estado === 'cancelada') continue;
      const lista = m.get(r.cancha_id);
      if (lista) {
        lista.push(r);
      } else {
        m.set(r.cancha_id, [r]);
      }
    }
    return m;
  }, [reservas]);

  // Index clases por cancha_id (las clases ya vienen filtradas por día).
  const clasesPorCancha = useMemo(() => {
    const m = new Map<number, ClaseConProfesor[]>();
    for (const c of clases) {
      const lista = m.get(c.cancha_id);
      if (lista) {
        lista.push(c);
      } else {
        m.set(c.cancha_id, [c]);
      }
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
    <div className="relative overflow-x-auto rounded-md border border-border bg-card">
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-background/60 pt-12">
          <div className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            Cargando reservas…
          </div>
        </div>
      )}

      {/* Header row: nombres de canchas */}
      <div className="flex border-b border-border bg-muted/30">
        <div
          className="shrink-0"
          style={{ width: COL_TIME_WIDTH }}
          aria-hidden="true"
        />
        {canchas.map((c) => (
          <div
            key={c.id}
            className="shrink-0 border-l border-border px-3 py-2 text-sm font-medium text-foreground"
            style={{ width: COL_CANCHA_WIDTH }}
          >
            {c.nombre}
          </div>
        ))}
      </div>

      {/* Body: columna de horarios + N columnas de canchas */}
      <div className="flex">
        {/* Columna de horarios */}
        <div className="shrink-0" style={{ width: COL_TIME_WIDTH }}>
          {slots.map((slot) => (
            <div
              key={slot}
              className="flex items-start justify-end border-t border-border px-2 pt-0.5 text-[11px] tabular-nums text-muted-foreground"
              style={{ height: SLOT_HEIGHT }}
            >
              {formatearHora(slot)}
            </div>
          ))}
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
            onSlotClick={onSlotClick}
            onReservaClick={onReservaClick}
          />
        ))}
      </div>
    </div>
  );
}
