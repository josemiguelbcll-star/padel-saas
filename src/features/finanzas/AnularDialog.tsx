import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { MotivoAnulacionTipo } from '@/types/database';
import { MOTIVOS_ANULACION, MOTIVO_ANULACION_LABEL } from './finanzasSchemas';

interface AnularDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  descripcion: ReactNode;
  /** Resumen de lo que se anula (entidad, monto, etc.). Opcional. */
  resumen?: ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
  pending: boolean;
  /** Error de la mutation (RPC). El dialog suma su validación local del
   *  detalle obligatorio cuando el motivo es "otro". */
  error: string | null;
  onConfirm: (
    motivoTipo: MotivoAnulacionTipo,
    motivoDetalle: string | null,
  ) => void;
}

/**
 * Dialog reusable de anulación (0048). Captura motivo_tipo (select con
 * las 5 opciones del enum) + motivo_detalle (textarea, obligatorio solo
 * si motivo='otro') y delega la mutación al `onConfirm` del padre. Usado
 * para anular gastos (GastosPage / "Corregir" de recurrentes) y anular
 * pagos de cuota (CxP).
 */
export function AnularDialog({
  open,
  onOpenChange,
  titulo,
  descripcion,
  resumen,
  confirmLabel = 'Anular',
  pendingLabel = 'Anulando…',
  pending,
  error,
  onConfirm,
}: AnularDialogProps) {
  const [motivoTipo, setMotivoTipo] =
    useState<MotivoAnulacionTipo>('error_monto');
  const [motivoDetalle, setMotivoDetalle] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMotivoTipo('error_monto');
      setMotivoDetalle('');
      setLocalError(null);
    }
  }, [open]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setLocalError(null);
    const detalle = motivoDetalle.trim();
    // Espejo del guard de la RPC: "otro" exige detalle.
    if (motivoTipo === 'otro' && detalle === '') {
      setLocalError('Si el motivo es "otro", contá brevemente qué pasó.');
      return;
    }
    onConfirm(motivoTipo, detalle === '' ? null : detalle);
  }

  const shownError = localError ?? error;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" aria-hidden="true" />
            {titulo}
          </DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>

        {resumen && (
          <div className="rounded-md border border-border bg-card p-3 text-sm">
            {resumen}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="anular-motivo" className="text-xs">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <select
              id="anular-motivo"
              value={motivoTipo}
              onChange={(e) =>
                setMotivoTipo(e.target.value as MotivoAnulacionTipo)
              }
              disabled={pending}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {MOTIVOS_ANULACION.map((m) => (
                <option key={m} value={m}>
                  {MOTIVO_ANULACION_LABEL[m]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="anular-detalle" className="text-xs">
              Detalle{' '}
              {motivoTipo === 'otro' ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground">(opcional)</span>
              )}
            </Label>
            <textarea
              id="anular-detalle"
              value={motivoDetalle}
              onChange={(e) => setMotivoDetalle(e.target.value)}
              disabled={pending}
              maxLength={2000}
              rows={2}
              placeholder="Ej: duplicado del recibo #123, monto mal tipeado…"
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {shownError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {shownError}
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
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
