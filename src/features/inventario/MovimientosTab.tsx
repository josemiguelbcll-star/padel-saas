import { useMemo, useState } from 'react';
import { History, Receipt } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FuenteMovimientoStock } from '@/types/database';
import { useInventarioProductos } from './hooks/useInventarioProductos';
import {
  useMovimientosStock,
  type MovimientoStockAuditoria,
} from './hooks/useMovimientosStock';

type PeriodoPreset = '7' | '30' | '90' | 'custom';
type FuenteFiltro = 'todas' | FuenteMovimientoStock;

interface MovimientosFiltros {
  productoId: number | null;
  fuente: FuenteFiltro;
  periodo: PeriodoPreset;
  /** Solo aplica si periodo === 'custom'. YYYY-MM-DD. */
  desde: string;
  /** Solo aplica si periodo === 'custom'. YYYY-MM-DD. */
  hasta: string;
}

// Etiquetas en castellano para cada fuente, alineadas con FuenteMovimientoStock.
const FUENTE_LABEL: Record<FuenteMovimientoStock, string> = {
  venta: 'Venta',
  compra_manual: 'Compra manual',
  ajuste: 'Ajuste',
  compra_bot_whatsapp: 'Compra (bot WhatsApp)',
  consumo_turno: 'Consumo de turno',
  reposicion_consumo: 'Quitado de consumo',
};

const FUENTE_OPTIONS: ReadonlyArray<{ value: FuenteFiltro; label: string }> = [
  { value: 'todas', label: 'Todas' },
  { value: 'venta', label: 'Venta' },
  { value: 'compra_manual', label: 'Compra manual' },
  { value: 'ajuste', label: 'Ajuste' },
  { value: 'compra_bot_whatsapp', label: 'Compra (bot WhatsApp)' },
  { value: 'consumo_turno', label: 'Consumo de turno' },
  { value: 'reposicion_consumo', label: 'Quitado de consumo' },
];

const dateTimeFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getInitialFiltros(): MovimientosFiltros {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - 29);
  return {
    productoId: null,
    fuente: 'todas',
    periodo: '30',
    desde: fmtISO(desde),
    hasta: fmtISO(hoy),
  };
}

/**
 * Resuelve el rango efectivo (YYYY-MM-DD desde/hasta) a partir de los
 * filtros. Para los presets de N días, calculamos hasta=hoy y
 * desde=hoy-(N-1) (inclusivo). Para custom, usa los valores del input.
 */
function resolveRango(f: MovimientosFiltros): { desde: string; hasta: string } {
  if (f.periodo === 'custom') {
    return { desde: f.desde, hasta: f.hasta };
  }
  const dias = Number(f.periodo);
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - (dias - 1));
  return { desde: fmtISO(desde), hasta: fmtISO(hoy) };
}

export function MovimientosTab() {
  const productosQuery = useInventarioProductos();
  const [filtros, setFiltros] = useState<MovimientosFiltros>(getInitialFiltros);

  const rango = useMemo(() => resolveRango(filtros), [filtros]);
  const movimientosQuery = useMovimientosStock({
    productoId: filtros.productoId,
    fuente: filtros.fuente === 'todas' ? null : filtros.fuente,
    desde: rango.desde,
    hasta: rango.hasta,
  });

  const productos = productosQuery.data ?? [];

  return (
    <div className="space-y-4">
      <FiltrosBar
        filtros={filtros}
        onChange={setFiltros}
        productos={productos}
      />

      {movimientosQuery.isLoading && <SkeletonTabla />}
      {movimientosQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {movimientosQuery.error.message}
        </div>
      )}
      {movimientosQuery.data && (
        <MovimientosTable movimientos={movimientosQuery.data} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Filtros
// ─────────────────────────────────────────────────────────────────────

interface FiltrosBarProps {
  filtros: MovimientosFiltros;
  onChange: (f: MovimientosFiltros) => void;
  productos: Array<{ id: number; nombre: string; linea: string }>;
}

function FiltrosBar({ filtros, onChange, productos }: FiltrosBarProps) {
  function set<K extends keyof MovimientosFiltros>(
    key: K,
    value: MovimientosFiltros[K],
  ) {
    onChange({ ...filtros, [key]: value });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        {/* Producto */}
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Producto
          </Label>
          <select
            value={filtros.productoId === null ? 'todos' : String(filtros.productoId)}
            onChange={(e) =>
              set(
                'productoId',
                e.target.value === 'todos' ? null : Number(e.target.value),
              )
            }
            className={cn(
              'flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <option value="todos">Todos los productos</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · {p.linea}
              </option>
            ))}
          </select>
        </div>

        {/* Fuente */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Fuente
          </Label>
          <select
            value={filtros.fuente}
            onChange={(e) => set('fuente', e.target.value as FuenteFiltro)}
            className={cn(
              'flex h-9 rounded-md border border-input bg-background px-2 text-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            {FUENTE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Período */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Período
          </Label>
          <div className="flex gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
            {(['7', '30', '90', 'custom'] as const).map((opt) => {
              const isActive = filtros.periodo === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => set('periodo', opt)}
                  className={cn(
                    'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt === 'custom' ? 'Rango' : `${opt}d`}
                </button>
              );
            })}
          </div>
        </div>

        {filtros.periodo === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="mov-desde" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Desde
              </Label>
              <Input
                id="mov-desde"
                type="date"
                value={filtros.desde}
                onChange={(e) => set('desde', e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mov-hasta" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Hasta
              </Label>
              <Input
                id="mov-hasta"
                type="date"
                value={filtros.hasta}
                onChange={(e) => set('hasta', e.target.value)}
                className="h-9"
              />
            </div>
          </>
        )}

        {(filtros.productoId !== null ||
          filtros.fuente !== 'todas' ||
          filtros.periodo !== '30') && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(getInitialFiltros())}
          >
            Limpiar
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tabla
// ─────────────────────────────────────────────────────────────────────

function MovimientosTable({
  movimientos,
}: {
  movimientos: MovimientoStockAuditoria[];
}) {
  if (movimientos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <History className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          No hay movimientos de stock que coincidan con los filtros.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          Mostrando{' '}
          <strong className="font-semibold text-foreground tabular-nums">
            {movimientos.length}
          </strong>{' '}
          movimiento{movimientos.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-semibold">Fecha</th>
              <th className="px-3 py-2 text-left font-semibold">Producto</th>
              <th className="px-3 py-2 text-left font-semibold">Fuente</th>
              <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
              <th className="px-3 py-2 text-left font-semibold">Venta</th>
              <th className="px-3 py-2 text-left font-semibold">Usuario</th>
              <th className="px-4 py-2 text-left font-semibold">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <MovimientoRow key={m.id} m={m} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovimientoRow({ m }: { m: MovimientoStockAuditoria }) {
  const entrada = m.cantidad > 0;
  return (
    <tr className="border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/20">
      <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
        {dateTimeFmt.format(new Date(m.fecha_hora))}
      </td>
      <td className="px-3 py-2.5">
        <span className="font-medium text-foreground">
          {m.producto_nombre ?? <span className="italic text-muted-foreground">(producto eliminado)</span>}
        </span>
        {m.producto_linea && (
          <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {m.producto_linea}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <FuenteChip fuente={m.fuente} />
      </td>
      <td
        className={cn(
          'px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap',
          entrada
            ? 'text-emerald-600 dark:text-emerald-500'
            : 'text-red-600 dark:text-red-500',
        )}
      >
        {entrada ? '+' : ''}{m.cantidad}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
        {m.venta_id !== null ? (
          <span className="inline-flex items-center gap-1">
            <Receipt className="h-3 w-3" aria-hidden="true" />
            #{m.venta_id}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">
        {m.usuario_nombre ?? <span className="italic">(desconocido)</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {m.observaciones ?? '—'}
      </td>
    </tr>
  );
}

function FuenteChip({ fuente }: { fuente: keyof typeof FUENTE_LABEL }) {
  // Colores discretos por categoría: entradas (compras) en verdoso, salidas
  // (ventas/consumos) en rojizo, ajustes y reposiciones en gris.
  const klass = (() => {
    switch (fuente) {
      case 'compra_manual':
      case 'compra_bot_whatsapp':
      case 'reposicion_consumo':
        return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
      case 'venta':
      case 'consumo_turno':
        return 'bg-red-500/10 text-red-700 dark:text-red-400';
      case 'ajuste':
        return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
      default:
        return 'bg-muted text-muted-foreground';
    }
  })();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        klass,
      )}
    >
      {FUENTE_LABEL[fuente]}
    </span>
  );
}

function SkeletonTabla() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-md border border-border bg-muted/30" />
      ))}
    </div>
  );
}
