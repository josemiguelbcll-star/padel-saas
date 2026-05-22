import { useEffect, useState, type FormEvent } from 'react';
import { z } from 'zod';
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
import { useCerrarCaja } from './hooks/useCerrarCaja';
import {
  useResumenCajaAbierta,
  type ResumenCaja,
} from './hooks/useResumenCajaAbierta';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const schema = z.object({
  efectivoContado: z
    .number({ invalid_type_error: 'Ingresá un número válido.' })
    .nonnegative('El efectivo contado no puede ser negativo.'),
  observaciones: z
    .string()
    .trim()
    .max(2000, 'Observaciones demasiado largas.')
    .optional(),
});

interface CerrarCajaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turnoCajaId: number;
}

/**
 * Modal de cierre con arqueo. Muestra el desglose en vivo
 * (apertura + entradas − salidas = esperado), pide el efectivo contado,
 * y previsualiza la diferencia (contado − esperado) ANTES de confirmar.
 *
 * El cierre real lo hace `fn_cerrar_caja` server-side con lock atómico
 * (re-calcula el esperado por las dudas — el preview del frontend es
 * solo informativo).
 */
export function CerrarCajaDialog({
  open,
  onOpenChange,
  turnoCajaId,
}: CerrarCajaDialogProps) {
  const resumenQuery = useResumenCajaAbierta(turnoCajaId);
  const cerrar = useCerrarCaja();
  const [contadoStr, setContadoStr] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [errors, setErrors] = useState<
    Partial<Record<'efectivoContado' | 'observaciones' | 'form', string>>
  >({});

  const pending = cerrar.isPending;
  const resumen = resumenQuery.data;

  useEffect(() => {
    if (open) {
      setContadoStr('');
      setObservaciones('');
      setErrors({});
    }
  }, [open]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  // Preview de diferencia client-side (la RPC recalcula al cerrar).
  const contadoNum =
    contadoStr.trim() === '' || isNaN(Number(contadoStr))
      ? null
      : Number(contadoStr);
  const diferenciaPreview =
    contadoNum !== null && resumen ? contadoNum - resumen.esperado : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrors({});

    const parsed = schema.safeParse({
      efectivoContado: contadoNum === null ? NaN : contadoNum,
      observaciones: observaciones.trim() === '' ? undefined : observaciones,
    });
    if (!parsed.success) {
      const fe: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path === 'efectivoContado' || path === 'observaciones') {
          fe[path] = issue.message;
        }
      }
      setErrors(fe);
      return;
    }

    try {
      await cerrar.mutateAsync({
        turnoCajaId,
        efectivoContado: parsed.data.efectivoContado,
        observaciones: parsed.data.observaciones,
      });
      onOpenChange(false);
    } catch (err) {
      setErrors({
        form: err instanceof Error ? err.message : 'No pudimos cerrar la caja.',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar caja con arqueo</DialogTitle>
          <DialogDescription>
            Contá el efectivo que tenés en el cajón y registralo. El
            sistema calcula la diferencia respecto del esperado.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Desglose */}
          {resumenQuery.isLoading && (
            <p className="text-xs text-muted-foreground">
              Cargando resumen…
            </p>
          )}
          {resumenQuery.error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {resumenQuery.error.message}
            </div>
          )}
          {resumen && <DesgloseCaja resumen={resumen} />}

          {/* Input efectivo contado */}
          <div className="space-y-1">
            <Label htmlFor="cerrar-caja-contado">Efectivo contado</Label>
            <Input
              id="cerrar-caja-contado"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={contadoStr}
              onChange={(e) => setContadoStr(e.target.value)}
              disabled={pending}
              autoFocus
              placeholder="0.00"
              aria-invalid={!!errors.efectivoContado}
            />
            {errors.efectivoContado && (
              <p role="alert" className="text-xs text-destructive">
                {errors.efectivoContado}
              </p>
            )}
          </div>

          {/* Preview de diferencia */}
          {diferenciaPreview !== null && resumen && (
            <DiferenciaPreview diferencia={diferenciaPreview} />
          )}

          {/* Observaciones */}
          <div className="space-y-1">
            <Label htmlFor="cerrar-caja-obs">Observaciones (opcional)</Label>
            <textarea
              id="cerrar-caja-obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              disabled={pending}
              maxLength={2000}
              rows={2}
              placeholder="Notas del cierre, motivo del faltante/sobrante, etc."
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {errors.observaciones && (
              <p role="alert" className="text-xs text-destructive">
                {errors.observaciones}
              </p>
            )}
          </div>

          {errors.form && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {errors.form}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !resumen}>
              {pending ? 'Cerrando…' : 'Confirmar cierre'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DesgloseCaja({ resumen }: { resumen: ResumenCaja }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <RowAmount label="Apertura" amount={resumen.apertura} />
      <RowAmount
        label={`Cobros en efectivo (${resumen.count_cobros_efectivo})`}
        amount={resumen.entradas_cobros}
        sign="+"
      />
      {resumen.ajustes_positivos > 0 && (
        <RowAmount
          label="Ajustes (sobrantes)"
          amount={resumen.ajustes_positivos}
          sign="+"
        />
      )}
      {resumen.salidas > 0 && (
        <RowAmount label="Salidas" amount={resumen.salidas} sign="−" />
      )}
      <div className="my-2 border-t border-border" />
      <div className="flex items-center justify-between font-semibold text-foreground">
        <span>Efectivo esperado</span>
        <span className="tabular-nums">{currencyFmt.format(resumen.esperado)}</span>
      </div>
    </div>
  );
}

function RowAmount({
  label,
  amount,
  sign,
}: {
  label: string;
  amount: number;
  sign?: '+' | '−';
}) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">
        {sign === '−' ? '−' : sign === '+' ? '+' : ''}
        {currencyFmt.format(Math.abs(amount))}
      </span>
    </div>
  );
}

function DiferenciaPreview({ diferencia }: { diferencia: number }) {
  const esCero = Math.abs(diferencia) < 0.005;
  const sobra = diferencia > 0;
  const label = esCero ? 'Cuadra' : sobra ? 'Sobra' : 'Falta';
  const color = esCero
    ? 'hsl(var(--estado-pagada))'
    : sobra
      ? 'hsl(var(--estado-senada))'
      : 'hsl(var(--destructive))';

  return (
    <div
      className="rounded-md border p-2 text-sm"
      style={{
        borderColor: color,
        backgroundColor: `${color.replace(/\)$/, ' / 0.1)')}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium" style={{ color }}>
          Diferencia ({label})
        </span>
        <span className="font-semibold tabular-nums" style={{ color }}>
          {diferencia >= 0 ? '+' : '−'}
          {currencyFmt.format(Math.abs(diferencia))}
        </span>
      </div>
    </div>
  );
}
