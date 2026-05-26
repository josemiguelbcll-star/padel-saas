import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useTarifas } from '@/features/configuracion/hooks/useTarifas';
import type { Cancha, Tarifa } from '@/types/database';
import {
  JugadorAutocomplete,
  type JugadorSeleccionado,
} from './JugadorAutocomplete';
import { useCrearReserva, type CrearReservaInput } from './hooks/useCrearReserva';
import {
  ESTADOS_INICIALES,
  MEDIOS_PAGO,
  nuevaReservaCamposSchema,
  type EstadoInicial,
  type MedioPagoForm,
} from './nuevaReservaSchema';
import {
  formatearFechaAmigable,
  formatearHora,
} from './index';
import { resolverTarifa } from './utils/resolverTarifa';

export interface NuevoReservaSlot {
  cancha: Cancha;
  /** 'YYYY-MM-DD' */
  fecha: string;
  /** 'HH:MM:SS' */
  hora: string;
  /**
   * Duraciones (minutos) que la franja permite arrancando en este inicio.
   * ≥1. Si hay más de una, el modal deja elegir; si hay una, va directo.
   */
  duracionesPermitidas: number[];
}

interface NuevaReservaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: NuevoReservaSlot | null;
}

/**
 * Modal para crear una reserva nueva. Se abre con un slot pre-cargado
 * (cancha + fecha + hora + duraciones que la franja permite). Si la franja
 * ofrece más de una duración, el usuario elige; si ofrece una, va directo.
 * La tarifa sugerida sale de resolverTarifa (por franja horaria — todavía
 * NO depende de la duración; eso es el próximo proyecto) y es editable a
 * mano. Dispara la RPC fn_crear_reserva al confirmar.
 */
export function NuevaReservaDialog({
  open,
  onOpenChange,
  slot,
}: NuevaReservaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {slot && (
          <NuevaReservaBody
            // Remount al cambiar de slot: state interno arranca limpio
            // y el useMemo de tarifa recalcula.
            key={`${slot.cancha.id}-${slot.fecha}-${slot.hora}`}
            slot={slot}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────

const MAX_ACOMPAÑANTES = 3;

const MEDIO_PAGO_LABEL: Record<MedioPagoForm, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

const ESTADO_LABEL: Record<EstadoInicial, string> = {
  pendiente: 'Pendiente',
  senada: 'Señado',
  pagada: 'Pagado',
};

interface NuevaReservaBodyProps {
  slot: NuevoReservaSlot;
  onDone: () => void;
}

type FieldErrors = Partial<
  Record<
    | 'titular'
    | 'monto_total'
    | 'estado'
    | 'monto_pagado'
    | 'medio_pago'
    | 'form',
    string
  >
>;

function NuevaReservaBody({ slot, onDone }: NuevaReservaBodyProps) {
  const tarifasQuery = useTarifas();
  const crearMutation = useCrearReserva();

  // Necesitamos tarifas para sembrar el monto sugerido. Si está cargando
  // mostramos un skeleton compacto. Horarios y franjas ya no se usan
  // acá (duración del partido es fija = DURACION_PARTIDO_MIN).
  if (tarifasQuery.isLoading) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Nueva reserva</DialogTitle>
          <DialogDescription>Cargando tarifas del club…</DialogDescription>
        </DialogHeader>
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <NuevaReservaBodyReady
      slot={slot}
      onDone={onDone}
      tarifas={tarifasQuery.data ?? []}
      crearMutation={crearMutation}
    />
  );
}

interface NuevaReservaBodyReadyProps {
  slot: NuevoReservaSlot;
  onDone: () => void;
  tarifas: Tarifa[];
  crearMutation: ReturnType<typeof useCrearReserva>;
}

function NuevaReservaBodyReady({
  slot,
  onDone,
  tarifas,
  crearMutation,
}: NuevaReservaBodyReadyProps) {
  // Duración elegida. Default: la más corta que ofrece la franja en este
  // inicio (= la altura del bloque "Disponible"). Si la franja ofrece una
  // sola, queda fija en ésa.
  const [duracion, setDuracion] = useState<number>(
    slot.duracionesPermitidas[0] ?? 90,
  );

  // Tarifa sugerida por (fecha, hora, DURACIÓN). Recalcula al cambiar la
  // duración → tarifa 2D (0051): resolverTarifa filtra por duración y la
  // tarifa específica de esa duración gana sobre la de "cualquier duración".
  const tarifaResuelta = useMemo(
    () =>
      resolverTarifa({
        fecha: slot.fecha,
        hora: slot.hora,
        tarifas,
        duracion,
      }),
    [slot.fecha, slot.hora, tarifas, duracion],
  );

  const [titular, setTitular] = useState<JugadorSeleccionado | null>(null);
  const [acompañantes, setAcompañantes] = useState<
    Array<JugadorSeleccionado | null>
  >([]);
  const [montoTotal, setMontoTotal] = useState<string>(
    tarifaResuelta.monto.toString(),
  );
  // Si el usuario editó el monto a mano, no lo pisamos al recalcular la
  // tarifa por duración (espejo de montoPagadoTouched).
  const [montoTotalTouched, setMontoTotalTouched] = useState(false);
  const [estado, setEstado] = useState<EstadoInicial>('pendiente');
  const [montoPagado, setMontoPagado] = useState<string>('0');
  const [montoPagadoTouched, setMontoPagadoTouched] = useState(false);
  const [medioPago, setMedioPago] = useState<MedioPagoForm | null>(null);
  const [observaciones, setObservaciones] = useState<string>('');
  const [errors, setErrors] = useState<FieldErrors>({});

  // Re-seed del monto sugerido cuando cambia la tarifa resuelta (p.ej. al
  // cambiar la duración en el selector) — salvo que el usuario lo haya
  // editado a mano. Mantiene el monto pagado en sync si está "pagada".
  useEffect(() => {
    if (montoTotalTouched) return;
    const sugerido = tarifaResuelta.monto.toString();
    setMontoTotal(sugerido);
    if (estado === 'pagada' && !montoPagadoTouched) {
      setMontoPagado(sugerido);
    }
  }, [tarifaResuelta.monto, montoTotalTouched, estado, montoPagadoTouched]);

  function cambiarEstado(nuevo: EstadoInicial): void {
    setEstado(nuevo);
    setMontoPagadoTouched(false);
    setErrors((e) => ({ ...e, monto_pagado: undefined, medio_pago: undefined }));
    if (nuevo === 'pendiente') {
      setMontoPagado('0');
      setMedioPago(null);
    } else if (nuevo === 'senada') {
      setMontoPagado('');
      // Sugerencia: efectivo como medio por defecto, el más usado.
      setMedioPago((m) => m ?? 'efectivo');
    } else if (nuevo === 'pagada') {
      setMontoPagado(montoTotal);
      setMedioPago((m) => m ?? 'efectivo');
    }
  }

  function cambiarMontoTotal(nuevo: string): void {
    // Edición manual: a partir de acá no re-seedeamos el monto al cambiar
    // la duración (lo respeta el efecto de arriba).
    setMontoTotalTouched(true);
    setMontoTotal(nuevo);
    // Si estamos en "pagada" y el usuario no editó manualmente el monto
    // pagado, mantenerlo en sync con el total.
    if (estado === 'pagada' && !montoPagadoTouched) {
      setMontoPagado(nuevo);
    }
  }

  function addAcompañante(): void {
    if (acompañantes.length >= MAX_ACOMPAÑANTES) return;
    setAcompañantes((prev) => [...prev, null]);
  }

  function removeAcompañante(idx: number): void {
    setAcompañantes((prev) => prev.filter((_, i) => i !== idx));
  }

  function setAcompañante(
    idx: number,
    value: JugadorSeleccionado | null,
  ): void {
    setAcompañantes((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    // 1. Validar titular en el componente (el schema zod no lo cubre).
    if (!titular || titular.kind !== 'jugador') {
      setErrors({
        titular:
          'Elegí un titular de la lista o creá una ficha nueva con su nombre.',
      });
      return;
    }

    // 2. Validar el resto con zod.
    const datos = {
      monto_total: montoTotal,
      estado,
      monto_pagado: montoPagado,
      medio_pago: medioPago,
      observaciones: observaciones.trim() === '' ? null : observaciones.trim(),
    };
    const parsed = nuevaReservaCamposSchema.safeParse(datos);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          field === 'monto_total' ||
          field === 'estado' ||
          field === 'monto_pagado' ||
          field === 'medio_pago'
        ) {
          fieldErrors[field] = issue.message;
        } else {
          fieldErrors.form = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    // 3. Particionar acompañantes en jugadores_ids vs nombres_libres.
    const jugadoresIds: number[] = [];
    const nombresLibres: string[] = [];
    for (const a of acompañantes) {
      if (!a) continue;
      if (a.kind === 'jugador') {
        jugadoresIds.push(a.jugadorId);
      } else if (a.nombre.trim() !== '') {
        nombresLibres.push(a.nombre.trim());
      }
    }

    // 4. Armar input para la RPC. Duración = la elegida por el usuario.
    //    La RPC calcula hora_fin = hora_inicio + duracion_min server-side.
    const input: CrearReservaInput = {
      cancha_id: slot.cancha.id,
      fecha: slot.fecha,
      hora_inicio: slot.hora,
      duracion_min: duracion,
      jugador_titular_id: titular.jugadorId,
      jugadores_ids: jugadoresIds,
      nombres_libres: nombresLibres,
      tarifa_id: tarifaResuelta.tarifa?.id ?? null,
      monto_total: parsed.data.monto_total,
      monto_pagado: parsed.data.monto_pagado,
      medio_pago: parsed.data.medio_pago,
      estado: parsed.data.estado,
      observaciones: parsed.data.observaciones,
    };

    try {
      await crearMutation.mutateAsync(input);
      onDone();
    } catch (err) {
      setErrors({
        form:
          err instanceof Error
            ? err.message
            : 'No pudimos crear la reserva. Probá de nuevo.',
      });
    }
  }

  const isPending = crearMutation.isPending;
  const muestraPago = estado === 'senada' || estado === 'pagada';

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nueva reserva</DialogTitle>
        <DialogDescription>
          {formatearFechaAmigable(slot.fecha)} · {slot.cancha.nombre} ·{' '}
          {formatearHora(slot.hora)} ({duracion} min)
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Duración (si la franja ofrece >1, el usuario elige; si ofrece
            una, queda fija en ésa). */}
        <div className="space-y-2">
          <Label>Duración</Label>
          <div className="flex flex-wrap gap-1.5">
            {slot.duracionesPermitidas.map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => setDuracion(min)}
                disabled={isPending}
                aria-pressed={duracion === min}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  duracion === min
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {min} min
              </button>
            ))}
          </div>
          {slot.duracionesPermitidas.length === 1 && (
            <p className="text-[11px] text-muted-foreground">
              Esta franja permite turnos de {slot.duracionesPermitidas[0]} min.
            </p>
          )}
        </div>

        {/* Titular */}
        <div className="space-y-2">
          <Label htmlFor="reserva-titular">Titular</Label>
          <JugadorAutocomplete
            id="reserva-titular"
            value={titular}
            onChange={setTitular}
            permitirNombreLibre={false}
            autoFocus
            disabled={isPending}
            placeholder="Empezá a escribir el nombre…"
            aria-label="Titular de la reserva"
          />
          {errors.titular && (
            <p className="text-xs text-destructive">{errors.titular}</p>
          )}
        </div>

        {/* Acompañantes */}
        {acompañantes.length > 0 && (
          <div className="space-y-2">
            <Label>Acompañantes</Label>
            {acompañantes.map((a, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex-1">
                  <JugadorAutocomplete
                    value={a}
                    onChange={(v) => setAcompañante(idx, v)}
                    permitirNombreLibre
                    disabled={isPending}
                    placeholder={`Acompañante ${idx + 1}`}
                    aria-label={`Acompañante ${idx + 1}`}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAcompañante(idx)}
                  disabled={isPending}
                  aria-label={`Quitar acompañante ${idx + 1}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        {acompañantes.length < MAX_ACOMPAÑANTES && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addAcompañante}
            disabled={isPending}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar acompañante
          </Button>
        )}

        {/* Monto */}
        <div className="space-y-2">
          <Label htmlFor="reserva-monto">Monto (pesos)</Label>
          <Input
            id="reserva-monto"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={montoTotal}
            onChange={(e) => cambiarMontoTotal(e.target.value)}
            disabled={isPending}
            aria-invalid={errors.monto_total ? true : undefined}
            placeholder="0.00"
          />
          {errors.monto_total && (
            <p className="text-xs text-destructive">{errors.monto_total}</p>
          )}
          {!tarifaResuelta.tarifa && (
            <p className="text-xs text-muted-foreground">
              Sin tarifa configurada para este horario. Ingresá el monto a mano.
            </p>
          )}
          {tarifaResuelta.tarifa && (
            <p className="text-xs text-muted-foreground">
              Tarifa sugerida: <span className="font-medium text-foreground">{tarifaResuelta.tarifa.nombre}</span>
            </p>
          )}
        </div>

        {/* Estado */}
        <div className="space-y-2">
          <Label>Estado</Label>
          <div className="flex flex-wrap gap-1.5">
            {ESTADOS_INICIALES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => cambiarEstado(e)}
                disabled={isPending}
                aria-pressed={estado === e}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  estado === e
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {ESTADO_LABEL[e]}
              </button>
            ))}
          </div>
        </div>

        {/* Pago (sólo si señado o pagado) */}
        {muestraPago && (
          <div className="space-y-4 rounded-md border border-border bg-muted/20 p-3">
            <div className="space-y-2">
              <Label htmlFor="reserva-monto-pagado">Monto pagado</Label>
              <Input
                id="reserva-monto-pagado"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={montoPagado}
                onChange={(e) => {
                  setMontoPagado(e.target.value);
                  setMontoPagadoTouched(true);
                }}
                disabled={isPending}
                aria-invalid={errors.monto_pagado ? true : undefined}
                placeholder={estado === 'senada' ? 'Lo que cobraste de seña' : montoTotal}
              />
              {errors.monto_pagado && (
                <p className="text-xs text-destructive">{errors.monto_pagado}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Medio de pago</Label>
              <div className="flex flex-wrap gap-1.5">
                {MEDIOS_PAGO.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMedioPago(m)}
                    disabled={isPending}
                    aria-pressed={medioPago === m}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      medioPago === m
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    {MEDIO_PAGO_LABEL[m]}
                  </button>
                ))}
              </div>
              {errors.medio_pago && (
                <p className="text-xs text-destructive">{errors.medio_pago}</p>
              )}
            </div>
          </div>
        )}

        {/* Observaciones */}
        <div className="space-y-2">
          <Label htmlFor="reserva-obs">Observaciones (opcional)</Label>
          <Input
            id="reserva-obs"
            type="text"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            disabled={isPending}
            maxLength={500}
            placeholder="Notas internas del turno…"
          />
        </div>

        {errors.form && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {errors.form}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onDone}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Creando…' : 'Crear reserva'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
