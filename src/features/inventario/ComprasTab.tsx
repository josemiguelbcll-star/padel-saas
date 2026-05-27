import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Pencil,
  Plus,
  Receipt,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
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
import { useProveedores } from '@/features/configuracion/hooks/useProveedores';
import { MEDIO_PAGO_LABEL } from '@/features/finanzas/finanzasSchemas';
import type {
  Compra,
  EstadoCompra,
  Linea,
  MedioPago,
} from '@/types/database';
import { useCompras, type CompraListaFila } from './hooks/useCompras';
import { useCancelarOC } from './hooks/useCancelarOC';
import { NuevaOCDialog } from './NuevaOCDialog';
import { RecibirOCDialog } from './RecibirOCDialog';
import { DetalleCompraDialog } from './DetalleCompraDialog';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

function fmtDateISO(iso: string): string {
  return dateFmt.format(new Date(iso + 'T00:00:00'));
}

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

type PeriodoPreset = '7' | '30' | '90' | 'custom';
type LineaFiltro = 'todas' | Linea;
type EstadoFiltro = 'todos' | EstadoCompra;

interface ComprasFiltros {
  proveedorId: number | null;
  linea: LineaFiltro;
  estado: EstadoFiltro;
  periodo: PeriodoPreset;
  desde: string;
  hasta: string;
}

function getInitialFiltros(): ComprasFiltros {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - 29);
  return {
    proveedorId: null,
    linea: 'todas',
    estado: 'todos',
    periodo: '30',
    desde: fmtISO(desde),
    hasta: fmtISO(hoy),
  };
}

function resolveRango(f: ComprasFiltros): { desde: string; hasta: string } {
  if (f.periodo === 'custom') {
    return { desde: f.desde, hasta: f.hasta };
  }
  const dias = Number(f.periodo);
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - (dias - 1));
  return { desde: fmtISO(desde), hasta: fmtISO(hoy) };
}

export function ComprasTab() {
  const proveedoresQuery = useProveedores();
  const [filtros, setFiltros] = useState<ComprasFiltros>(getInitialFiltros);
  const rango = useMemo(() => resolveRango(filtros), [filtros]);

  const comprasQuery = useCompras({
    desde: rango.desde,
    hasta: rango.hasta,
    proveedorId: filtros.proveedorId,
    linea: filtros.linea === 'todas' ? null : filtros.linea,
    estado: filtros.estado === 'todos' ? null : filtros.estado,
  });

  // Dialogs state.
  const [nuevaOpen, setNuevaOpen] = useState(false);
  /** Compra en edición. Si !== null, el NuevaOCDialog se abre en modo edit. */
  const [editandoCompra, setEditandoCompra] = useState<Compra | null>(null);
  const [recibirCompraId, setRecibirCompraId] = useState<number | null>(null);
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [cancelandoFila, setCancelandoFila] = useState<CompraListaFila | null>(null);

  const proveedoresActivos = useMemo(
    () =>
      (proveedoresQuery.data ?? [])
        .filter((p) => p.activo)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [proveedoresQuery.data],
  );

  /**
   * Para editar necesitamos un objeto Compra completo, pero la lista nos
   * da una fila resumida. Construimos un Compra "stub" suficiente para
   * que NuevaOCDialog precargue la cabecera; el dialog carga los items
   * vía useCompra(id).
   */
  function openEditarFila(f: CompraListaFila) {
    // Cast manual al tipo Compra. Solo los campos que NuevaOCDialog usa
    // en modo edit son críticos. Los demás son ignored.
    const stub: Compra = {
      id: f.id,
      club_id: 0,                          // no usado por el dialog
      proveedor_id: f.proveedor_id,
      tipo: f.tipo,
      linea: f.linea,
      estado: f.estado,
      fecha_oc: f.fecha_oc,
      fecha_recepcion: f.fecha_recepcion,
      condicion_pago: f.condicion_pago,
      fecha_compromiso_pago: f.fecha_compromiso_pago,
      monto_neto_oc: f.monto_neto_oc,
      monto_neto: null,
      monto_iva: null,
      monto_total: f.monto_total,
      gasto_id: null,
      condicion_fiscal_club: null,
      comprobante_tipo: null,
      comprobante_numero: null,
      observaciones: f.observaciones,
      usuario_id: '',
      fecha_alta: '',
    };
    setEditandoCompra(stub);
  }

  return (
    <div className="space-y-4">
      <FiltrosBar
        filtros={filtros}
        onChange={setFiltros}
        proveedores={proveedoresActivos}
        onNueva={() => setNuevaOpen(true)}
      />

      {comprasQuery.isLoading && <SkeletonTabla />}

      {comprasQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {comprasQuery.error.message}
        </div>
      )}

      {comprasQuery.data && (
        <ComprasTable
          compras={comprasQuery.data}
          onRowClick={(c) => setDetalleId(c.id)}
          onEditar={openEditarFila}
          onCancelar={(f) => setCancelandoFila(f)}
          onRecibir={(c) => setRecibirCompraId(c.id)}
        />
      )}

      {/* Dialogs */}
      <NuevaOCDialog
        open={nuevaOpen}
        onOpenChange={setNuevaOpen}
        initialValue={null}
      />

      <NuevaOCDialog
        open={editandoCompra !== null}
        onOpenChange={(o) => {
          if (!o) setEditandoCompra(null);
        }}
        initialValue={editandoCompra}
      />

      <RecibirOCDialog
        open={recibirCompraId !== null}
        onOpenChange={(o) => {
          if (!o) setRecibirCompraId(null);
        }}
        compraId={recibirCompraId}
      />

      <DetalleCompraDialog
        open={detalleId !== null}
        onOpenChange={(o) => {
          if (!o) setDetalleId(null);
        }}
        compraId={detalleId}
      />

      <CancelarOCConfirm
        fila={cancelandoFila}
        onClose={() => setCancelandoFila(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Filtros
// ─────────────────────────────────────────────────────────────────────

interface FiltrosBarProps {
  filtros: ComprasFiltros;
  onChange: (f: ComprasFiltros) => void;
  proveedores: Array<{ id: number; nombre: string }>;
  onNueva: () => void;
}

function FiltrosBar({ filtros, onChange, proveedores, onNueva }: FiltrosBarProps) {
  function set<K extends keyof ComprasFiltros>(key: K, value: ComprasFiltros[K]) {
    onChange({ ...filtros, [key]: value });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Proveedor
          </Label>
          <select
            value={filtros.proveedorId ?? 'todos'}
            onChange={(e) =>
              set(
                'proveedorId',
                e.target.value === 'todos' ? null : Number(e.target.value),
              )
            }
            className={cn(
              'flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <option value="todos">Todos</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Línea
          </Label>
          <select
            value={filtros.linea}
            onChange={(e) => set('linea', e.target.value as LineaFiltro)}
            className={cn(
              'flex h-9 rounded-md border border-input bg-background px-2 text-xs',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <option value="todas">Todas</option>
            <option value="buffet">Buffet</option>
            <option value="shop">Shop</option>
          </select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Estado
          </Label>
          <div className="flex gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
            {(['todos', 'pedida', 'recibida', 'cancelada'] as const).map((opt) => {
              const isActive = filtros.estado === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => set('estado', opt)}
                  className={cn(
                    'rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt === 'todos' ? 'Todas' : opt}
                </button>
              );
            })}
          </div>
        </div>

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
              <Label
                htmlFor="comp-desde"
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Desde
              </Label>
              <Input
                id="comp-desde"
                type="date"
                value={filtros.desde}
                onChange={(e) => set('desde', e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="comp-hasta"
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Hasta
              </Label>
              <Input
                id="comp-hasta"
                type="date"
                value={filtros.hasta}
                onChange={(e) => set('hasta', e.target.value)}
                className="h-9"
              />
            </div>
          </>
        )}

        <div className="ml-auto flex items-end pb-0.5">
          <Button type="button" onClick={onNueva}>
            <Plus className="h-4 w-4" />
            Nueva OC
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tabla
// ─────────────────────────────────────────────────────────────────────

interface ComprasTableProps {
  compras: CompraListaFila[];
  onRowClick: (c: CompraListaFila) => void;
  onEditar: (c: CompraListaFila) => void;
  onCancelar: (c: CompraListaFila) => void;
  onRecibir: (c: CompraListaFila) => void;
}

function ComprasTable({
  compras,
  onRowClick,
  onEditar,
  onCancelar,
  onRecibir,
}: ComprasTableProps) {
  if (compras.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          No hay compras que coincidan con los filtros. Cargá una con
          "Nueva OC".
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
            {compras.length}
          </strong>{' '}
          compra{compras.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-semibold">Fecha</th>
              <th className="px-3 py-2 text-left font-semibold">Proveedor</th>
              <th className="px-3 py-2 text-left font-semibold">Línea</th>
              <th className="px-3 py-2 text-left font-semibold">Estado</th>
              <th className="px-3 py-2 text-right font-semibold">Ítems</th>
              <th className="px-3 py-2 text-right font-semibold">Monto</th>
              <th className="px-3 py-2 text-left font-semibold">Pago</th>
              <th className="w-1 px-4 py-2 text-right">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <ComprasRow
                key={c.id}
                c={c}
                onClick={() => onRowClick(c)}
                onEditar={() => onEditar(c)}
                onCancelar={() => onCancelar(c)}
                onRecibir={() => onRecibir(c)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ComprasRowProps {
  c: CompraListaFila;
  onClick: () => void;
  onEditar: () => void;
  onCancelar: () => void;
  onRecibir: () => void;
}

function ComprasRow({
  c,
  onClick,
  onEditar,
  onCancelar,
  onRecibir,
}: ComprasRowProps) {
  // Fecha principal: si está recibida, mostramos fecha_recepcion; si no,
  // fecha_oc. Debajo, la fecha_oc en chico (cuando recibida).
  const fechaPrincipal =
    c.estado === 'recibida' && c.fecha_recepcion
      ? c.fecha_recepcion
      : c.fecha_oc;
  const showFechaOcAbajo = c.estado === 'recibida' && c.fecha_recepcion !== c.fecha_oc;

  // Monto: en pedida mostramos monto_neto_oc con sufijo "NETO"; en
  // recibida monto_total (con IVA); en cancelada "—".
  let montoCell: React.ReactNode;
  if (c.estado === 'cancelada') {
    montoCell = <span className="text-muted-foreground">—</span>;
  } else if (c.estado === 'pedida') {
    montoCell = (
      <>
        <span className="tabular-nums text-foreground">{fmtMoney(c.monto_neto_oc)}</span>
        <span className="ml-1 text-[10px] text-muted-foreground">neto</span>
      </>
    );
  } else {
    montoCell = (
      <span className="tabular-nums font-semibold text-foreground">
        {fmtMoney(c.monto_total ?? 0)}
      </span>
    );
  }

  return (
    <tr
      onClick={onClick}
      tabIndex={0}
      role="button"
      aria-label={`Ver detalle de compra #${c.id}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'cursor-pointer border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/30 focus:bg-muted/40 focus:outline-none',
        c.estado === 'cancelada' && 'opacity-60',
      )}
    >
      <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
        {fmtDateISO(fechaPrincipal)}
        {showFechaOcAbajo && (
          <p className="text-[10px] text-muted-foreground/70">
            OC {fmtDateISO(c.fecha_oc)}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5 text-sm font-medium text-foreground">
        {c.proveedor_nombre ?? (
          <span className="italic text-muted-foreground">(eliminado)</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {c.linea}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <EstadoChip estado={c.estado} />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
        {c.estado === 'cancelada' ? '—' : c.items_count}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">{montoCell}</td>
      <td className="px-3 py-2.5">
        <PagoChip
          estado={c.pago_estado}
          medio={c.pago_medio}
          pagadas={c.pago_cuotas_pagadas}
          total={c.pago_cuotas_total}
        />
      </td>
      <td
        className="px-4 py-2.5 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end gap-1">
          {c.estado === 'pedida' ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onEditar}
                aria-label={`Editar OC #${c.id}`}
                title="Editar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancelar}
                aria-label={`Cancelar OC #${c.id}`}
                title="Cancelar"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onRecibir}
                aria-label={`Recibir OC #${c.id}`}
              >
                <Receipt className="h-3.5 w-3.5" />
                Recibir
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClick}
              aria-label={`Ver detalle de compra #${c.id}`}
            >
              Ver
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function EstadoChip({ estado }: { estado: EstadoCompra }) {
  if (estado === 'pedida') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Pedida
      </span>
    );
  }
  if (estado === 'recibida') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Recibida
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      Cancelada
    </span>
  );
}

function PagoChip({
  estado,
  medio,
  pagadas,
  total,
}: {
  estado: 'pagada' | 'parcial' | 'pendiente' | null;
  medio: MedioPago | 'varios' | null;
  pagadas?: number;
  total?: number;
}) {
  if (estado === null) {
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (estado === 'pendiente') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Pendiente
      </span>
    );
  }
  if (estado === 'parcial') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Parcial{pagadas != null && total != null ? ` · ${pagadas}/${total}` : ''}
      </span>
    );
  }
  // pagada
  const medioLabel = medio === 'varios' ? 'Varios' : medio ? MEDIO_PAGO_LABEL[medio] : '';
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Pagada{medioLabel ? ` · ${medioLabel}` : ''}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Confirm de cancelar OC (inline dialog)
// ─────────────────────────────────────────────────────────────────────

interface CancelarOCConfirmProps {
  fila: CompraListaFila | null;
  onClose: () => void;
}

function CancelarOCConfirm({ fila, onClose }: CancelarOCConfirmProps) {
  const cancelar = useCancelarOC();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Limpiar al cerrar.
  function handleClose() {
    setMotivo('');
    setError(null);
    onClose();
  }

  async function handleConfirmar() {
    if (!fila) return;
    setError(null);
    try {
      await cancelar.mutateAsync({
        compra_id: fila.id,
        motivo: motivo.trim() === '' ? null : motivo.trim(),
      });
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos cancelar la OC. Probá de nuevo.',
      );
    }
  }

  return (
    <Dialog
      open={fila !== null}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            Cancelar OC {fila ? `#${fila.id}` : ''}
          </DialogTitle>
          <DialogDescription>
            La OC pasa a estado <strong>cancelada</strong>. No toca stock,
            costo ni gasto (nunca los impactó). Es irreversible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="cancel-motivo" className="text-xs">
            Motivo <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <textarea
            id="cancel-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            disabled={cancelar.isPending}
            rows={2}
            maxLength={500}
            placeholder="Ej: el proveedor canceló el pedido."
            className={cn(
              'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
          <p className="text-[11px] text-muted-foreground">
            Si lo dejás vacío, no se agrega nada a las observaciones.
          </p>
        </div>

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
            onClick={handleClose}
            disabled={cancelar.isPending}
          >
            No, volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              void handleConfirmar();
            }}
            disabled={cancelar.isPending}
          >
            {cancelar.isPending ? 'Cancelando…' : 'Sí, cancelar OC'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkeletonTabla() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-md border border-border bg-muted/30"
        />
      ))}
    </div>
  );
}
