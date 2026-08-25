import { useMemo, useState, type FormEvent, useEffect } from 'react';
import { AlertTriangle, Plus, ShieldAlert, Trash2, Users } from 'lucide-react';
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
import { useClaseOcurrencia } from './hooks/useClaseOcurrencia';
import { useCrearClaseOcurrencia } from './hooks/useCrearClaseOcurrencia';
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
  cuenta_corriente: 'Cuenta Corriente',
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
  fecha: string | null;
  pagosIniciales: ClaseCobro[];
  readOnly?: boolean;
}

export function DetalleClaseDialog({
  open,
  onOpenChange,
  clase,
  cancha,
  fecha,
  pagosIniciales,
  readOnly,
}: DetalleClaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {clase && cancha && fecha && (
          <DetalleClaseBody
            key={`${clase.id}-${fecha}`}
            clase={clase}
            cancha={cancha}
            fecha={fecha}
            pagosIniciales={pagosIniciales}
            onClose={() => onOpenChange(false)}
            readOnly={readOnly}
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
  readOnly?: boolean;
}

function DetalleClaseBody({
  clase,
  cancha,
  fecha,
  pagosIniciales,
  onClose,
  readOnly,
}: DetalleClaseBodyProps) {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin' && !readOnly;

  const [pagos, setPagos] = useState<ClaseCobro[]>(pagosIniciales);

  // Ocurrencia y Alumnos
  const ocurrenciaQuery = useClaseOcurrencia(clase.id, fecha);
  const crearOcurrenciaMutation = useCrearClaseOcurrencia();
  const ocurrencia = ocurrenciaQuery.data;
  
  const [cantidadAlumnos, setCantidadAlumnos] = useState<number>(1);
  const [alumnosInputStr, setAlumnosInputStr] = useState('1');
  const [montoOverrideStr, setMontoOverrideStr] = useState<string>('');

  // Mini-form de agregar pago
  const [agregando, setAgregando] = useState(false);
  const [montoPago, setMontoPago] = useState<string>('');
  const [medio, setMedio] = useState<MedioPago | null>('efectivo');
  const [obs, setObs] = useState<string>('');
  const [agregarError, setAgregarError] = useState<string | null>(null);

  // Confirm inline de borrar pago
  const [borrandoId, setBorrandoId] = useState<number | null>(null);
  const [borrarError, setBorrarError] = useState<string | null>(null);

  const cobrarMutation = useCobrarClase();
  const borrarMutation = useBorrarCobroClase();

  const tarifasClasesQuery = useTarifasClases();
  const tarifasLoading = tarifasClasesQuery.isLoading || ocurrenciaQuery.isLoading;

  const alquilerResuelto = useMemo(
    () =>
      resolverTarifa({
        fecha,
        hora: clase.hora_inicio,
        tarifas: tarifasClasesQuery.data ?? [],
        cantidad_alumnos: ocurrencia ? ocurrencia.cantidad_alumnos : cantidadAlumnos,
      }),
    [fecha, clase.hora_inicio, tarifasClasesQuery.data, ocurrencia, cantidadAlumnos],
  );

  useEffect(() => {
    if (!ocurrencia && alquilerResuelto.monto !== undefined) {
      setMontoOverrideStr(alquilerResuelto.monto.toString());
    }
  }, [alquilerResuelto.monto, ocurrencia]);

  const sinTarifa = !tarifasLoading && alquilerResuelto.tarifa === null;
  const montoTotalAlquiler = ocurrencia ? ocurrencia.monto_total : alquilerResuelto.monto;
  const totalCobrado = pagos.reduce((sum, p) => sum + p.monto, 0);
  const saldoPendiente = Math.max(0, montoTotalAlquiler - totalCobrado);

  const profesorNombre = clase.profesor?.nombre ?? 'Sin profesor';
  const horaInicio = formatearHora(clase.hora_inicio);
  const horaFin = formatearHora(sumarMinutos(clase.hora_inicio, clase.duracion_min));

  // Initialize montoPago when opening the form
  useEffect(() => {
    if (agregando) {
      setMontoPago(saldoPendiente > 0 ? saldoPendiente.toString() : '');
    }
  }, [agregando, saldoPendiente]);

  function resetMiniForm(): void {
    setMedio('efectivo');
    setMontoPago('');
    setObs('');
    setAgregarError(null);
  }

  async function handleCrearOcurrencia(e: FormEvent) {
    e.preventDefault();
    if (sinTarifa && !montoOverrideStr) return;
    
    const montoFinal = parseFloat(montoOverrideStr);
    if (isNaN(montoFinal) || montoFinal < 0) {
      return;
    }

    try {
      await crearOcurrenciaMutation.mutateAsync({
        clase_id: clase.id,
        fecha: fecha,
        cantidad_alumnos: cantidadAlumnos,
        monto_total: montoFinal,
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAgregar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAgregarError(null);

    if (!medio) {
      setAgregarError('Elegí un medio de pago.');
      return;
    }
    
    const montoParsed = parseFloat(montoPago);
    if (isNaN(montoParsed) || montoParsed <= 0) {
      setAgregarError('Ingresá un monto válido a cobrar.');
      return;
    }

    try {
      const nuevoCobro = await cobrarMutation.mutateAsync({
        clase_id: clase.id,
        fecha,
        monto: montoParsed,
        medio_pago: medio,
        observaciones: obs.trim() === '' ? null : obs.trim(),
      });
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
        <section className="space-y-2">
          <Label>Detalles</Label>
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <Row label="Profesor" value={profesorNombre} />
            {clase.nombre && <Row label="Nombre" value={clase.nombre} />}
            {ocurrencia && (
              <Row label="Alumnos asisten" value={ocurrencia.cantidad_alumnos.toString()} />
            )}
            <Row
              label="Alquiler total"
              value={
                tarifasLoading
                  ? '—'
                  : sinTarifa
                    ? 'Sin tarifa configurada'
                    : fmtMoney(montoTotalAlquiler)
              }
            />
          </div>
        </section>

        {!ocurrencia && !tarifasLoading && (
          <section className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-4">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Confirmar asistencia
            </h4>
            <p className="text-xs text-muted-foreground">
              Para cobrar esta clase, primero debes indicar cuántos alumnos asistieron.
              El precio se calculará automáticamente según tus tarifas escalonadas.
            </p>
            <form onSubmit={handleCrearOcurrencia} className="flex items-end gap-3 pt-2">
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Cantidad de alumnos</Label>
                <Input 
                  type="number" 
                  min={1} 
                  value={alumnosInputStr} 
                  onChange={(e) => {
                    setAlumnosInputStr(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n > 0) setCantidadAlumnos(n);
                  }}
                  disabled={crearOcurrenciaMutation.isPending}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">Costo resultante</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={montoOverrideStr}
                    onChange={(e) => setMontoOverrideStr(e.target.value)}
                    disabled={crearOcurrenciaMutation.isPending}
                    className="h-9 font-medium"
                    placeholder={sinTarifa ? "0.00" : alquilerResuelto.monto.toString()}
                  />
                </div>
              </div>
              <Button type="submit" disabled={crearOcurrenciaMutation.isPending || (sinTarifa && !montoOverrideStr)}>
                Confirmar
              </Button>
            </form>
            {sinTarifa && !montoOverrideStr && (
               <div role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                <p>No hay tarifa configurada para esta cantidad de alumnos en este horario.</p>
              </div>
            )}
          </section>
        )}

        {ocurrencia && (
          <>
            <section className="space-y-2">
              <Label>Estado de cuenta</Label>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Total cobrado</span>
                  <span
                    className={cn(
                      'text-base font-semibold tabular-nums',
                      totalCobrado > 0 ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {fmtMoney(totalCobrado)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-1">
                  <span className="text-muted-foreground">Saldo pendiente</span>
                  <span className={cn('text-sm font-medium tabular-nums', saldoPendiente > 0 ? 'text-amber-600 dark:text-amber-500' : 'text-green-600 dark:text-green-500')}>
                    {saldoPendiente > 0 ? fmtMoney(saldoPendiente) : 'Saldado'}
                  </span>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <Label>Pagos realizados</Label>
              {pagos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin pagos registrados.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {pagos.map((p) => (
                    <PagoRow
                      key={p.id}
                      pago={p}
                      isAdmin={isAdmin}
                      isConfirming={borrandoId === p.id}
                      isPending={borrarMutation.isPending && borrandoId === p.id}
                      onBorrarRequest={() => {
                        setBorrarError(null);
                        setBorrandoId(p.id);
                      }}
                      onBorrarConfirm={() => void handleConfirmBorrar(p.id)}
                      onBorrarCancel={() => setBorrandoId(null)}
                    />
                  ))}
                </ul>
              )}
              {borrarError && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                  {borrarError}
                </div>
              )}
            </section>

            {!agregando && !readOnly && (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetMiniForm();
                    setAgregando(true);
                  }}
                  disabled={cobrarMutation.isPending}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Agregar pago
                </Button>
              </div>
            )}

            {agregando && (
              <form onSubmit={handleAgregar} className="space-y-3 rounded-md border border-border bg-muted/30 p-3" noValidate>
                <h4 className="text-sm font-medium text-foreground">Nuevo pago</h4>

                <div className="space-y-1.5">
                  <Label htmlFor="cobrar-clase-monto" className="text-xs">Monto a cobrar</Label>
                  <Input
                    id="cobrar-clase-monto"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={montoPago}
                    onChange={(e) => setMontoPago(e.target.value)}
                    disabled={cobrarMutation.isPending}
                    placeholder="0.00"
                  />
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
                  <Label htmlFor="cobrar-clase-obs" className="text-xs">Observaciones (opcional)</Label>
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
                  <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
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
                  <Button type="submit" size="sm" disabled={cobrarMutation.isPending}>
                    {cobrarMutation.isPending ? 'Cobrando…' : 'Cobrar'}
                  </Button>
                </div>
              </form>
            )}
          </>
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
            <p className="text-sm font-medium text-foreground">¿Borrar este pago?</p>
            <p className="text-xs text-muted-foreground">
              {fmtMoney(pago.monto)} · {MEDIO_PAGO_LABEL[pago.medio_pago]} ·{' '}
              {fmtFechaHoraCorta(pago.fecha_hora)}. La acción no se puede deshacer.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onBorrarCancel} disabled={isPending}>
            No, mantener
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onBorrarConfirm} disabled={isPending}>
            {isPending ? 'Borrando…' : 'Sí, borrar'}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium tabular-nums text-foreground">{fmtMoney(pago.monto)}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{MEDIO_PAGO_LABEL[pago.medio_pago]}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-xs text-muted-foreground">{fmtFechaHoraCorta(pago.fecha_hora)}</span>
      {pago.observaciones && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="text-xs italic text-muted-foreground">{pago.observaciones}</span>
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
