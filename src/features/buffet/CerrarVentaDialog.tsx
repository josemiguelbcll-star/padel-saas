import { useState, useMemo, useEffect, type FormEvent } from 'react';
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
import type { MedioPago, Venta } from '@/types/database';
import { useJugadores } from '@/features/reservas/hooks/useJugadores';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import {
  useCerrarVenta,
  type CerrarVentaItem,
  type CerrarVentaPagoItem,
} from './hooks/useCerrarVenta';
import type { VentaItemEnriquecido } from './VentaActual';
import {
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Split,
  CreditCard,
  Sparkles,
} from 'lucide-react';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MEDIOS_PAGO_LIST: readonly MedioPago[] = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'cuenta_corriente',
  'otro',
] as const;

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  cuenta_corriente: 'Cuenta Corriente',
  otro: 'Otro',
  mixto: 'Mixto',
};

function mapCuentaTipoToMedio(tipo: string): MedioPago {
  if (tipo === 'efectivo') return 'efectivo';
  if (tipo === 'billetera') return 'mp';
  if (tipo === 'banco') return 'transferencia';
  return 'otro';
}

interface CerrarVentaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: VentaItemEnriquecido[];
  total: number;
  /** Se llama tras un cierre exitoso con la venta creada. El padre limpia
   *  el carrito y muestra el mensaje de "venta registrada". */
  onSuccess: (venta: Venta) => void;
}

export function CerrarVentaDialog({
  open,
  onOpenChange,
  items,
  total,
  onSuccess,
}: CerrarVentaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <CerrarVentaBody
          // Remount cada vez que se abre: medio/observaciones/error arrancan limpios.
          key={open ? 'open' : 'closed'}
          items={items}
          total={total}
          onSuccess={onSuccess}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface CerrarVentaBodyProps {
  items: VentaItemEnriquecido[];
  total: number;
  onSuccess: (venta: Venta) => void;
  onCancel: () => void;
}

interface PartePagoForm {
  id: string;
  medio_pago: MedioPago;
  cuenta_id?: number | null;
  monto: string;
  jugador_id?: number | null;
}

function CerrarVentaBody({
  items,
  total,
  onSuccess,
  onCancel,
}: CerrarVentaBodyProps) {
  const [esPagoMixto, setEsPagoMixto] = useState(false);
  const [medio, setMedio] = useState<MedioPago>('efectivo');
  const [selectedCuentaId, setSelectedCuentaId] = useState<number | null>(null);
  const [obs, setObs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [jugadorId, setJugadorId] = useState<number | null>(null);

  const cuentasQuery = useCuentas();
  const cuentasActivas = useMemo(() => {
    return (cuentasQuery.data ?? []).filter((c) => c.activa);
  }, [cuentasQuery.data]);

  // Estado para pagos divididos (inicializado con cuentas del club si existen)
  const [partes, setPartes] = useState<PartePagoForm[]>([
    { id: '1', medio_pago: 'transferencia', cuenta_id: null, monto: '' },
    { id: '2', medio_pago: 'efectivo', cuenta_id: null, monto: '' },
  ]);

  useEffect(() => {
    if (cuentasActivas.length > 0) {
      if (selectedCuentaId === null) {
        const def =
          cuentasActivas.find((c) => c.tipo === 'efectivo' || c.es_caja_fisica) ??
          cuentasActivas[0];
        if (def) {
          setSelectedCuentaId(def.id);
          setMedio(mapCuentaTipoToMedio(def.tipo));
        }
      }

      setPartes((prev) => {
        // Si las partes aún no tienen cuenta asignada, vincularlas a las cuentas del club
        if (cuentasActivas.length >= 2 && prev.length === 2 && !prev[0].cuenta_id && !prev[1].cuenta_id) {
          return [
            {
              id: '1',
              medio_pago: mapCuentaTipoToMedio(cuentasActivas[0].tipo),
              cuenta_id: cuentasActivas[0].id,
              monto: prev[0].monto,
            },
            {
              id: '2',
              medio_pago: mapCuentaTipoToMedio(cuentasActivas[1].tipo),
              cuenta_id: cuentasActivas[1].id,
              monto: prev[1].monto,
            },
          ];
        }
        return prev;
      });
    }
  }, [cuentasActivas, selectedCuentaId]);

  const jugadoresQuery = useJugadores();
  const jugadores = jugadoresQuery.data ?? [];

  const cerrarMutation = useCerrarVenta();
  const isPending = cerrarMutation.isPending;

  // Cálculos para pago dividido
  const sumaPartes = partes.reduce((acc, p) => {
    const val = parseFloat(p.monto.replace(',', '.'));
    return acc + (isNaN(val) ? 0 : val);
  }, 0);

  const diferencia = Number((total - sumaPartes).toFixed(2));
  const totalExacto = Math.abs(diferencia) < 0.01;

  function handleAutoCompletarResto(parteId: string) {
    // Calcula cuánto falta sumar sin contar la parte actual
    const sumaOtras = partes
      .filter((p) => p.id !== parteId)
      .reduce((acc, p) => {
        const val = parseFloat(p.monto.replace(',', '.'));
        return acc + (isNaN(val) ? 0 : val);
      }, 0);

    const restante = Math.max(0, Number((total - sumaOtras).toFixed(2)));
    setPartes((prev) =>
      prev.map((p) => (p.id === parteId ? { ...p, monto: restante.toString() } : p)),
    );
  }

  function handleAgregarParte() {
    // Buscar si hay cuentas del club no usadas aún
    const cuentasUsadas = new Set(partes.map((p) => p.cuenta_id).filter(Boolean));
    const siguienteCuenta = cuentasActivas.find((c) => !cuentasUsadas.has(c.id));

    const restante = Math.max(0, diferencia);

    if (siguienteCuenta) {
      setPartes((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          medio_pago: mapCuentaTipoToMedio(siguienteCuenta.tipo),
          cuenta_id: siguienteCuenta.id,
          monto: restante > 0 ? restante.toString() : '',
        },
      ]);
    } else {
      const usados = new Set(partes.map((p) => p.medio_pago));
      const proximoMedio =
        MEDIOS_PAGO_LIST.find((m) => !usados.has(m) && m !== 'cuenta_corriente') ?? 'otro';

      setPartes((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          medio_pago: proximoMedio,
          cuenta_id: null,
          monto: restante > 0 ? restante.toString() : '',
        },
      ]);
    }
  }

  function handleEliminarParte(id: string) {
    if (partes.length <= 2) return;
    setPartes((prev) => prev.filter((p) => p.id !== id));
  }

  function handleUpdateParte(id: string, updates: Partial<PartePagoForm>) {
    setPartes((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (items.length === 0) {
      setError('La venta está vacía.');
      return;
    }

    const rpcItems: CerrarVentaItem[] = items.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
    }));

    if (esPagoMixto) {
      // Validaciones pago mixto
      if (partes.length < 2) {
        setError('Debes ingresar al menos 2 medios de pago.');
        return;
      }

      for (let i = 0; i < partes.length; i++) {
        const p = partes[i];
        const montoNum = parseFloat(p.monto.replace(',', '.'));
        if (isNaN(montoNum) || montoNum <= 0) {
          const label = p.cuenta_id
            ? cuentasActivas.find((c) => c.id === p.cuenta_id)?.nombre ?? MEDIO_PAGO_LABEL[p.medio_pago]
            : MEDIO_PAGO_LABEL[p.medio_pago];
          setError(`El importe del pago #${i + 1} (${label}) debe ser mayor a 0.`);
          return;
        }
        if (p.medio_pago === 'cuenta_corriente' && !p.jugador_id && !jugadorId) {
          setError(`Seleccioná un cliente para el pago con Cuenta Corriente (#${i + 1}).`);
          return;
        }
      }

      if (!totalExacto) {
        if (diferencia > 0) {
          setError(`Faltan asignar ${currencyFmt.format(diferencia)} para cubrir el total.`);
        } else {
          setError(`La suma de los pagos supera el total por ${currencyFmt.format(Math.abs(diferencia))}.`);
        }
        return;
      }

      const rpcPagos: CerrarVentaPagoItem[] = partes.map((p) => ({
        medio_pago: p.medio_pago,
        monto: Number(parseFloat(p.monto.replace(',', '.')).toFixed(2)),
        cuenta_id: p.cuenta_id ?? null,
      }));

      try {
        const venta = await cerrarMutation.mutateAsync({
          items: rpcItems,
          medio_pago: 'mixto',
          observaciones: obs.trim() === '' ? null : obs.trim(),
          jugador_id: jugadorId,
          pagos: rpcPagos,
        });
        onSuccess(venta);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'No pudimos registrar la venta.',
        );
      }
    } else {
      // Validación pago único estándar
      if (!medio) {
        setError('Elegí un medio de pago.');
        return;
      }
      if (medio === 'cuenta_corriente' && !jugadorId) {
        setError('Elegí un cliente para la cuenta corriente.');
        return;
      }

      try {
        const venta = await cerrarMutation.mutateAsync({
          items: rpcItems,
          medio_pago: medio,
          cuenta_id: selectedCuentaId ?? null,
          observaciones: obs.trim() === '' ? null : obs.trim(),
          jugador_id: medio === 'cuenta_corriente' ? jugadorId : null,
          pagos: null,
        });
        onSuccess(venta);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'No pudimos registrar la venta.',
        );
      }
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center justify-between">
          <span>Cerrar venta</span>
          <span className="text-xl font-bold text-primary tabular-nums">
            {currencyFmt.format(total)}
          </span>
        </DialogTitle>
        <DialogDescription>
          Elegí la modalidad de cobro para confirmar la transacción.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Resumen de items del carrito */}
        <div className="space-y-1 rounded-md border border-border bg-muted/20 p-2.5 text-xs max-h-32 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.producto.id}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="truncate text-muted-foreground">
                <span className="font-semibold text-foreground">{item.cantidad}×</span> {item.producto.nombre}
              </span>
              <span className="shrink-0 tabular-nums text-foreground font-medium">
                {currencyFmt.format(item.subtotal)}
              </span>
            </div>
          ))}
        </div>

        {/* Selector de modo: Pago Único vs Dividir Pago */}
        <div className="flex rounded-lg bg-muted p-1 text-xs">
          <button
            type="button"
            onClick={() => setEsPagoMixto(false)}
            disabled={isPending}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all',
              !esPagoMixto
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <CreditCard className="h-3.5 w-3.5" />
            Pago único
          </button>
          <button
            type="button"
            onClick={() => setEsPagoMixto(true)}
            disabled={isPending}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all',
              esPagoMixto
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Split className="h-3.5 w-3.5" />
            Dividir pago (Mixto)
          </button>
        </div>

        {/* ── MODO PAGO ÚNICO ────────────────────────────────────────── */}
        {!esPagoMixto && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Cuenta / Medio de cobro</Label>
                {selectedCuentaId && (
                  <span className="text-[11px] text-muted-foreground">
                    Destino:{' '}
                    <strong className="text-foreground">
                      {cuentasActivas.find((c) => c.id === selectedCuentaId)?.nombre}
                    </strong>
                  </span>
                )}
              </div>

              {cuentasActivas.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {cuentasActivas.map((c) => {
                    const isSelected = selectedCuentaId === c.id && medio !== 'cuenta_corriente';
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCuentaId(c.id);
                          setMedio(mapCuentaTipoToMedio(c.tipo));
                        }}
                        disabled={isPending}
                        aria-pressed={isSelected}
                        className={cn(
                          'rounded-md border p-2 text-xs font-medium transition-all flex flex-col items-start gap-1 text-left',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
                            : 'border-border bg-background text-foreground hover:bg-muted',
                        )}
                      >
                        <span className="truncate w-full font-medium">{c.nombre}</span>
                        <span
                          className={cn(
                            'text-[9px] px-1 py-0.5 rounded font-normal uppercase tracking-wider',
                            isSelected
                              ? 'bg-primary-foreground/20 text-primary-foreground'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {c.tipo === 'billetera' ? 'MP / Digital' : c.tipo === 'banco' ? 'Banco' : c.tipo === 'efectivo' ? 'Efectivo' : 'Otro'}
                        </span>
                      </button>
                    );
                  })}

                  {/* Botón Cuenta Corriente */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCuentaId(null);
                      setMedio('cuenta_corriente');
                    }}
                    disabled={isPending}
                    aria-pressed={medio === 'cuenta_corriente'}
                    className={cn(
                      'rounded-md border p-2 text-xs font-medium transition-all flex flex-col items-start gap-1 text-left',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      medio === 'cuenta_corriente'
                        ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
                        : 'border-border bg-background text-foreground hover:bg-muted',
                    )}
                  >
                    <span className="truncate w-full font-medium">Cuenta Corriente</span>
                    <span
                      className={cn(
                        'text-[9px] px-1 py-0.5 rounded font-normal uppercase tracking-wider',
                        medio === 'cuenta_corriente'
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      Cliente
                    </span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {MEDIOS_PAGO_LIST.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMedio(m)}
                      disabled={isPending}
                      aria-pressed={medio === m}
                      className={cn(
                        'rounded-md border px-2.5 py-2 text-xs font-medium transition-colors text-center',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        medio === m
                          ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-sm'
                          : 'border-border bg-background text-foreground hover:bg-muted',
                      )}
                    >
                      {MEDIO_PAGO_LABEL[m]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {medio === 'cuenta_corriente' && (
              <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                <Label htmlFor="venta-jugador" className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  Seleccionar Cliente para Cuenta Corriente
                </Label>
                <select
                  id="venta-jugador"
                  value={jugadorId ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setJugadorId(val ? Number(val) : null);
                  }}
                  disabled={isPending}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">-- Seleccionar Jugador --</option>
                  {jugadores.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.nombre} {j.telefono ? `(${j.telefono})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* ── MODO PAGO MIXTO / DIVIDIDO ────────────────────────────── */}
        {esPagoMixto && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Desglose de pagos</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAgregarParte}
                disabled={isPending}
                className="h-7 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10 gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar cuenta / medio
              </Button>
            </div>

            <div className="space-y-2.5">
              {partes.map((p, index) => {
                const montoNum = parseFloat(p.monto.replace(',', '.')) || 0;
                const otrasSuma = sumaPartes - montoNum;
                const faltaParaEsta = Math.max(0, Number((total - otrasSuma).toFixed(2)));
                const puedeCompletar = faltaParaEsta > 0 && Math.abs(montoNum - faltaParaEsta) > 0.01;

                // Identificador para el select
                const selectValue =
                  p.medio_pago === 'cuenta_corriente'
                    ? 'cc'
                    : p.cuenta_id
                      ? `cuenta_${p.cuenta_id}`
                      : `medio_${p.medio_pago}`;

                return (
                  <div
                    key={p.id}
                    className="p-2.5 rounded-lg border border-border bg-card/60 space-y-2 shadow-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">
                        #{index + 1}
                      </span>

                      {/* Selector de cuenta o medio del club */}
                      <select
                        value={selectValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'cc') {
                            handleUpdateParte(p.id, {
                              medio_pago: 'cuenta_corriente',
                              cuenta_id: null,
                            });
                          } else if (val.startsWith('cuenta_')) {
                            const cid = Number(val.replace('cuenta_', ''));
                            const c = cuentasActivas.find((acc) => acc.id === cid);
                            handleUpdateParte(p.id, {
                              medio_pago: c ? mapCuentaTipoToMedio(c.tipo) : 'otro',
                              cuenta_id: cid,
                            });
                          } else {
                            const m = val.replace('medio_', '') as MedioPago;
                            handleUpdateParte(p.id, {
                              medio_pago: m,
                              cuenta_id: null,
                            });
                          }
                        }}
                        disabled={isPending}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring flex-1 shrink-0"
                      >
                        {cuentasActivas.length > 0 && (
                          <optgroup label="Cuentas del club">
                            {cuentasActivas.map((c) => (
                              <option key={c.id} value={`cuenta_${c.id}`}>
                                {c.nombre} ({c.tipo === 'billetera' ? 'MP' : c.tipo === 'banco' ? 'Banco' : c.tipo === 'efectivo' ? 'Efectivo' : 'Otro'})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Otros medios">
                          <option value="cc">Cuenta Corriente (Cliente)</option>
                          {MEDIOS_PAGO_LIST.filter((m) => m !== 'cuenta_corriente').map((m) => (
                            <option key={m} value={`medio_${m}`}>
                              {MEDIO_PAGO_LABEL[m]} (General)
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      {/* Input de monto */}
                      <div className="relative w-32 shrink-0">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-semibold">
                          $
                        </span>
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          value={p.monto}
                          onChange={(e) =>
                            handleUpdateParte(p.id, { monto: e.target.value })
                          }
                          disabled={isPending}
                          placeholder="0.00"
                          className="h-8 pl-6 pr-2 text-xs tabular-nums text-right font-semibold"
                        />
                      </div>

                      {/* Botón eliminar */}
                      {partes.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEliminarParte(p.id)}
                          disabled={isPending}
                          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                          title="Eliminar este pago"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {/* Botón de completar resto y opciones secundarias */}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-6">
                      {puedeCompletar ? (
                        <button
                          type="button"
                          onClick={() => handleAutoCompletarResto(p.id)}
                          disabled={isPending}
                          className="text-primary hover:underline font-medium flex items-center gap-1"
                        >
                          <Sparkles className="h-3 w-3" />
                          Completar resto ({currencyFmt.format(faltaParaEsta)})
                        </button>
                      ) : (
                        <span />
                      )}

                      {p.monto && Number(p.monto) > 0 && (
                        <span className="font-medium text-foreground">
                          {currencyFmt.format(Number(p.monto))}
                        </span>
                      )}
                    </div>

                    {/* Si este medio es cuenta corriente, pedir jugador */}
                    {p.medio_pago === 'cuenta_corriente' && (
                      <div className="pl-6 pt-1">
                        <select
                          value={p.jugador_id ?? jugadorId ?? ''}
                          onChange={(e) => {
                            const val = e.target.value ? Number(e.target.value) : null;
                            handleUpdateParte(p.id, { jugador_id: val });
                            if (!jugadorId) setJugadorId(val);
                          }}
                          disabled={isPending}
                          className="h-7 w-full rounded border border-amber-500/40 bg-amber-500/5 px-2 text-xs"
                        >
                          <option value="">-- Asignar Cliente para Cuenta Corriente --</option>
                          {jugadores.map((j) => (
                            <option key={j.id} value={j.id}>
                              {j.nombre} {j.telefono ? `(${j.telefono})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Panel de balance / Estado de cobertura */}
            <div className="rounded-lg border p-2.5 text-xs space-y-1.5 bg-muted/30">
              <div className="flex justify-between items-center text-muted-foreground">
                <span>Total asignado:</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {currencyFmt.format(sumaPartes)} / {currencyFmt.format(total)}
                </span>
              </div>

              {totalExacto ? (
                <div className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Total cubierto exactamente</span>
                </div>
              ) : diferencia > 0 ? (
                <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Falta asignar: <strong>{currencyFmt.format(diferencia)}</strong></span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-destructive bg-destructive/10 border border-destructive/20 px-2 py-1 rounded">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>La suma supera el total por {currencyFmt.format(Math.abs(diferencia))}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Observaciones (opcional) */}
        <div className="space-y-1.5">
          <Label htmlFor="cerrar-venta-obs" className="text-xs">Observaciones (opcional)</Label>
          <Input
            id="cerrar-venta-obs"
            type="text"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            disabled={isPending}
            maxLength={500}
            placeholder="Notas internas de esta venta…"
            className="h-8 text-xs"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-1.5"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            size="sm"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isPending || (esPagoMixto && !totalExacto)}
            size="sm"
            className="gap-1.5"
          >
            {isPending ? 'Registrando…' : `Cobrar ${currencyFmt.format(total)}`}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
