import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth/useSession';
import type { Cancha, ClaseCobro, MedioPago } from '@/types/database';
import type { ClaseConProfesor } from '@/features/configuracion/hooks/useClases';
import { useTarifasClases } from '@/features/configuracion/hooks/useTarifasClases';
import { useBorrarCobroClase } from './hooks/useBorrarCobroClase';
import { useCobrarClase } from './hooks/useCobrarClase';
import { formatearFechaAmigable } from './utils/fechaUtils';
import { formatearHora, sumarMinutos } from './utils/horaUtils';
import { resolverTarifa } from './utils/resolverTarifa';

// ─────────────────────────────────────────────────────────────────────
// Constantes y helpers locales
// ─────────────────────────────────────────────────────────────────────

const MEDIOS_PAGO_LIST: readonly MedioPago[] = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'otro',
] as const;

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

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

interface DetalleClaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clase: ClaseConProfesor | null;
  cancha: Cancha | null;
  /** 'YYYY-MM-DD' — fecha puntual de la ocurrencia. */
  fecha: string | null;
  /** Pagos existentes para (clase, fecha). Vacío si nunca se cobró. */
  pagosIniciales: ClaseCobro[];
}

/**
 * Modal de detalle de una ocurrencia de clase. Desde la migración 0008
 * una ocurrencia puede tener 0/1/N pagos: el dialog muestra el
 * historial, la suma cobrada, y permite agregar nuevos pagos. Admin
 * además puede borrar pagos individuales (con confirmación inline).
 *
 * El precio configurado en `clases.precio` es solo SUGERENCIA: pre-llena
 * el monto del nuevo pago pero el vendedor lo edita libremente. No hay
 * total fijo a alcanzar.
 *
 * Tras add/delete actualiza el state local de `pagos` para reflejar sin
 * recargar; las invalidaciones de los hooks también re-sincronizan la
 * grilla (tilde).
 */
export function DetalleClaseDialog({
  open,
  onOpenChange,
  clase,
  cancha,
  fecha,
  pagosIniciales,
}: DetalleClaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {clase && cancha && fecha && (
          <DetalleClaseBody
            // Remount al cambiar de (clase, fecha): el form, el confirm de
            // borrar y la lista local arrancan limpios.
            key={`${clase.id}-${fecha}`}
            clase={clase}
            cancha={cancha}
            fecha={fecha}
            pagosIniciales={pagosIniciales}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DetalleClaseBodyProps {
  clase: ClaseConProfesor;
  cancha: Cancha;
  fecha: string;
  pagosIniciales: ClaseCobro[];
  onClose: () => void;
}

function DetalleClaseBody({
  clase,
  cancha,
  fecha,
  pagosIniciales,
  onClose,
}: DetalleClaseBodyProps) {
  const { user } = useSession();
  // Gateo cosmético del botón "Borrar". La seguridad real la da la RLS
  // clase_cobros_delete_solo_admin. Aunque un vendedor lograra disparar
  // el DELETE, postgres lo rechaza con 42501.
  const isAdmin = user?.rol === 'admin';

  // Estado local de pagos: arranca con la prop, se actualiza al
  // agregar/borrar para reflejar sin esperar al refetch.
  const [pagos, setPagos] = useState<ClaseCobro[]>(pagosIniciales);

  // State del mini-form de agregar pago (oculto por default).
  // Modelo B (0035): el monto YA NO se ingresa — se resuelve server-side
  // desde la tarifa de clase vigente para (fecha, clase.hora_inicio).
  const [agregando, setAgregando] = useState(false);
  const [medio, setMedio] = useState<MedioPago | null>('efectivo');
  const [obs, setObs] = useState<string>('');
  const [agregarError, setAgregarError] = useState<string | null>(null);

  // State del confirm inline de borrar pago.
  const [borrandoId, setBorrandoId] = useState<number | null>(null);
  const [borrarError, setBorrarError] = useState<string | null>(null);

  const cobrarMutation = useCobrarClase();
  const borrarMutation = useBorrarCobroClase();

  // Tarifa de clase resuelta client-side para (fecha, hora_clase).
  // Es el monto que el server va a usar al cobrar. Lo mostramos como
  // referencia + deshabilita el botón si no hay tarifa que cubra el slot.
  // El server vuelve a resolver al cobrar (red última); este cálculo
  // client-side solo guía la UX.
  const tarifasClasesQuery = useTarifasClases();
  const alquilerResuelto = useMemo(
    () =>
      resolverTarifa({
        fecha,
        hora: clase.hora_inicio,
        tarifas: tarifasClasesQuery.data ?? [],
      }),
    [fecha, clase.hora_inicio, tarifasClasesQuery.data],
  );
  const tarifasLoading = tarifasClasesQuery.isLoading;
  const sinTarifa = !tarifasLoading && alquilerResuelto.tarifa === null;

  const profesorNombre = clase.profesor?.nombre ?? 'Sin profesor';
  const horaInicio = formatearHora(clase.hora_inicio);
  const horaFin = formatearHora(
    sumarMinutos(clase.hora_inicio, clase.duracion_min),
  );

  const totalCobrado = pagos.reduce((sum, p) => sum + p.monto, 0);

  function resetMiniForm(): void {
    setMedio('efectivo');
    setObs('');
    setAgregarError(null);
  }

  async function handleAgregar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAgregarError(null);

    if (!medio) {
      setAgregarError('Elegí un medio de pago.');
      return;
    }
    // Modelo B: el server resuelve el monto. Lo bloqueamos client-side
    // solo si sabemos seguro que no hay tarifa (mejor UX). Si la query
    // de tarifas todavía está cargando, dejamos pasar y que el server
    // sea la verdad última.
    if (sinTarifa) {
      setAgregarError(
        'No hay tarifa de clase configurada para este horario. Configurala en Configuración → Tarifas (pestaña Clases) antes de cobrar.',
      );
      return;
    }

    try {
      const nuevoCobro = await cobrarMutation.mutateAsync({
        clase_id: clase.id,
        fecha,
        medio_pago: medio,
        observaciones: obs.trim() === '' ? null : obs.trim(),
      });
      // Apend al state local — la lista se ve actualizada al instante.
      setPagos((prev) => [...prev, nuevoCobro]);
      setAgregando(false);
      resetMiniForm();
    } catch (err) {
      setAgregarError(
        err instanceof Error
          ? err.message
          : 'No pudimos registrar el pago.',
      );
    }
  }

  async function handleConfirmBorrar(cobroId: number): Promise<void> {
    setBorrarError(null);
    try {
      await borrarMutation.mutateAsync({ cobroId, fecha });
      setPagos((prev) => prev.filter((p) => p.id !== cobroId));
      setBorrandoId(null);
    } catch (err) {
      setBorrarError(
        err instanceof Error
          ? err.message
          : 'No pudimos borrar el pago.',
      );
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Clase — {formatearFechaAmigable(fecha)}
        </DialogTitle>
        <DialogDescription>
          {cancha.nombre} · {horaInicio}–{horaFin} ({clase.duracion_min} min)
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        {/* Detalles de la clase */}
        <section className="space-y-2">
          <Label>Detalles</Label>
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <Row label="Profesor" value={profesorNombre} />
            {clase.nombre && <Row label="Nombre" value={clase.nombre} />}
            <Row
              label="Alquiler"
              value={
                tarifasLoading
                  ? '—'
                  : alquilerResuelto.tarifa
                    ? fmtMoney(alquilerResuelto.monto)
                    : 'Sin tarifa configurada'
              }
            />
          </div>
        </section>

        {/* Cobrado: suma total de todos los pagos */}
        <section className="space-y-2">
          <Label>Cobrado</Label>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">Total</span>
              <span
                className={cn(
                  'text-base font-semibold tabular-nums',
                  totalCobrado > 0 ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {fmtMoney(totalCobrado)}
              </span>
            </div>
          </div>
        </section>

        {/* Historial de pagos */}
        <section className="space-y-2">
          <Label>Pagos</Label>
          {pagos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin pagos registrados.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {pagos.map((p) => (
                <PagoRow
                  key={p.id}
                  pago={p}
                  isAdmin={isAdmin}
                  isConfirming={borrandoId === p.id}
                  isPending={
                    borrarMutation.isPending && borrandoId === p.id
                  }
                  onBorrarRequest={() => {
                    setBorrarError(null);
                    setBorrandoId(p.id);
                  }}
                  onBorrarConfirm={() => {
                    void handleConfirmBorrar(p.id);
                  }}
                  onBorrarCancel={() => setBorrandoId(null)}
                />
              ))}
            </ul>
          )}
          {borrarError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {borrarError}
            </div>
          )}
        </section>

        {/* Agregar pago: toggle + mini-form. Modelo B: sin input de
            monto — el server resuelve desde la tarifa de clase. El
            botón Cobrar se deshabilita si no hay tarifa configurada. */}
        {!agregando && (
          <div className="space-y-2">
            {sinTarifa && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs"
              >
                <ShieldAlert
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                  aria-hidden="true"
                />
                <p>
                  No hay <strong>tarifa de clase</strong> configurada para este
                  horario. Configurala en <em>Configuración → Tarifas
                  (pestaña Clases)</em> antes de cobrar.
                </p>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetMiniForm();
                setAgregando(true);
              }}
              disabled={tarifasLoading || sinTarifa}
            >
              <Plus className="h-3.5 w-3.5" />
              {tarifasLoading ? 'Cargando tarifa…' : 'Agregar pago'}
            </Button>
          </div>
        )}

        {agregando && (
          <form
            onSubmit={handleAgregar}
            className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
            noValidate
          >
            <h4 className="text-sm font-medium text-foreground">Nuevo pago</h4>

            {/* Monto resuelto (read-only): el server usa este valor desde
                la tarifa de clase vigente. */}
            <div className="space-y-1.5">
              <Label className="text-xs">Alquiler de cancha</Label>
              <div className="flex items-baseline justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  Resuelto desde la tarifa de clase
                </span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {alquilerResuelto.tarifa
                    ? fmtMoney(alquilerResuelto.monto)
                    : '—'}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                El monto lo define la tarifa de clase vigente para{' '}
                {formatearFechaAmigable(fecha)} a las {horaInicio}.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Medio de pago</Label>
              <div className="flex flex-wrap gap-1">
                {MEDIOS_PAGO_LIST.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMedio(m)}
                    disabled={cobrarMutation.isPending}
                    aria-pressed={medio === m}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      medio === m
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    {MEDIO_PAGO_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cobrar-clase-obs" className="text-xs">
                Observaciones (opcional)
              </Label>
              <Input
                id="cobrar-clase-obs"
                type="text"
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                disabled={cobrarMutation.isPending}
                maxLength={500}
                placeholder="Ej: pago parcial, queda saldo"
              />
            </div>

            {agregarError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
              >
                {agregarError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setAgregando(false);
                  resetMiniForm();
                }}
                disabled={cobrarMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={cobrarMutation.isPending || sinTarifa}
              >
                {cobrarMutation.isPending ? 'Cobrando…' : 'Cobrar'}
              </Button>
            </div>
          </form>
        )}

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────

interface PagoRowProps {
  pago: ClaseCobro;
  isAdmin: boolean;
  isConfirming: boolean;
  isPending: boolean;
  onBorrarRequest: () => void;
  onBorrarConfirm: () => void;
  onBorrarCancel: () => void;
}

function PagoRow({
  pago,
  isAdmin,
  isConfirming,
  isPending,
  onBorrarRequest,
  onBorrarConfirm,
  onBorrarCancel,
}: PagoRowProps) {
  if (isConfirming) {
    return (
      <li className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              ¿Borrar este pago?
            </p>
            <p className="text-xs text-muted-foreground">
              {fmtMoney(pago.monto)} · {MEDIO_PAGO_LABEL[pago.medio_pago]} ·{' '}
              {fmtFechaHoraCorta(pago.fecha_hora)}. La acción no se puede
              deshacer.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBorrarCancel}
            disabled={isPending}
          >
            No, mantener
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onBorrarConfirm}
            disabled={isPending}
          >
            {isPending ? 'Borrando…' : 'Sí, borrar'}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
      {isAdmin && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBorrarRequest}
          className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Borrar pago de ${fmtMoney(pago.monto)}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
