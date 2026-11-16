import { useEffect, useState } from 'react';
import { CalendarX } from 'lucide-react';
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
import {
  useLiberarTurnoFijoPorFecha,
  useReactivarTurnoFijoPorFecha,
} from './hooks/useTurnosFijos';
import type { TurnoFijo } from '@/types/database';

interface LiberarTurnoFijoPorFechaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  turno: TurnoFijo | null;
}

const DIAS_PLURAL: Record<number, string> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábados',
  7: 'domingos',
};

/** Próxima fecha (hoy o posterior) que cae en el día de semana indicado (1=lunes..7=domingo). */
function proximaFechaDeDia(diaSemana: number): string {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dowActual = ((hoy.getDay() + 6) % 7) + 1;
  const delta = (diaSemana - dowActual + 7) % 7;
  const d = new Date(hoy);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Libera (o reactiva) una instancia puntual de un turno fijo para una fecha
 * concreta, sin eliminar el turno fijo maestro. La liberación marca la reserva
 * de esa fecha como cancelada y deja el horario disponible para reservar.
 */
export function LiberarTurnoFijoPorFechaDialog({
  open,
  onOpenChange,
  turno,
}: LiberarTurnoFijoPorFechaDialogProps) {
  const liberar = useLiberarTurnoFijoPorFecha();
  const reactivar = useReactivarTurnoFijoPorFecha();
  const [fecha, setFecha] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  const pending = liberar.isPending || reactivar.isPending;

  useEffect(() => {
    if (open) {
      setFecha(turno ? proximaFechaDeDia(turno.dia_semana) : '');
      setError(null);
      setResultado(null);
    }
  }, [open, turno]);

  function handleOpenChange(next: boolean): void {
    if (pending) return;
    onOpenChange(next);
  }

  async function handleLiberar(): Promise<void> {
    if (!turno || !fecha) return;
    setError(null);
    setResultado(null);
    try {
      await liberar.mutateAsync({ turno_fijo_id: turno.id, fecha });
      setResultado('Turno liberado para esa fecha. El horario quedó disponible para reservar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos liberar el turno para esa fecha.');
    }
  }

  async function handleReactivar(): Promise<void> {
    if (!turno || !fecha) return;
    setError(null);
    setResultado(null);
    try {
      await reactivar.mutateAsync({ turno_fijo_id: turno.id, fecha });
      setResultado('Turno reactivado para esa fecha.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos reactivar el turno para esa fecha.');
    }
  }

  if (!turno) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarX className="h-4 w-4 text-primary" aria-hidden="true" />
            Liberar turno por fecha
          </DialogTitle>
          <DialogDescription>
            Libera solo la fecha elegida sin eliminar el turno fijo. El día
            {' '}{DIAS_PLURAL[turno.dia_semana] ?? ''} queda libre para que
            cualquiera pueda reservar ese horario.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="liberar-fecha">Fecha</Label>
            <Input
              id="liberar-fecha"
              type="date"
              value={fecha}
              min={turno.fecha_desde}
              max={turno.fecha_hasta ?? undefined}
              onChange={(e) => {
                setFecha(e.target.value);
                setError(null);
                setResultado(null);
              }}
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              Debe existir una reserva generada en esa fecha. Si todavía no
              existe, sincronizá los turnos fijos primero.
            </p>
          </div>

          {resultado && (
            <div
              role="status"
              className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-foreground"
            >
              ✓ {resultado}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleReactivar}
            disabled={pending || !fecha}
            title="Revierte una liberación previa si el horario sigue libre."
          >
            {reactivar.isPending ? 'Reactivando…' : 'Reactivar'}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cerrar
            </Button>
            <Button type="button" onClick={handleLiberar} disabled={pending || !fecha}>
              {liberar.isPending ? 'Liberando…' : 'Liberar esa fecha'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
