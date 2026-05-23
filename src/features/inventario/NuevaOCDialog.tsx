import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CircleDashed,
  ClipboardList,
  Plus,
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
import type {
  Compra,
  CondicionPago,
  Linea,
  ProductoConStock,
} from '@/types/database';
import { useInventarioProductos } from './hooks/useInventarioProductos';
import { useCompra } from './hooks/useCompra';
import {
  useCrearOC,
  type CrearOCItemInput,
} from './hooks/useCrearOC';
import { useActualizarOC } from './hooks/useActualizarOC';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeUid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Estado del formulario
// ─────────────────────────────────────────────────────────────────────

interface ItemFormState {
  uid: string;
  producto_id: number | null;
  suelta: boolean;
  /** String del input. Si suelta=true, representa unidades. */
  cantidad_bultos: string;
  /** String del input. Ignorado (vacío) si suelta=true. */
  unidades_por_bulto: string;
  /** String del input. NETO. Si suelta=true, representa $/unidad. */
  costo_por_bulto: string;
}

interface FormState {
  proveedor_id: number | null;
  linea: Linea | null;
  fecha_oc: string;
  items: ItemFormState[];
  condicion_pago: CondicionPago;
  fecha_compromiso_pago: string;
  observaciones: string;
}

function makeEmptyItem(): ItemFormState {
  return {
    uid: makeUid(),
    producto_id: null,
    suelta: false,
    cantidad_bultos: '',
    unidades_por_bulto: '',
    costo_por_bulto: '',
  };
}

function initialState(): FormState {
  return {
    proveedor_id: null,
    linea: null,
    fecha_oc: todayISO(),
    items: [makeEmptyItem()],
    condicion_pago: 'al_recibir',
    fecha_compromiso_pago: '',
    observaciones: '',
  };
}

// Derivado por item: cálculo en vivo NETO.
interface ItemCalc {
  cantidad: number | null;
  costo_unitario: number | null;
  subtotal: number | null;
  incompleto: boolean;
}

const EMPTY_CALC: ItemCalc = {
  cantidad: null,
  costo_unitario: null,
  subtotal: null,
  incompleto: true,
};

function computeItemCalc(it: ItemFormState): ItemCalc {
  const bultos = it.cantidad_bultos.trim() === '' ? NaN : Number(it.cantidad_bultos);
  const und = it.suelta ? 1 : it.unidades_por_bulto.trim() === '' ? NaN : Number(it.unidades_por_bulto);
  const costo = it.costo_por_bulto.trim() === '' ? NaN : Number(it.costo_por_bulto);

  const valid =
    Number.isFinite(bultos) && bultos > 0 &&
    Number.isFinite(und) && und > 0 &&
    Number.isFinite(costo) && costo >= 0;

  if (!valid) return EMPTY_CALC;
  const cantidad = Math.trunc(bultos * und);
  const costoUnit = Math.round((costo / und) * 100) / 100;
  const subtotal = Math.round(bultos * costo * 100) / 100;
  return { cantidad, costo_unitario: costoUnit, subtotal, incompleto: false };
}

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────

interface NuevaOCDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si viene, modo EDITAR esa OC (estado='pedida' garantizado por la RPC). */
  initialValue: Compra | null;
}

export function NuevaOCDialog({
  open,
  onOpenChange,
  initialValue,
}: NuevaOCDialogProps) {
  const proveedoresQuery = useProveedores();
  const productosQuery = useInventarioProductos();
  const crear = useCrearOC();
  const actualizar = useActualizarOC();

  // Si estamos editando, traer items existentes para pre-llenar.
  const detalleQuery = useCompra(initialValue?.id ?? null);

  const isEdit = initialValue !== null;
  const pending = crear.isPending || actualizar.isPending;

  const [state, setState] = useState<FormState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [confirmLineaChange, setConfirmLineaChange] = useState<Linea | null>(null);

  // Resetear / pre-llenar al abrir.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmLineaChange(null);

    if (initialValue === null) {
      // Modo crear.
      setState(initialState());
      return;
    }

    // Modo editar: cabecera ya está en initialValue. Items vienen del
    // detalle (efecto separado más abajo).
    setState({
      proveedor_id: initialValue.proveedor_id,
      linea: initialValue.linea,
      fecha_oc: initialValue.fecha_oc,
      items: [],
      condicion_pago: initialValue.condicion_pago,
      fecha_compromiso_pago: initialValue.fecha_compromiso_pago ?? '',
      observaciones: initialValue.observaciones ?? '',
    });
  }, [open, initialValue]);

  // Pre-llenar items cuando llega el detalle (modo edit).
  useEffect(() => {
    if (!open || !isEdit) return;
    if (!detalleQuery.data) return;
    const items: ItemFormState[] = detalleQuery.data.items.map((it) => ({
      uid: makeUid(),
      producto_id: it.producto_id,
      suelta: it.unidades_por_bulto === 1,
      cantidad_bultos: String(it.cantidad_bultos),
      unidades_por_bulto: it.unidades_por_bulto === 1 ? '' : String(it.unidades_por_bulto),
      costo_por_bulto: String(it.costo_por_bulto),
    }));
    setState((s) => ({ ...s, items: items.length === 0 ? [makeEmptyItem()] : items }));
  }, [open, isEdit, detalleQuery.data]);

  const proveedoresActivos = useMemo(
    () => (proveedoresQuery.data ?? []).filter((p) => p.activo),
    [proveedoresQuery.data],
  );

  const productosDisponibles = useMemo(() => {
    if (!state.linea) return [];
    return (productosQuery.data ?? []).filter(
      (p) => p.activo && p.linea === state.linea,
    );
  }, [productosQuery.data, state.linea]);

  const productosById = useMemo(() => {
    const m = new Map<number, ProductoConStock>();
    for (const p of productosQuery.data ?? []) m.set(p.id, p);
    return m;
  }, [productosQuery.data]);

  const idsYaUsados = useMemo(
    () =>
      new Set(
        state.items
          .map((i) => i.producto_id)
          .filter((id): id is number => id !== null),
      ),
    [state.items],
  );

  const itemCalcs = useMemo(
    () => state.items.map(computeItemCalc),
    [state.items],
  );

  const totalNeto = useMemo(
    () => itemCalcs.reduce((acc, c) => acc + (c.subtotal ?? 0), 0),
    [itemCalcs],
  );

  const submitDisabledReason = computeSubmitDisabledReason({
    state,
    itemCalcs,
    proveedoresActivos: proveedoresActivos.length,
  });
  const submitDisabled = submitDisabledReason !== null;

  // ── Helpers ────────────────────────────────────────────────────────

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function handleLineaClick(nuevaLinea: Linea) {
    if (state.linea === nuevaLinea) return;
    const hayItemsConProducto = state.items.some((i) => i.producto_id !== null);
    if (hayItemsConProducto) {
      setConfirmLineaChange(nuevaLinea);
      return;
    }
    setState((s) => ({ ...s, linea: nuevaLinea, items: [makeEmptyItem()] }));
  }

  function confirmarCambioLinea() {
    if (!confirmLineaChange) return;
    setState((s) => ({
      ...s,
      linea: confirmLineaChange,
      items: [makeEmptyItem()],
    }));
    setConfirmLineaChange(null);
  }

  function updateItem(uid: string, patch: Partial<ItemFormState>) {
    setState((s) => ({
      ...s,
      items: s.items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)),
    }));
  }

  function toggleSuelta(uid: string, nextSuelta: boolean) {
    // ⚠ El toggle cambia el SIGNIFICADO de costo_por_bulto y
    // unidades_por_bulto. Limpiamos ambos para evitar errores
    // silenciosos (ej. $3.600/bulto leído como $/unidad).
    setState((s) => ({
      ...s,
      items: s.items.map((it) =>
        it.uid === uid
          ? {
              ...it,
              suelta: nextSuelta,
              costo_por_bulto: '',
              unidades_por_bulto: '',
            }
          : it,
      ),
    }));
  }

  function addItem() {
    setState((s) => ({ ...s, items: [...s.items, makeEmptyItem()] }));
  }

  function removeItem(uid: string) {
    setState((s) => {
      const nextItems = s.items.filter((it) => it.uid !== uid);
      return {
        ...s,
        items: nextItems.length === 0 ? [makeEmptyItem()] : nextItems,
      };
    });
  }

  function handleCondicionPagoChange(siguiente: CondicionPago) {
    setState((s) => ({
      ...s,
      condicion_pago: siguiente,
      // Si cambiamos a un valor que no es a_plazo, limpiamos la fecha.
      fecha_compromiso_pago: siguiente === 'a_plazo' ? s.fecha_compromiso_pago : '',
    }));
  }

  // ── Submit ─────────────────────────────────────────────────────────

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (submitDisabled) {
      setError(submitDisabledReason ?? 'Faltan datos en el formulario.');
      return;
    }
    if (!state.proveedor_id || !state.linea) return;

    const items: CrearOCItemInput[] = state.items.map((it) => {
      const bultos = Number(it.cantidad_bultos);
      const und = it.suelta ? 1 : Number(it.unidades_por_bulto);
      const costo = Number(it.costo_por_bulto);
      return {
        producto_id: it.producto_id as number,
        cantidad_bultos: Math.trunc(bultos),
        unidades_por_bulto: Math.trunc(und),
        costo_por_bulto: costo,
      };
    });

    const payload = {
      proveedor_id: state.proveedor_id,
      linea: state.linea,
      fecha_oc: state.fecha_oc,
      items,
      condicion_pago: state.condicion_pago,
      fecha_compromiso_pago:
        state.condicion_pago === 'a_plazo' ? state.fecha_compromiso_pago : null,
      observaciones: state.observaciones.trim() === '' ? null : state.observaciones.trim(),
    };

    try {
      if (isEdit && initialValue) {
        await actualizar.mutateAsync({ compra_id: initialValue.id, ...payload });
      } else {
        await crear.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEdit
            ? 'No pudimos actualizar la OC. Probá de nuevo.'
            : 'No pudimos crear la OC. Probá de nuevo.',
      );
    }
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  // En modo edit, mientras carga el detalle, mostrar spinner para que
  // no se vea el form vacío.
  const loadingDetalle = isEdit && detalleQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
            {isEdit ? `Editar OC #${initialValue?.id}` : 'Nueva orden de compra'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Modificá los datos del pedido. La OC todavía no asentó nada — los cambios reemplazan los items vigentes.'
              : 'Documento de pedido en NETO. Sin IVA, sin pago. El IVA y el pago se cargan al recibir la factura.'}
          </DialogDescription>
        </DialogHeader>

        {loadingDetalle ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md border border-border bg-muted/30"
              />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <CabeceraSection
              state={state}
              proveedores={proveedoresActivos}
              proveedoresLoading={proveedoresQuery.isLoading}
              disabled={pending}
              onProveedorChange={(id) => setField('proveedor_id', id)}
              onLineaClick={handleLineaClick}
              onFechaChange={(v) => setField('fecha_oc', v)}
            />

            <ItemsSection
              items={state.items}
              calcs={itemCalcs}
              linea={state.linea}
              productosDisponibles={productosDisponibles}
              productosById={productosById}
              productosLoading={productosQuery.isLoading}
              idsYaUsados={idsYaUsados}
              disabled={pending}
              onUpdateItem={updateItem}
              onToggleSuelta={toggleSuelta}
              onAddItem={addItem}
              onRemoveItem={removeItem}
            />

            <CondicionPagoSection
              state={state}
              disabled={pending}
              onCondicionPagoChange={handleCondicionPagoChange}
              onFechaCompromisoChange={(v) => setField('fecha_compromiso_pago', v)}
            />

            <div className="space-y-1.5">
              <Label htmlFor="oc-obs" className="text-xs">
                Observaciones <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <textarea
                id="oc-obs"
                value={state.observaciones}
                onChange={(e) => setField('observaciones', e.target.value)}
                disabled={pending}
                rows={2}
                maxLength={500}
                className={cn(
                  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Total NETO de la OC
                </p>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {fmtMoney(totalNeto)}
                </p>
              </div>
              <DialogFooter className="m-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={pending}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={pending || submitDisabled}
                  title={submitDisabledReason ?? undefined}
                >
                  {pending
                    ? isEdit
                      ? 'Guardando…'
                      : 'Creando…'
                    : isEdit
                      ? 'Guardar cambios'
                      : 'Crear OC'}
                </Button>
              </DialogFooter>
            </div>
          </form>
        )}

        <Dialog
          open={confirmLineaChange !== null}
          onOpenChange={(o) => {
            if (!o) setConfirmLineaChange(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>¿Cambiar la línea?</DialogTitle>
              <DialogDescription>
                Tenés productos cargados en la línea actual. Si cambiás
                a {confirmLineaChange === 'buffet' ? 'Buffet' : 'Shop'},
                la lista se va a vaciar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmLineaChange(null)}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={confirmarCambioLinea}>
                Sí, cambiar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cabecera
// ─────────────────────────────────────────────────────────────────────

interface CabeceraSectionProps {
  state: FormState;
  proveedores: Array<{ id: number; nombre: string }>;
  proveedoresLoading: boolean;
  disabled: boolean;
  onProveedorChange: (id: number | null) => void;
  onLineaClick: (l: Linea) => void;
  onFechaChange: (v: string) => void;
}

function CabeceraSection({
  state,
  proveedores,
  proveedoresLoading,
  disabled,
  onProveedorChange,
  onLineaClick,
  onFechaChange,
}: CabeceraSectionProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="oc-proveedor" className="text-xs">
          Proveedor <span className="text-destructive">*</span>
        </Label>
        <select
          id="oc-proveedor"
          autoFocus
          value={state.proveedor_id ?? ''}
          onChange={(e) =>
            onProveedorChange(e.target.value === '' ? null : Number(e.target.value))
          }
          disabled={disabled || proveedoresLoading}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <option value="">
            {proveedoresLoading ? 'Cargando…' : 'Elegí un proveedor…'}
          </option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        {!proveedoresLoading && proveedores.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No hay proveedores activos. Andá a Configuración → Proveedores
            para crear uno.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Línea <span className="text-destructive">*</span>
        </Label>
        <div className="flex gap-1.5">
          {(['buffet', 'shop'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onLineaClick(l)}
              disabled={disabled}
              aria-pressed={state.linea === l}
              className={cn(
                'flex-1 rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                state.linea === l
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="oc-fecha" className="text-xs">
          Fecha de la OC <span className="text-destructive">*</span>
        </Label>
        <Input
          id="oc-fecha"
          type="date"
          value={state.fecha_oc}
          onChange={(e) => onFechaChange(e.target.value)}
          disabled={disabled}
          required
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Ítems
// ─────────────────────────────────────────────────────────────────────

interface ItemsSectionProps {
  items: ItemFormState[];
  calcs: ItemCalc[];
  linea: Linea | null;
  productosDisponibles: ProductoConStock[];
  productosById: Map<number, ProductoConStock>;
  productosLoading: boolean;
  idsYaUsados: Set<number>;
  disabled: boolean;
  onUpdateItem: (uid: string, patch: Partial<ItemFormState>) => void;
  onToggleSuelta: (uid: string, suelta: boolean) => void;
  onAddItem: () => void;
  onRemoveItem: (uid: string) => void;
}

function ItemsSection({
  items,
  calcs,
  linea,
  productosDisponibles,
  productosById,
  productosLoading,
  idsYaUsados,
  disabled,
  onUpdateItem,
  onToggleSuelta,
  onAddItem,
  onRemoveItem,
}: ItemsSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">
          Ítems de la OC (en NETO, sin IVA) <span className="text-destructive">*</span>
        </Label>
        <p className="text-[11px] text-muted-foreground">
          {items.length} ítem{items.length === 1 ? '' : 's'}
        </p>
      </div>

      {linea === null && (
        <div className="rounded-md border border-dashed border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Elegí primero la línea (buffet o shop) para empezar a agregar
            productos.
          </p>
        </div>
      )}

      {linea !== null && (
        <div className="space-y-2">
          {items.map((it, idx) => (
            <ItemCard
              key={it.uid}
              item={it}
              calc={calcs[idx] ?? EMPTY_CALC}
              producto={
                it.producto_id !== null
                  ? (productosById.get(it.producto_id) ?? null)
                  : null
              }
              productosDisponibles={productosDisponibles}
              productosLoading={productosLoading}
              idsYaUsados={idsYaUsados}
              disabled={disabled}
              onChange={(patch) => onUpdateItem(it.uid, patch)}
              onToggleSuelta={(v) => onToggleSuelta(it.uid, v)}
              onRemove={() => onRemoveItem(it.uid)}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddItem}
            disabled={disabled}
            className="w-full"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar producto
          </Button>
        </div>
      )}
    </div>
  );
}

interface ItemCardProps {
  item: ItemFormState;
  calc: ItemCalc;
  producto: ProductoConStock | null;
  productosDisponibles: ProductoConStock[];
  productosLoading: boolean;
  idsYaUsados: Set<number>;
  disabled: boolean;
  onChange: (patch: Partial<ItemFormState>) => void;
  onToggleSuelta: (suelta: boolean) => void;
  onRemove: () => void;
}

function ItemCard({
  item,
  calc,
  producto,
  productosDisponibles,
  productosLoading,
  idsYaUsados,
  disabled,
  onChange,
  onToggleSuelta,
  onRemove,
}: ItemCardProps) {
  const opcionesProducto = useMemo(() => {
    const opciones = productosDisponibles.filter(
      (p) => p.id === item.producto_id || !idsYaUsados.has(p.id),
    );
    return opciones.sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
    );
  }, [productosDisponibles, idsYaUsados, item.producto_id]);

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={`prod-${item.uid}`} className="text-xs">
              Producto <span className="text-destructive">*</span>
            </Label>
            <select
              id={`prod-${item.uid}`}
              value={item.producto_id ?? ''}
              onChange={(e) =>
                onChange({
                  producto_id: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              disabled={disabled || productosLoading}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <option value="">Elegí un producto…</option>
              {opcionesProducto.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

          {producto && <ProductoInfoLine producto={producto} />}
        </div>

        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Quitar ítem"
          className={cn(
            'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={`suelta-${item.uid}`}
          type="checkbox"
          checked={item.suelta}
          onChange={(e) => onToggleSuelta(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-input"
        />
        <Label
          htmlFor={`suelta-${item.uid}`}
          className="cursor-pointer text-xs font-medium"
        >
          Compra suelta (por unidad)
        </Label>
        <span className="text-[11px] text-muted-foreground">
          {item.suelta
            ? 'cargás cantidad y precio NETO por unidad'
            : 'cargás bultos × und por bulto × precio NETO por bulto'}
        </span>
      </div>

      {item.suelta ? (
        <SueltaInputs item={item} disabled={disabled} onChange={onChange} />
      ) : (
        <BultosInputs item={item} disabled={disabled} onChange={onChange} />
      )}

      <CalcLine calc={calc} />
    </div>
  );
}

function ProductoInfoLine({ producto }: { producto: ProductoConStock }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span>
        Stock actual:{' '}
        <strong className="tabular-nums text-foreground">{producto.stock_actual}</strong>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Costo previo:{' '}
        {producto.costo === null ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CircleDashed className="h-3 w-3" aria-hidden="true" />
            no cargado
          </span>
        ) : (
          <strong className="tabular-nums text-foreground">
            {fmtMoney(producto.costo)}
          </strong>
        )}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Precio venta:{' '}
        <strong className="tabular-nums text-foreground">{fmtMoney(producto.precio)}</strong>
      </span>
    </div>
  );
}

function BultosInputs({
  item,
  disabled,
  onChange,
}: {
  item: ItemFormState;
  disabled: boolean;
  onChange: (patch: Partial<ItemFormState>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        <Label
          htmlFor={`bultos-${item.uid}`}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Bultos
        </Label>
        <Input
          id={`bultos-${item.uid}`}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={item.cantidad_bultos}
          onChange={(e) => onChange({ cantidad_bultos: e.target.value })}
          disabled={disabled}
          placeholder="0"
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor={`und-${item.uid}`}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Und por bulto
        </Label>
        <Input
          id={`und-${item.uid}`}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={item.unidades_por_bulto}
          onChange={(e) => onChange({ unidades_por_bulto: e.target.value })}
          disabled={disabled}
          placeholder="0"
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor={`costo-${item.uid}`}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          $ NETO por bulto
        </Label>
        <Input
          id={`costo-${item.uid}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={item.costo_por_bulto}
          onChange={(e) => onChange({ costo_por_bulto: e.target.value })}
          disabled={disabled}
          placeholder="0.00"
        />
      </div>
    </div>
  );
}

function SueltaInputs({
  item,
  disabled,
  onChange,
}: {
  item: ItemFormState;
  disabled: boolean;
  onChange: (patch: Partial<ItemFormState>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1">
        <Label
          htmlFor={`cant-${item.uid}`}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Cantidad
        </Label>
        <Input
          id={`cant-${item.uid}`}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={item.cantidad_bultos}
          onChange={(e) => onChange({ cantidad_bultos: e.target.value })}
          disabled={disabled}
          placeholder="0"
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor={`costou-${item.uid}`}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          $ NETO por unidad
        </Label>
        <Input
          id={`costou-${item.uid}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={item.costo_por_bulto}
          onChange={(e) => onChange({ costo_por_bulto: e.target.value })}
          disabled={disabled}
          placeholder="0.00"
        />
      </div>
    </div>
  );
}

function CalcLine({ calc }: { calc: ItemCalc }) {
  if (calc.incompleto) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Completá los campos para ver el cálculo en vivo.
      </div>
    );
  }
  return (
    <div className="space-y-0.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      <p className="text-muted-foreground">
        <strong className="tabular-nums text-foreground">{calc.cantidad}</strong>{' '}
        unidades ·{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(calc.costo_unitario ?? 0)}
        </strong>{' '}
        NETO / unidad
      </p>
      <p>
        <span className="text-muted-foreground">Subtotal NETO: </span>
        <strong className="tabular-nums text-foreground">
          {fmtMoney(calc.subtotal ?? 0)}
        </strong>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Condición de pago
// ─────────────────────────────────────────────────────────────────────

interface CondicionPagoSectionProps {
  state: FormState;
  disabled: boolean;
  onCondicionPagoChange: (c: CondicionPago) => void;
  onFechaCompromisoChange: (v: string) => void;
}

function CondicionPagoSection({
  state,
  disabled,
  onCondicionPagoChange,
  onFechaCompromisoChange,
}: CondicionPagoSectionProps) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <Label className="text-xs">Condición de pago</Label>
      <div className="flex flex-wrap gap-1.5">
        <PagoPill
          checked={state.condicion_pago === 'al_dia'}
          onClick={() => onCondicionPagoChange('al_dia')}
          disabled={disabled}
        >
          Al día
        </PagoPill>
        <PagoPill
          checked={state.condicion_pago === 'a_plazo'}
          onClick={() => onCondicionPagoChange('a_plazo')}
          disabled={disabled}
        >
          A plazo
        </PagoPill>
        <PagoPill
          checked={state.condicion_pago === 'al_recibir'}
          onClick={() => onCondicionPagoChange('al_recibir')}
          disabled={disabled}
        >
          Pendiente (defino al recibir)
        </PagoPill>
      </div>

      {state.condicion_pago === 'a_plazo' && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="oc-fecha-compromiso" className="text-xs">
            Fecha de compromiso de pago <span className="text-destructive">*</span>
          </Label>
          <Input
            id="oc-fecha-compromiso"
            type="date"
            value={state.fecha_compromiso_pago}
            onChange={(e) => onFechaCompromisoChange(e.target.value)}
            disabled={disabled}
            required
          />
        </div>
      )}
    </div>
  );
}

function PagoPill({
  checked,
  onClick,
  disabled,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Validación del submit
// ─────────────────────────────────────────────────────────────────────

interface SubmitValidationParams {
  state: FormState;
  itemCalcs: ItemCalc[];
  proveedoresActivos: number;
}

function computeSubmitDisabledReason(p: SubmitValidationParams): string | null {
  const { state, itemCalcs, proveedoresActivos } = p;

  if (proveedoresActivos === 0) {
    return 'Tu club no tiene proveedores activos. Creá uno en Configuración.';
  }
  if (state.proveedor_id === null) return 'Elegí un proveedor.';
  if (state.linea === null) return 'Elegí la línea (buffet o shop).';
  if (state.fecha_oc === '') return 'Ingresá la fecha de la OC.';

  const itemsConProducto = state.items.filter((i) => i.producto_id !== null);
  if (itemsConProducto.length === 0) {
    return 'Agregá al menos un producto.';
  }
  for (const [i, it] of state.items.entries()) {
    if (it.producto_id === null) {
      return `Elegí el producto del item ${i + 1}.`;
    }
    const calc = itemCalcs[i];
    if (!calc || calc.incompleto) {
      return `Completá los valores del item ${i + 1}.`;
    }
  }

  if (state.condicion_pago === 'a_plazo' && state.fecha_compromiso_pago === '') {
    return 'Indicá la fecha de compromiso de pago (condición "a plazo").';
  }

  return null;
}
