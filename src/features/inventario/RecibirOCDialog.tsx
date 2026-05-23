import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CircleDashed,
  Plus,
  Receipt,
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
import { useSession } from '@/features/auth';
import { useCajaAbierta } from '@/features/caja/hooks/useCajaAbierta';
import {
  MEDIO_PAGO_LABEL,
  MEDIOS_PAGO,
} from '@/features/finanzas/finanzasSchemas';
import type {
  CondicionFiscalClub,
  MedioPago,
  ProductoConStock,
} from '@/types/database';
import { useCompra } from './hooks/useCompra';
import { useInventarioProductos } from './hooks/useInventarioProductos';
import {
  useRecibirOC,
  type RecibirOCItemInput,
} from './hooks/useRecibirOC';

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

/**
 * Cálculo del PPP por unidad según condición fiscal del club. DEBE
 * coincidir EXACTAMENTE con la lógica de fn_recibir_oc (0041):
 *
 *   responsable_inscripto → ROUND(costo_por_bulto / unidades_por_bulto, 2)
 *   monotributista         → ROUND(costo_por_bulto * (1 + tasa_iva/100)
 *                                  / unidades_por_bulto, 2)
 *
 * Se usa para mostrar al admin EN VIVO qué costo va a entrar al PPP
 * del producto, antes de confirmar la recepción.
 */
function computeCostoPpp(
  costoPorBulto: number,
  unidadesPorBulto: number,
  tasaIva: number,
  condicionFiscal: CondicionFiscalClub,
): number {
  if (condicionFiscal === 'responsable_inscripto') {
    return Math.round((costoPorBulto / unidadesPorBulto) * 100) / 100;
  }
  return Math.round(
    ((costoPorBulto * (1 + tasaIva / 100)) / unidadesPorBulto) * 100,
  ) / 100;
}

// ─────────────────────────────────────────────────────────────────────
// Estado del formulario
// ─────────────────────────────────────────────────────────────────────

interface ItemFormState {
  uid: string;
  producto_id: number | null;
  suelta: boolean;
  cantidad_bultos: string;
  unidades_por_bulto: string;
  costo_por_bulto: string;
  /** Porcentaje 0-100 como string del input. */
  tasa_iva: string;
}

interface FormState {
  fecha_recepcion: string;
  items: ItemFormState[];
  comprobante_tipo: string;
  comprobante_numero: string;
  pagado: boolean;
  fecha_pago: string;
  medio_pago: MedioPago | '';
}

function makeEmptyItem(): ItemFormState {
  return {
    uid: makeUid(),
    producto_id: null,
    suelta: false,
    cantidad_bultos: '',
    unidades_por_bulto: '',
    costo_por_bulto: '',
    tasa_iva: '',
  };
}

function initialState(): FormState {
  return {
    fecha_recepcion: todayISO(),
    items: [],
    comprobante_tipo: '',
    comprobante_numero: '',
    pagado: false,
    fecha_pago: todayISO(),
    medio_pago: '',
  };
}

interface ItemCalc {
  cantidad: number | null;
  costo_unitario_neto: number | null;
  subtotal_neto: number | null;
  subtotal_iva: number | null;
  subtotal_total: number | null;
  costo_unit_ppp: number | null;
  incompleto: boolean;
}

const EMPTY_CALC: ItemCalc = {
  cantidad: null,
  costo_unitario_neto: null,
  subtotal_neto: null,
  subtotal_iva: null,
  subtotal_total: null,
  costo_unit_ppp: null,
  incompleto: true,
};

function computeItemCalc(
  it: ItemFormState,
  condicionFiscal: CondicionFiscalClub,
): ItemCalc {
  const bultos = it.cantidad_bultos.trim() === '' ? NaN : Number(it.cantidad_bultos);
  const und = it.suelta ? 1 : it.unidades_por_bulto.trim() === '' ? NaN : Number(it.unidades_por_bulto);
  const costo = it.costo_por_bulto.trim() === '' ? NaN : Number(it.costo_por_bulto);
  const tasa = it.tasa_iva.trim() === '' ? NaN : Number(it.tasa_iva);

  const valid =
    Number.isFinite(bultos) && bultos > 0 &&
    Number.isFinite(und) && und > 0 &&
    Number.isFinite(costo) && costo >= 0 &&
    Number.isFinite(tasa) && tasa >= 0 && tasa <= 100;

  if (!valid) return EMPTY_CALC;

  const cantidad = Math.trunc(bultos * und);
  const costo_unitario_neto = Math.round((costo / und) * 100) / 100;
  const subtotal_neto = Math.round(bultos * costo * 100) / 100;
  const subtotal_iva = Math.round((subtotal_neto * tasa) / 100 * 100) / 100;
  const subtotal_total = Math.round((subtotal_neto + subtotal_iva) * 100) / 100;
  const costo_unit_ppp = computeCostoPpp(costo, und, tasa, condicionFiscal);

  return {
    cantidad,
    costo_unitario_neto,
    subtotal_neto,
    subtotal_iva,
    subtotal_total,
    costo_unit_ppp,
    incompleto: false,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────

interface RecibirOCDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compraId: number | null;
}

export function RecibirOCDialog({
  open,
  onOpenChange,
  compraId,
}: RecibirOCDialogProps) {
  const { club } = useSession();
  const detalleQuery = useCompra(open ? compraId : null);
  const productosQuery = useInventarioProductos();
  const cajaQuery = useCajaAbierta();
  const recibir = useRecibirOC();

  const condicionFiscal: CondicionFiscalClub =
    club?.condicion_fiscal ?? 'monotributista';

  const [state, setState] = useState<FormState>(initialState);
  const [error, setError] = useState<string | null>(null);

  const pending = recibir.isPending;

  // Resetear al abrir.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setState(initialState());
  }, [open, compraId]);

  // Pre-llenar items con los de la OC cuando llega el detalle.
  useEffect(() => {
    if (!open) return;
    if (!detalleQuery.data) return;
    const items: ItemFormState[] = detalleQuery.data.items.map((it) => ({
      uid: makeUid(),
      producto_id: it.producto_id,
      suelta: it.unidades_por_bulto === 1,
      cantidad_bultos: String(it.cantidad_bultos),
      unidades_por_bulto: it.unidades_por_bulto === 1 ? '' : String(it.unidades_por_bulto),
      costo_por_bulto: String(it.costo_por_bulto),
      tasa_iva: '',                       // Vacío hasta que cargue la factura
    }));
    setState((s) => ({ ...s, items: items.length === 0 ? [makeEmptyItem()] : items }));
  }, [open, detalleQuery.data]);

  const compra = detalleQuery.data?.compra ?? null;
  const proveedorNombre = detalleQuery.data?.proveedor_nombre ?? null;

  const productosDisponibles = useMemo(() => {
    if (!compra) return [];
    return (productosQuery.data ?? []).filter(
      (p) => p.activo && p.linea === compra.linea,
    );
  }, [productosQuery.data, compra]);

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
    () => state.items.map((it) => computeItemCalc(it, condicionFiscal)),
    [state.items, condicionFiscal],
  );

  const totales = useMemo(() => {
    let neto = 0, iva = 0, total = 0;
    for (const c of itemCalcs) {
      neto += c.subtotal_neto ?? 0;
      iva += c.subtotal_iva ?? 0;
      total += c.subtotal_total ?? 0;
    }
    return {
      neto: Math.round(neto * 100) / 100,
      iva: Math.round(iva * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  }, [itemCalcs]);

  const cajaAbierta = cajaQuery.data ?? null;
  const efectivoSinCaja =
    state.pagado &&
    state.medio_pago === 'efectivo' &&
    cajaAbierta === null;

  const submitDisabledReason = computeSubmitDisabledReason({
    state,
    itemCalcs,
  });
  const submitDisabled = submitDisabledReason !== null;

  // ── Helpers ────────────────────────────────────────────────────────

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function updateItem(uid: string, patch: Partial<ItemFormState>) {
    setState((s) => ({
      ...s,
      items: s.items.map((it) => (it.uid === uid ? { ...it, ...patch } : it)),
    }));
  }

  function toggleSuelta(uid: string, nextSuelta: boolean) {
    // Limpia costo + und/bulto (cambia el significado).
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
      return { ...s, items: nextItems };
    });
  }

  // ── Submit ─────────────────────────────────────────────────────────

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (submitDisabled) {
      setError(submitDisabledReason ?? 'Faltan datos en el formulario.');
      return;
    }
    if (!compraId) return;

    const items: RecibirOCItemInput[] = state.items
      .filter((it) => it.producto_id !== null)
      .map((it) => {
        const bultos = Number(it.cantidad_bultos);
        const und = it.suelta ? 1 : Number(it.unidades_por_bulto);
        const costo = Number(it.costo_por_bulto);
        const tasa = Number(it.tasa_iva);
        return {
          producto_id: it.producto_id as number,
          cantidad_bultos: Math.trunc(bultos),
          unidades_por_bulto: Math.trunc(und),
          costo_por_bulto: costo,
          tasa_iva: tasa,
        };
      });

    try {
      await recibir.mutateAsync({
        compra_id: compraId,
        fecha_recepcion: state.fecha_recepcion,
        items,
        comprobante_tipo: state.comprobante_tipo.trim() === ''
          ? null
          : state.comprobante_tipo.trim(),
        comprobante_numero: state.comprobante_numero.trim() === ''
          ? null
          : state.comprobante_numero.trim(),
        fecha_pago: state.pagado ? state.fecha_pago : null,
        medio_pago: state.pagado ? (state.medio_pago as MedioPago) : null,
        turnoCajaIdParaInvalidate: cajaAbierta?.id ?? null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos recibir la OC. Probá de nuevo.',
      );
    }
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    onOpenChange(next);
  }

  const loadingDetalle = detalleQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" aria-hidden="true" />
            Recibir OC {compraId !== null ? `#${compraId}` : ''}
            {proveedorNombre && ` · ${proveedorNombre}`}
          </DialogTitle>
          <DialogDescription>
            Ajustá los ítems contra la factura real (cantidades, costos,
            agregar o quitar productos). Cargá la tasa de IVA por ítem y
            los datos del comprobante. La condición fiscal del club
            determina cómo se promedia el costo.
          </DialogDescription>
        </DialogHeader>

        {loadingDetalle && (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md border border-border bg-muted/30"
              />
            ))}
          </div>
        )}

        {detalleQuery.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {detalleQuery.error.message}
          </div>
        )}

        {compra && (
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <OCSummary
              compra={compra}
              proveedorNombre={proveedorNombre}
              condicionFiscal={condicionFiscal}
            />

            <div className="space-y-1.5">
              <Label htmlFor="rec-fecha" className="text-xs">
                Fecha de recepción <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rec-fecha"
                type="date"
                value={state.fecha_recepcion}
                onChange={(e) => setField('fecha_recepcion', e.target.value)}
                disabled={pending}
                required
                className="max-w-xs"
              />
            </div>

            <ItemsSection
              items={state.items}
              calcs={itemCalcs}
              productosDisponibles={productosDisponibles}
              productosById={productosById}
              productosLoading={productosQuery.isLoading}
              idsYaUsados={idsYaUsados}
              condicionFiscal={condicionFiscal}
              disabled={pending}
              onUpdateItem={updateItem}
              onToggleSuelta={toggleSuelta}
              onAddItem={addItem}
              onRemoveItem={removeItem}
            />

            <ComprobanteSection
              state={state}
              disabled={pending}
              onTipoChange={(v) => setField('comprobante_tipo', v)}
              onNumeroChange={(v) => setField('comprobante_numero', v)}
            />

            <PagoSection
              state={state}
              efectivoSinCaja={efectivoSinCaja}
              disabled={pending}
              onTogglePagado={(v) => setField('pagado', v)}
              onFechaChange={(v) => setField('fecha_pago', v)}
              onMedioChange={(v) => setField('medio_pago', v)}
            />

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <TotalesBox totales={totales} />
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
                  {pending ? 'Registrando…' : 'Recibir y registrar'}
                </Button>
              </DialogFooter>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Resumen de la OC original
// ─────────────────────────────────────────────────────────────────────

function OCSummary({
  compra,
  proveedorNombre,
  condicionFiscal,
}: {
  compra: { linea: string; monto_neto_oc: number; condicion_pago: string };
  proveedorNombre: string | null;
  condicionFiscal: CondicionFiscalClub;
}) {
  const fiscalLabel =
    condicionFiscal === 'monotributista'
      ? 'Monotributista (PPP = NETO + IVA)'
      : 'Responsable Inscripto (PPP = NETO)';
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <p>
        OC original:{' '}
        <strong className="text-foreground capitalize">{compra.linea}</strong> ·
        proveedor{' '}
        <strong className="text-foreground">
          {proveedorNombre ?? '(eliminado)'}
        </strong>{' '}
        · NETO comprometido{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(Number(compra.monto_neto_oc))}
        </strong>
      </p>
      <p className="mt-0.5">
        Tu club: <strong className="text-foreground">{fiscalLabel}</strong>
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sección de ítems (con cálculo PPP en vivo por ítem)
// ─────────────────────────────────────────────────────────────────────

interface ItemsSectionProps {
  items: ItemFormState[];
  calcs: ItemCalc[];
  productosDisponibles: ProductoConStock[];
  productosById: Map<number, ProductoConStock>;
  productosLoading: boolean;
  idsYaUsados: Set<number>;
  condicionFiscal: CondicionFiscalClub;
  disabled: boolean;
  onUpdateItem: (uid: string, patch: Partial<ItemFormState>) => void;
  onToggleSuelta: (uid: string, suelta: boolean) => void;
  onAddItem: () => void;
  onRemoveItem: (uid: string) => void;
}

function ItemsSection({
  items,
  calcs,
  productosDisponibles,
  productosById,
  productosLoading,
  idsYaUsados,
  condicionFiscal,
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
          Ajustá los ítems contra la factura real <span className="text-destructive">*</span>
        </Label>
        <p className="text-[11px] text-muted-foreground">
          {items.length} ítem{items.length === 1 ? '' : 's'}
        </p>
      </div>

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
            condicionFiscal={condicionFiscal}
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
          Agregar producto (no estaba en la OC)
        </Button>
      </div>
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
  condicionFiscal: CondicionFiscalClub;
  disabled: boolean;
  onChange: (patch: Partial<ItemFormState>) => void;
  onToggleSuelta: (suelta: boolean) => void;
  onRemove: () => void;
}

const TASAS_RAPIDAS = [21, 10.5, 27, 0];

function ItemCard({
  item,
  calc,
  producto,
  productosDisponibles,
  productosLoading,
  idsYaUsados,
  condicionFiscal,
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
      </div>

      {item.suelta ? (
        <SueltaInputs item={item} disabled={disabled} onChange={onChange} />
      ) : (
        <BultosInputs item={item} disabled={disabled} onChange={onChange} />
      )}

      {/* Tasa de IVA */}
      <div className="space-y-1.5">
        <Label
          htmlFor={`iva-${item.uid}`}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Tasa de IVA (%) <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            id={`iva-${item.uid}`}
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.01"
            value={item.tasa_iva}
            onChange={(e) => onChange({ tasa_iva: e.target.value })}
            disabled={disabled}
            placeholder="0"
            className="max-w-[100px]"
          />
          <span className="text-[11px] text-muted-foreground">o elegí:</span>
          {TASAS_RAPIDAS.map((t) => {
            const checked = Number(item.tasa_iva) === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ tasa_iva: String(t) })}
                disabled={disabled}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  checked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                {t}%
              </button>
            );
          })}
        </div>
      </div>

      <CalcLine calc={calc} condicionFiscal={condicionFiscal} />
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
        Costo PPP previo:{' '}
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

function CalcLine({
  calc,
  condicionFiscal,
}: {
  calc: ItemCalc;
  condicionFiscal: CondicionFiscalClub;
}) {
  if (calc.incompleto) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Completá bultos / und / costo / tasa IVA para ver el cálculo en vivo.
      </div>
    );
  }
  const fiscalNote =
    condicionFiscal === 'responsable_inscripto'
      ? 'NETO, responsable inscripto'
      : 'NETO×(1+IVA), monotributista';
  return (
    <div className="space-y-0.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      <p className="text-muted-foreground">
        ={' '}
        <strong className="tabular-nums text-foreground">{calc.cantidad}</strong>{' '}
        und · NETO{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(calc.subtotal_neto ?? 0)}
        </strong>{' '}
        · IVA{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(calc.subtotal_iva ?? 0)}
        </strong>{' '}
        · TOTAL{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(calc.subtotal_total ?? 0)}
        </strong>
      </p>
      <p className="text-[11px] text-muted-foreground">
        Costo PPP a aplicar:{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(calc.costo_unit_ppp ?? 0)}
        </strong>{' '}
        / unidad ({fiscalNote})
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Comprobante
// ─────────────────────────────────────────────────────────────────────

function ComprobanteSection({
  state,
  disabled,
  onTipoChange,
  onNumeroChange,
}: {
  state: FormState;
  disabled: boolean;
  onTipoChange: (v: string) => void;
  onNumeroChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      <Label className="text-xs">Comprobante (opcional)</Label>
      <p className="text-[11px] text-muted-foreground">
        Los datos quedan en la observación del gasto.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label
            htmlFor="rec-comp-tipo"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Tipo
          </Label>
          <Input
            id="rec-comp-tipo"
            type="text"
            value={state.comprobante_tipo}
            onChange={(e) => onTipoChange(e.target.value)}
            disabled={disabled}
            maxLength={20}
            placeholder="A / B / C / Remito / Otro"
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor="rec-comp-num"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Número
          </Label>
          <Input
            id="rec-comp-num"
            type="text"
            value={state.comprobante_numero}
            onChange={(e) => onNumeroChange(e.target.value)}
            disabled={disabled}
            maxLength={40}
            placeholder="0001-00012345"
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Pago
// ─────────────────────────────────────────────────────────────────────

function PagoSection({
  state,
  efectivoSinCaja,
  disabled,
  onTogglePagado,
  onFechaChange,
  onMedioChange,
}: {
  state: FormState;
  efectivoSinCaja: boolean;
  disabled: boolean;
  onTogglePagado: (v: boolean) => void;
  onFechaChange: (v: string) => void;
  onMedioChange: (v: MedioPago | '') => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-xs">Pago:</Label>
        <div className="flex gap-1.5">
          <PagoPill
            checked={!state.pagado}
            onClick={() => onTogglePagado(false)}
            disabled={disabled}
          >
            Pendiente
          </PagoPill>
          <PagoPill
            checked={state.pagado}
            onClick={() => onTogglePagado(true)}
            disabled={disabled}
          >
            Pagada al recibir
          </PagoPill>
        </div>
      </div>

      {state.pagado && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rec-fecha-pago" className="text-xs">
              Fecha de pago <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rec-fecha-pago"
              type="date"
              value={state.fecha_pago}
              onChange={(e) => onFechaChange(e.target.value)}
              disabled={disabled}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-medio" className="text-xs">
              Medio <span className="text-destructive">*</span>
            </Label>
            <select
              id="rec-medio"
              value={state.medio_pago}
              onChange={(e) => onMedioChange(e.target.value as MedioPago | '')}
              disabled={disabled}
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
      )}

      {efectivoSinCaja && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>
            No hay caja abierta del día. Si registrás la recepción en
            efectivo sin caja abierta, el servidor la va a rechazar.
            Abrí la caja desde el módulo Caja antes de continuar, o
            elegí otro medio de pago.
          </p>
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
// Totales finales
// ─────────────────────────────────────────────────────────────────────

function TotalesBox({
  totales,
}: {
  totales: { neto: number; iva: number; total: number };
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Total de la recepción
      </p>
      <p className="text-xs text-muted-foreground">
        NETO{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(totales.neto)}
        </strong>{' '}
        + IVA{' '}
        <strong className="tabular-nums text-foreground">
          {fmtMoney(totales.iva)}
        </strong>{' '}
        ={' '}
      </p>
      <p className="text-2xl font-bold tabular-nums text-foreground">
        {fmtMoney(totales.total)}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────────────

function computeSubmitDisabledReason(p: {
  state: FormState;
  itemCalcs: ItemCalc[];
}): string | null {
  const { state, itemCalcs } = p;

  if (state.fecha_recepcion === '') return 'Ingresá la fecha de recepción.';

  const itemsConProducto = state.items.filter((i) => i.producto_id !== null);
  if (itemsConProducto.length === 0) {
    return 'La recepción tiene que tener al menos un ítem. Si la OC no se concretó, cancelala.';
  }

  for (const [i, it] of state.items.entries()) {
    if (it.producto_id === null) {
      return `Elegí el producto del item ${i + 1}.`;
    }
    const calc = itemCalcs[i];
    if (!calc || calc.incompleto) {
      return `Completá bultos / und / costo / IVA del item ${i + 1}.`;
    }
  }

  if (state.pagado) {
    if (state.fecha_pago === '') return 'Ingresá la fecha de pago.';
    if (state.medio_pago === '') return 'Elegí el medio de pago.';
  }

  return null;
}
