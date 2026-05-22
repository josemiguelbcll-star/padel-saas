import { Circle, CircleDot, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TarifaLinaje } from './tarifaLineage';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmt(iso: string): string {
  return fechaFmt.format(new Date(iso + 'T00:00:00'));
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface HistorialPrecioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linaje: TarifaLinaje | null;
}

type EstadoVersion = 'futura' | 'vigente' | 'historica';

function estadoDeVersion(
  vigenteDesde: string,
  vigenteHasta: string | null,
): EstadoVersion {
  const hoy = todayISO();
  if (vigenteDesde > hoy) return 'futura';
  if (vigenteHasta !== null && vigenteHasta < hoy) return 'historica';
  return 'vigente';
}

/**
 * Drawer con el timeline de precios del linaje. Sin acciones — pura
 * lectura para auditoría. Versiones ordenadas por vigente_desde DESC
 * (más reciente arriba). Marca visualmente cuál es "futura",
 * "vigente hoy" e "histórica".
 */
export function HistorialPrecioDialog({
  open,
  onOpenChange,
  linaje,
}: HistorialPrecioDialogProps) {
  if (!linaje) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Historial de precios · {linaje.nombre}</DialogTitle>
          <DialogDescription>
            Versiones de precio de esta franja a lo largo del tiempo.
            La versión vigente hoy está resaltada. Las reservas pasadas
            mantienen el precio que correspondía a su fecha.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-2.5">
          {linaje.versiones.map((v) => {
            const estado = estadoDeVersion(v.vigente_desde, v.vigente_hasta);

            const colores =
              estado === 'futura'
                ? {
                    border: 'hsl(var(--estado-senada) / 0.40)',
                    bg: 'hsl(var(--estado-senada) / 0.06)',
                    label: 'hsl(var(--estado-senada))',
                  }
                : estado === 'vigente'
                  ? {
                      border: 'hsl(var(--estado-pagada) / 0.40)',
                      bg: 'hsl(var(--estado-pagada) / 0.08)',
                      label: 'hsl(var(--estado-pagada))',
                    }
                  : {
                      border: 'hsl(var(--border))',
                      bg: 'transparent',
                      label: 'hsl(var(--muted-foreground))',
                    };

            const etiqueta =
              estado === 'futura'
                ? 'Programada'
                : estado === 'vigente'
                  ? 'Vigente hoy'
                  : 'Histórica';

            const Icon = estado === 'vigente' ? CircleDot : Circle;

            return (
              <li
                key={v.id}
                className="rounded-md border p-3"
                style={{ borderColor: colores.border, backgroundColor: colores.bg }}
              >
                <div className="flex items-start gap-2.5">
                  <Icon
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    style={{ color: colores.label }}
                    aria-hidden="true"
                  />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: colores.label }}
                      >
                        {etiqueta}
                      </span>
                      <span className="text-base font-semibold tabular-nums text-foreground">
                        {currencyFmt.format(v.monto)}
                      </span>
                    </div>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      Desde {fmt(v.vigente_desde)}
                      {v.vigente_hasta ? ` · hasta ${fmt(v.vigente_hasta)}` : ' · sin fecha de fin'}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
