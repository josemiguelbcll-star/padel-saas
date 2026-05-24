import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
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
  const pagar = usePagarCuota();

  const [fechaPago, setFechaPago] = useState<string>(todayISO());
  const [medioPago, setMedioPago] = useState<MedioPago | ''>('transferencia');
  const [error, setError] = useState<string | null>(null);

  const pending = pagar.isPending;
  const cajaAbierta = cajaQuery.data ?? null;
  const efectivoSinCaja = medioPago === 'efectivo' && cajaAbierta === null;

  useEffect(() => {
    if (open) {
      setFechaPago(todayISO());
      setMedioPago('transferencia');
      setError(null);
    }
  }, [open, cuota?.id]);

  if (!cuota) return null;

  // Días vs hoy para mostrar contexto del vencimiento.
  const venc = cuota.fecha_vencimiento;
  const hoy = todayISO();
  const diffDias = venc ? diasEntre(hoy, venc) : null;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
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

  // Label: "Anticipo" si es_anticipo, sino "Cuota N de M". M es el
  // total_cuotas que viene del COUNT (incluye anticipo si existe).
  const cuotaLabel = cuota.es_anticipo
    ? 'Anticipo'
    : cuota.total_cuotas > 0
      ? `Cuota ${cuota.numero} de ${cuota.total_cuotas}`
      : `Cuota ${cuota.numero}`;

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
          <p className="font-medium text-foreground">
            {cuota.proveedor ?? <span className="italic text-muted-foreground">(sin proveedor)</span>}
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
                onChange={(e) => setMedioPago(e.target.value as MedioPago | '')}
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

/**
 * Diferencia en días entre dos fechas YYYY-MM-DD (b - a). Positivo si
 * b es posterior. Usa fecha local sin zona.
 */
function diasEntre(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T00:00:00').getTime();
  const b = new Date(bISO + 'T00:00:00').getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

