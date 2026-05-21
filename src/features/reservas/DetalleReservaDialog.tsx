import { useState } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type {
  Cancha,
  EstadoReserva,
  MedioPago,
  Reserva,
  ReservaPago,
} from '@/types/database';
import { ConsumosTurnoSection } from './ConsumosTurnoSection';
import { PersonasTurnoSection } from './PersonasTurnoSection';
import { useActualizarReserva } from './hooks/useActualizarReserva';
import { useReservaPagos } from './hooks/useReservaPagos';
import type { ReservaConTitular } from './hooks/useReservasDelDia';
import { formatearFechaAmigable } from './utils/fechaUtils';
import { formatearHora } from './utils/horaUtils';

// ─────────────────────────────────────────────────────────────────────
// Constantes y helpers locales
// ─────────────────────────────────────────────────────────────────────

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

const ESTADO_LABEL: Record<EstadoReserva, string> = {
  pendiente: 'Pendiente',
  senada: 'Señada',
  pagada: 'Pagada',
  jugada: 'Jugada',
  cancelada: 'Cancelada',
};

function estadoBadgeClasses(estado: EstadoReserva): string {
  // Clases completas (no concatenadas) para que el JIT de Tailwind las
  // detecte. Mismas tokens que los bloques de la grilla.
  switch (estado) {
    case 'pendiente':
      return 'bg-estado-pendiente text-estado-pendiente-foreground';
    case 'senada':
      return 'bg-estado-senada text-estado-senada-foreground';
    case 'pagada':
      return 'bg-estado-pagada text-estado-pagada-foreground';
    case 'jugada':
      return 'bg-estado-jugada text-estado-jugada-foreground';
    case 'cancelada':
      return 'bg-estado-cancelada text-estado-cancelada-foreground';
  }
}

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

function fmtFechaHoraCorta(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────

interface DetalleReservaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reserva: ReservaConTitular | null;
  cancha: Cancha | null;
}

/**
 * Modal de detalle de una reserva existente. Se abre al clickear un
 * bloque de reserva en la grilla. Permite:
 *
 *   - Ver: jugadores (titular + acompañantes), cuenta (total/pagado/saldo),
 *     historial de pagos, observaciones, estado actual.
 *   - Acciones (post-creación, conforme al doc 8.3):
 *     · Cobrar saldo (mini-form inline → RPC fn_cobrar_reserva).
 *     · Marcar como jugada (botón directo, sin confirm).
 *     · Cancelar reserva (con confirmación inline antes de aplicar).
 *     · Editar observaciones (campo único editable post-pago).
 *
 *   - NO permite cambiar cancha, hora, duración ni jugadores
 *     (reagendar = cancelar y crear nueva).
 */
export function DetalleReservaDialog({
  open,
  onOpenChange,
  reserva,
  cancha,
}: DetalleReservaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Layout sticky-header + scroll-body + sticky-footer:
        - `max-h-[90vh]` cap la altura al viewport (en mobile da margen
          para el browser chrome).
        - `flex flex-col` + `gap-0 p-0` reescriben el grid+padding del
          DialogContent default — el padding lo maneja cada zona (header,
          body, footer) para que la línea border-t/-b llegue al borde.
        - `overflow-hidden` evita que el contenido se desborde fuera del
          rounded-lg del modal.
      */}
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {reserva && cancha && (
          <DetalleReservaBody
            // Remount al cambiar de reserva: state interno (cobrandoMode,
            // edición de obs, confirmCancel, reserva local) arranca limpio.
            key={reserva.id}
            initialReserva={reserva}
            cancha={cancha}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DetalleReservaBodyProps {
  initialReserva: ReservaConTitular;
  cancha: Cancha;
  onClose: () => void;
}

function DetalleReservaBody({
  initialReserva,
  cancha,
  onClose,
}: DetalleReservaBodyProps) {
  // Estado local de la reserva: arranca con la prop, se actualiza con
  // los returns de las mutations para reflejar cambios sin esperar a
  // que se cierre y re-abra el dialog.
  const [reserva, setReserva] = useState<ReservaConTitular>(initialReserva);

  const pagosQuery = useReservaPagos(reserva.id);
  const actualizarMutation = useActualizarReserva();

  // State de las acciones del footer (marcar jugada / cancelar).
  // El cobro NO está acá — vive por persona en PersonasTurnoSection
  // desde el paso 4 del módulo cuenta del turno.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);

  const saldo = reserva.monto_total - reserva.monto_pagado;
  const tieneSaldo = saldo > 0;
  const puedeMarcarJugada =
    reserva.estado !== 'jugada' && reserva.estado !== 'cancelada';
  const puedeCancelar = reserva.estado !== 'cancelada';

  /**
   * Las mutations de reservas (actualizar y cobrar) devuelven un Reserva
   * "plano" (sin el join al jugador titular). Para no perder ese dato al
   * actualizar el estado local, lo combinamos con el `jugador` actual.
   */
  function applyReservaUpdate(updated: Reserva): void {
    setReserva({ ...updated, jugador: reserva.jugador });
  }

  async function handleMarcarJugada(): Promise<void> {
    setAccionError(null);
    try {
      const updated = await actualizarMutation.mutateAsync({
        id: reserva.id,
        fecha: reserva.fecha,
        changes: { estado: 'jugada' },
      });
      applyReservaUpdate(updated);
    } catch (err) {
      setAccionError(
        err instanceof Error
          ? err.message
          : 'No pudimos marcar la reserva como jugada.',
      );
    }
  }

  async function handleConfirmCancel(): Promise<void> {
    setAccionError(null);
    try {
      await actualizarMutation.mutateAsync({
        id: reserva.id,
        fecha: reserva.fecha,
        changes: { estado: 'cancelada' },
      });
      // Cerramos el dialog: el bloque desaparece de la grilla al refrescar.
      onClose();
    } catch (err) {
      setAccionError(
        err instanceof Error
          ? err.message
          : 'No pudimos cancelar la reserva.',
      );
    }
  }

  return (
    <>
      {/* Header fijo arriba */}
      <DialogHeader className="shrink-0 border-b border-border px-6 pb-4 pt-6">
        <DialogTitle>
          Reserva — {formatearFechaAmigable(reserva.fecha)}
        </DialogTitle>
        <DialogDescription>
          {cancha.nombre} · {formatearHora(reserva.hora_inicio)}–
          {formatearHora(reserva.hora_fin)} ({reserva.duracion_min} min)
        </DialogDescription>
      </DialogHeader>

      {/* Body scrolleable */}
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
        {/* Estado */}
        <div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
              estadoBadgeClasses(reserva.estado),
            )}
          >
            {ESTADO_LABEL[reserva.estado]}
          </span>
        </div>

        {/* Personas del turno: gestión de personas (paso 1b) + división
            de la cuenta (paso 3) + COBRO por persona (paso 4). Cada
            persona muestra su parte, su estado (debe / pagó / pagó
            parcial) y, si debe, un botón de Cobrar con mini-form
            inline. La RPC fn_cobrar_persona_turno valida el monto con
            p_monto_esperado para protegerse de race con cambios
            concurrentes. */}
        <PersonasTurnoSection
          reservaId={reserva.id}
          montoAlquiler={reserva.monto_total}
          fecha={reserva.fecha}
          estadoReserva={reserva.estado}
        />

        {/* Cuenta del alquiler — referencia contable compacta.
            Desde el paso 4, el cobro vive por persona en
            PersonasTurnoSection (arriba). Este bloque queda como info
            histórica del escalar monto_pagado del alquiler. Línea única,
            sin Label, jerarquía visual baja para no competir con la
            acción principal. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">
            Cuenta del alquiler
          </span>
          <span>
            Total{' '}
            <span className="font-medium tabular-nums text-foreground">
              {fmtMoney(reserva.monto_total)}
            </span>
          </span>
          <span>·</span>
          <span>
            Pagado{' '}
            <span className="font-medium tabular-nums text-foreground">
              {fmtMoney(reserva.monto_pagado)}
            </span>
          </span>
          <span>·</span>
          <span>
            Saldo{' '}
            <span
              className={cn(
                'font-semibold tabular-nums',
                tieneSaldo ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {fmtMoney(saldo)}
            </span>
          </span>
        </div>

        {/* Consumos del turno (paso 2 del módulo cuenta del turno).
            Vive aparte de la Cuenta del alquiler — la suma "alquiler +
            consumos" se muestra como chip informativo dentro de la
            sección, pero NO se unifica el saldo cobrable (eso es paso 4). */}
        <ConsumosTurnoSection
          reservaId={reserva.id}
          montoAlquiler={reserva.monto_total}
        />

        {/* Pagos */}
        <section className="space-y-2">
          <Label>Pagos</Label>
          <PagosList query={pagosQuery} />
        </section>

        {/* Observaciones */}
        <ObservacionesSection
          reserva={reserva}
          onSave={async (value) => {
            const updated = await actualizarMutation.mutateAsync({
              id: reserva.id,
              fecha: reserva.fecha,
              changes: { observaciones: value },
            });
            applyReservaUpdate(updated);
          }}
        />

      </div>

      {/*
        Footer fijo. Desde el paso 4 del módulo cuenta del turno, el
        cobro vive por persona en PersonasTurnoSection. Acá quedan dos
        acciones globales:
          - Marcar jugada (transición de estado)
          - Cancelar reserva (con confirm inline)
        El `accionError` queda arriba del contenido del footer cuando
        hay un error en las acciones globales.
      */}
      <div className="shrink-0 space-y-3 border-t border-border px-6 py-4">
        {accionError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {accionError}
          </div>
        )}

        {confirmingCancel ? (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  ¿Cancelar esta reserva?
                </p>
                <p className="text-xs text-muted-foreground">
                  Esta acción no se puede deshacer. Los pagos registrados
                  no se reversan automáticamente y quedan como evidencia
                  (si hace falta, se gestiona desde Caja más adelante).
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmingCancel(false)}
                disabled={actualizarMutation.isPending}
              >
                No, mantener
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  void handleConfirmCancel();
                }}
                disabled={actualizarMutation.isPending}
              >
                {actualizarMutation.isPending ? 'Cancelando…' : 'Sí, cancelar'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {puedeMarcarJugada && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void handleMarcarJugada();
                }}
                disabled={actualizarMutation.isPending}
              >
                Marcar jugada
              </Button>
            )}
            {puedeCancelar && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAccionError(null);
                  setConfirmingCancel(true);
                }}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Cancelar reserva
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────

function PagosList({
  query,
}: {
  query: ReturnType<typeof useReservaPagos>;
}) {
  if (query.isLoading) {
    return (
      <div className="h-10 animate-pulse rounded-md border border-border bg-muted/40" />
    );
  }
  if (query.error) {
    return (
      <p className="text-xs text-destructive" role="alert">
        {query.error.message}
      </p>
    );
  }
  const pagos = query.data ?? [];
  if (pagos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {pagos.map((p) => (
        <PagoRow key={p.id} pago={p} />
      ))}
    </ul>
  );
}

function PagoRow({ pago }: { pago: ReservaPago }) {
  const tipoLabel =
    pago.tipo === 'sena'
      ? 'Seña'
      : pago.tipo === 'reembolso'
        ? 'Reembolso'
        : 'Pago';

  // Desglose mini (paso 4): si el pago tiene parte de consumo, muestro
  // "alq + buf"; si no, sólo el de alquiler. Discreto, debajo de la
  // línea principal.
  const tieneConsumo = pago.monto_consumo > 0;

  return (
    <li className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {tipoLabel}
        </span>
        <span className="font-medium tabular-nums text-foreground">
          {fmtMoney(pago.monto)}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {MEDIO_PAGO_LABEL[pago.medio_pago]}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">
          {fmtFechaHoraCorta(pago.fecha_hora)}
        </span>
        {pago.observaciones && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-xs italic text-muted-foreground">
              {pago.observaciones}
            </span>
          </>
        )}
      </div>
      <div className="pl-1 text-[11px] tabular-nums text-muted-foreground">
        {tieneConsumo
          ? `${fmtMoney(pago.monto_alquiler)} alquiler + ${fmtMoney(pago.monto_consumo)} buffet`
          : `${fmtMoney(pago.monto_alquiler)} alquiler`}
      </div>
    </li>
  );
}

interface ObservacionesSectionProps {
  reserva: ReservaConTitular;
  onSave: (value: string | null) => Promise<void>;
}

function ObservacionesSection({ reserva, onSave }: ObservacionesSectionProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reserva.observaciones ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const trimmed = value.trim();
      await onSave(trimmed === '' ? null : trimmed);
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos guardar las observaciones.',
      );
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Observaciones</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(reserva.observaciones ?? '');
              setError(null);
              setEditing(true);
            }}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Editar
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {reserva.observaciones ?? (
            <span className="italic">Sin observaciones.</span>
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <Label htmlFor="reserva-obs-edit">Observaciones</Label>
      <textarea
        id="reserva-obs-edit"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        rows={3}
        maxLength={500}
        placeholder="Notas internas del turno…"
        className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void handleSave();
          }}
          disabled={pending}
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </section>
  );
}

