import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Repeat, Wallet } from 'lucide-react';
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
import { useCajaAbierta } from '@/features/caja/hooks/useCajaAbierta';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import { useMediosCuentaDefault } from '@/features/configuracion/hooks/useMediosCuentaDefault';
import type { MedioPago } from '@/types/database';
import { MEDIO_PAGO_LABEL, MEDIOS_PAGO } from './finanzasSchemas';
import { usePagarCuota } from './hooks/usePagarCuota';
import type { CuentaPorPagarFila } from './hooks/useCuentasPorPagar';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmtDateISO(iso: string | null): string | null {
  if (!iso) return null;
  return dateFmt.format(new Date(iso + 'T00:00:00'));
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface PagarCuotaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cuota: CuentaPorPagarFila | null;
}

export function PagarCuotaDialog({
  open,
  onOpenChange,
  cuota,
}: PagarCuotaDialogProps) {
  const cajaQuery = useCajaAbierta();
  const cuentasQuery = useCuentas();
  const mediosDefaultQuery = useMediosCuentaDefault();
  const pagar = usePagarCuota();

  const [fechaPago, setFechaPago] = useState<string>(todayISO());
  const [medioPago, setMedioPago] = useState<MedioPago | ''>('transferencia');
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const porMedioDefault = useMemo(() => {
    const m = new Map<MedioPago, number>();
    for (const row of mediosDefaultQuery.data ?? []) m.set(row.medio_pago, row.cuenta_id);
    return m;
  }, [mediosDefaultQuery.data]);

  const cuentasActivas = useMemo(() => {
    return (cuentasQuery.data ?? []).filter((c) => c.activa);
  }, [cuentasQuery.data]);

  const cuentasById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cuentasQuery.data ?? []) m.set(c.id, c.nombre);
    return m;
  }, [cuentasQuery.data]);

  const pending = pagar.isPending;
  const cajaAbierta = cajaQuery.data ?? null;
  const efectivoSinCaja = medioPago === 'efectivo' && cajaAbierta === null;

  useEffect(() => {
    if (open) {
      setFechaPago(todayISO());
      setMedioPago('transferencia');
      const def = porMedioDefault.get('transferencia') ?? null;
      setCuentaId(def);
      setError(null);
    }
  }, [open, cuota?.id, porMedioDefault]);

  if (!cuota) return null;

  const venc = cuota.fecha_vencimiento;
  const hoy = todayISO();
  const diffDias = venc ? diasEntre(hoy, venc) : null;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  function handleMedioChange(nextMedio: MedioPago | '') {
    setMedioPago(nextMedio);
    if (nextMedio) {
      setCuentaId(porMedioDefault.get(nextMedio) ?? null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!cuota) return;
    if (fechaPago === '') {
      setError('Ingresá la fecha de pago.');
      return;
    }
    if (medioPago === '') {
      setError('Elegí el medio de pago.');
      return;
    }
    try {
      await pagar.mutateAsync({
        cuota_id: cuota.id,
        fecha_pago: fechaPago,
        medio_pago: medioPago as MedioPago,
        cuenta_id: cuentaId,
        turnoCajaIdParaInvalidate: cajaAbierta?.id ?? null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos registrar el pago. Probá de nuevo.',
      );
    }
  }

  const cuotaLabel = cuota.es_anticipo
    ? 'Anticipo'
    : cuota.total_cuotas > 0
      ? `Cuota ${cuota.numero} de ${cuota.total_cuotas}`
      : `Cuota ${cuota.numero}`;

  const defaultCuentaId = medioPago ? porMedioDefault.get(medioPago) : null;
  const defaultCuentaNombre = defaultCuentaId ? cuentasById.get(defaultCuentaId) : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
            Pagar cuota
          </DialogTitle>
          <DialogDescription>
            Registrá el pago de esta cuota. La deuda madre del gasto se
            actualiza automáticamente.
          </DialogDescription>
        </DialogHeader>

        {/* Resumen de la cuota */}
        <div className="space-y-1 rounded-md border border-border bg-card p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            {cuota.proveedor ?? cuota.concepto_recurrente ?? (
              <span className="italic text-muted-foreground">(sin proveedor)</span>
            )}
            {cuota.concepto_recurrente !== null && (
              <span
                title="Cargado desde una plantilla recurrente"
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-muted-foreground ring-1 ring-border"
              >
                <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                Recurrente
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {cuota.categoria_nombre} · {cuota.unidad_nombre}
            {cuota.compra_id !== null && ` · Compra #${cuota.compra_id}`}
          </p>
          <p className="text-xs text-muted-foreground">{cuotaLabel}</p>
          <div className="flex items-baseline justify-between pt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Monto
            </span>
            <span className="text-xl font-bold tabular-nums text-foreground">
              {fmtMoney(cuota.monto)}
            </span>
          </div>
          {venc && (
            <p
              className={cn(
                'text-[11px]',
                diffDias !== null && diffDias < 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground',
              )}
            >
              Vencimiento: {fmtDateISO(venc)}
              {diffDias !== null && diffDias < 0 && (
                <> · vencido hace {Math.abs(diffDias)} día{Math.abs(diffDias) === 1 ? '' : 's'}</>
              )}
              {diffDias !== null && diffDias === 0 && <> · vence hoy</>}
              {diffDias !== null && diffDias > 0 && (
                <> · vence en {diffDias} día{diffDias === 1 ? '' : 's'}</>
              )}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pc-fecha" className="text-xs">
                Fecha de pago <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pc-fecha"
                type="date"
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
                disabled={pending}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-medio" className="text-xs">
                Medio <span className="text-destructive">*</span>
              </Label>
              <select
                id="pc-medio"
                value={medioPago}
                onChange={(e) => handleMedioChange(e.target.value as MedioPago | '')}
                disabled={pending}
                className={cn(
                  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <option value="">Elegí un medio…</option>
                {MEDIOS_PAGO.map((m) => (
                  <option key={m} value={m}>
                    {MEDIO_PAGO_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Selector de cuenta de origen */}
          <div className="space-y-1.5">
            <Label htmlFor="pc-cuenta" className="text-xs">
              Cuenta de origen
            </Label>
            <select
              id="pc-cuenta"
              value={cuentaId ?? ''}
              onChange={(e) => setCuentaId(e.target.value === '' ? null : Number(e.target.value))}
              disabled={pending}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {defaultCuentaNombre
                  ? `— Por defecto (${defaultCuentaNombre}) —`
                  : '— Sin asignar / Cuenta por defecto —'}
              </option>
              {cuentasActivas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} {c.es_caja_fisica ? '(Caja física)' : `(${c.tipo})`}
                </option>
              ))}
            </select>
          </div>

          {efectivoSinCaja && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                No hay caja abierta del día. Si pagás en efectivo sin
                caja abierta, el servidor lo va a rechazar. Abrí la caja
                desde el módulo Caja antes de continuar, o elegí otro
                medio de pago.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Registrando…' : 'Pagar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function diasEntre(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T00:00:00').getTime();
  const b = new Date(bISO + 'T00:00:00').getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
