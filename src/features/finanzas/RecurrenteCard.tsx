import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RecurrenteFila } from './hooks/useGastosRecurrentes';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

export type EstadoRecurrente = 'cargado' | 'vencido' | 'por_vencer';

export interface RecurrenteCardData {
  fila: RecurrenteFila;
  estado: EstadoRecurrente;
  /** Día efectivo del mes (1..ultimoDelMes), ya clamped. */
  diaEfectivo: number;
  /** Gastos reales vinculados que caen en el mes activo. */
  realesDelMes: ReadonlyArray<{
    id: number;
    monto: number;
    fecha_gasto: string;
    fecha_pago: string | null;
  }>;
}

interface RecurrenteCardProps {
  data: RecurrenteCardData;
  onCargarReal: () => void;
  /** Solo se usa cuando estado === 'cargado': anula el real del mes y
   *  reabre el dialog para cargar el correcto. */
  onCorregir: () => void;
  onEditar: () => void;
  onDesactivar: () => void;
  onEliminar: () => void;
}

const ESTADO_TONO: Record<
  EstadoRecurrente,
  { borderColor: string; chipBg: string; chipText: string; icon: typeof Check }
> = {
  cargado: {
    borderColor: 'border-l-emerald-500',
    chipBg: 'bg-emerald-500/10',
    chipText: 'text-emerald-700 dark:text-emerald-400',
    icon: Check,
  },
  vencido: {
    borderColor: 'border-l-red-500',
    chipBg: 'bg-red-500/10',
    chipText: 'text-red-700 dark:text-red-400',
    icon: AlertTriangle,
  },
  por_vencer: {
    borderColor: 'border-l-amber-500',
    chipBg: 'bg-amber-500/10',
    chipText: 'text-amber-700 dark:text-amber-400',
    icon: Clock,
  },
};

export function RecurrenteCard({
  data,
  onCargarReal,
  onCorregir,
  onEditar,
  onDesactivar,
  onEliminar,
}: RecurrenteCardProps) {
  const { fila, estado, diaEfectivo, realesDelMes } = data;
  const tono = ESTADO_TONO[estado];
  const TonoIcon = tono.icon;
  const [menuOpen, setMenuOpen] = useState(false);

  const sumReal = realesDelMes.reduce((acc, r) => acc + r.monto, 0);
  const cantReales = realesDelMes.length;

  return (
    <article
      className={cn(
        'relative flex flex-col rounded-lg border-l-4 border border-border bg-card p-4',
        'shadow-sm transition-colors hover:bg-card/80',
        tono.borderColor,
      )}
    >
      {/* Header: concepto + menú */}
      <header className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {fila.concepto}
          </h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {fila.categoria_nombre} · {fila.unidad_nombre}
          </p>
          {fila.proveedor_nombre && (
            <p className="truncate text-[10px] text-muted-foreground/80">
              {fila.proveedor_nombre}
            </p>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Más acciones"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground',
              'hover:bg-muted hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onEditar(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Editar plantilla
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onDesactivar(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Power className="h-3.5 w-3.5" aria-hidden="true" />
                  Desactivar
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onEliminar(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Eliminar
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Monto */}
      <div className="mt-3 space-y-0.5">
        {estado === 'cargado' ? (
          <>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Real cargado
            </p>
            <p className="text-xl font-bold tabular-nums text-foreground">
              {fmtMoney(sumReal)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              estimado {fmtMoney(fila.monto_estimado)}
              {cantReales > 1 && (
                <span className="ml-1 inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                  +{cantReales - 1} más
                </span>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Estimado
            </p>
            <p className="text-xl font-bold tabular-nums text-muted-foreground">
              {fmtMoney(fila.monto_estimado)}
            </p>
          </>
        )}
      </div>

      {/* Estado chip */}
      <div className="mt-3">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
            tono.chipBg,
            tono.chipText,
          )}
        >
          <TonoIcon className="h-2.5 w-2.5" aria-hidden="true" />
          {estado === 'cargado' && (
            <>Cargado este mes</>
          )}
          {estado === 'vencido' && (
            <>Venció el día {diaEfectivo}</>
          )}
          {estado === 'por_vencer' && (
            <>Vence el día {diaEfectivo}</>
          )}
        </span>
      </div>

      {/* Acción primaria. Si ya hay un real del mes, el backend rechaza
          cargar otro (uno-por-mes, 0049) → ofrecemos "Corregir" (anular
          el real + recargar) en lugar de "Cargar otro". */}
      <div className="mt-3 flex">
        {estado === 'cargado' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCorregir}
            className="w-full"
          >
            <Pencil className="h-3.5 w-3.5" />
            Corregir
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={onCargarReal}
            className="w-full"
          >
            <Plus className="h-3.5 w-3.5" />
            Cargar real
          </Button>
        )}
      </div>
    </article>
  );
}
