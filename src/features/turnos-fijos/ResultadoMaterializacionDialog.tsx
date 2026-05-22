import { CheckCircle2, AlertTriangle, Calendar, Repeat, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ResultadoMaterializacion } from '@/types/database';

interface ResultadoMaterializacionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resultado: ResultadoMaterializacion | null;
  rangoLabel: string;
}

interface FilaItem {
  icon: typeof CheckCircle2;
  label: string;
  cantidad: number;
  tone: 'success' | 'warning' | 'neutral' | 'danger';
}

/**
 * Modal que muestra el resultado de fn_materializar_turnos_fijos con los
 * 5 contadores en formato accionable. Lo crítico para el admin:
 *  - cuántas se crearon de verdad,
 *  - cuántas quedaron saltadas (y por qué).
 */
export function ResultadoMaterializacionDialog({
  open,
  onOpenChange,
  resultado,
  rangoLabel,
}: ResultadoMaterializacionDialogProps) {
  if (!resultado) return null;

  const items: FilaItem[] = [
    {
      icon: CheckCircle2,
      label: 'Reservas creadas',
      cantidad: resultado.reservas_creadas,
      tone: 'success',
    },
    {
      icon: Repeat,
      label: 'Ya estaban hechas (idempotencia)',
      cantidad: resultado.slots_ya_materializados,
      tone: 'neutral',
    },
    {
      icon: AlertTriangle,
      label: 'Saltadas por reserva suelta existente',
      cantidad: resultado.slots_ocupados_por_reserva_suelta,
      tone: 'warning',
    },
    {
      icon: Calendar,
      label: 'Saltadas por clase activa',
      cantidad: resultado.slots_ocupados_por_clase,
      tone: 'warning',
    },
    {
      icon: ShieldAlert,
      label: 'Saltadas por falta de tarifa',
      cantidad: resultado.slots_sin_tarifa,
      tone: 'danger',
    },
  ];

  const huboCreadas = resultado.reservas_creadas > 0;
  const huboSinTarifa = resultado.slots_sin_tarifa > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resultado de la materialización</DialogTitle>
          <DialogDescription>
            Rango: {rangoLabel}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5">
          {items.map((it) => {
            const Icon = it.icon;
            const color =
              it.tone === 'success'
                ? 'text-green-600 dark:text-green-500'
                : it.tone === 'warning'
                  ? 'text-amber-600 dark:text-amber-500'
                  : it.tone === 'danger'
                    ? 'text-red-600 dark:text-red-500'
                    : 'text-muted-foreground';
            const muted = it.cantidad === 0;
            return (
              <li
                key={it.label}
                className={
                  'flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm ' +
                  (muted ? 'opacity-60' : '')
                }
              >
                <span className="flex items-center gap-2">
                  <Icon className={'h-4 w-4 shrink-0 ' + color} aria-hidden="true" />
                  {it.label}
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {it.cantidad}
                </span>
              </li>
            );
          })}
        </ul>

        {huboSinTarifa && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs">
            <ShieldAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-500"
              aria-hidden="true"
            />
            <p>
              <strong>Falta tarifa</strong> para algunos slots — los turnos
              fijos correspondientes <strong>no se materializaron</strong> esas
              fechas. Configurá la tarifa para esos horarios en
              <em> Configuración → Tarifas</em> y volvé a generar.
            </p>
          </div>
        )}

        {!huboCreadas && !huboSinTarifa && (
          <p className="text-xs text-muted-foreground">
            No se creó ninguna reserva nueva. Si esperabas que se crearan,
            verificá que los turnos fijos estén activos y que el rango
            elegido cubra sus fechas de vigencia.
          </p>
        )}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
