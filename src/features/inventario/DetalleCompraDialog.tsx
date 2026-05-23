import { Receipt } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { MEDIO_PAGO_LABEL } from '@/features/finanzas/finanzasSchemas';
import type {
  CompraItem,
  CondicionFiscalClub,
  CondicionPago,
  EstadoCompra,
} from '@/types/database';
import { useCompra } from './hooks/useCompra';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

function fmtDateISO(iso: string): string {
  return dateFmt.format(new Date(iso + 'T00:00:00'));
}

const CONDICION_PAGO_LABEL: Record<CondicionPago, string> = {
  al_dia: 'Al día',
  a_plazo: 'A plazo',
  al_recibir: 'Pendiente (definir al recibir)',
};

const FISCAL_LABEL: Record<CondicionFiscalClub, string> = {
  monotributista: 'Monotributista',
  responsable_inscripto: 'Responsable Inscripto',
};

interface DetalleCompraDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compraId: number | null;
}

export function DetalleCompraDialog({
  open,
  onOpenChange,
  compraId,
}: DetalleCompraDialogProps) {
  const query = useCompra(open ? compraId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" aria-hidden="true" />
            Compra {compraId !== null ? `#${compraId}` : ''}
            {query.data && (
              <EstadoChipInline estado={query.data.compra.estado} />
            )}
          </DialogTitle>
          <DialogDescription>
            Detalle completo: pedido, recepción (si llegó), comprobante,
            condición fiscal aplicada y datos del gasto vinculado.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading && (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-md border border-border bg-muted/30"
              />
            ))}
          </div>
        )}

        {query.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {query.error.message}
          </div>
        )}

        {query.data && <DetalleContenido data={query.data} />}
      </DialogContent>
    </Dialog>
  );
}

function DetalleContenido({
  data,
}: {
  data: NonNullable<ReturnType<typeof useCompra>['data']>;
}) {
  const { compra, items, proveedor_nombre, proveedor_cuit, gasto } = data;

  return (
    <div className="space-y-4">
      {/* ── Pedido ─────────────────────────────────────────────── */}
      <Section title="Pedido">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Proveedor"
            value={
              <>
                <p className="font-medium text-foreground">
                  {proveedor_nombre ?? '(eliminado)'}
                </p>
                {proveedor_cuit && (
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    CUIT {proveedor_cuit}
                  </p>
                )}
              </>
            }
          />
          <Field
            label="Línea"
            value={
              <span className="inline-flex rounded bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {compra.linea}
              </span>
            }
          />
          <Field label="Fecha de la OC" value={fmtDateISO(compra.fecha_oc)} />
          <Field
            label="Condición de pago"
            value={
              <>
                {CONDICION_PAGO_LABEL[compra.condicion_pago]}
                {compra.condicion_pago === 'a_plazo' && compra.fecha_compromiso_pago && (
                  <p className="text-[11px] text-muted-foreground">
                    Compromiso: {fmtDateISO(compra.fecha_compromiso_pago)}
                  </p>
                )}
              </>
            }
          />
          <Field
            label="NETO comprometido al pedir"
            value={
              <span className="tabular-nums text-foreground">
                {fmtMoney(Number(compra.monto_neto_oc))}
              </span>
            }
          />
        </div>
        <ItemsTable items={items} estado={compra.estado} />
      </Section>

      {/* ── Recepción (solo si recibida) ────────────────────────── */}
      {compra.estado === 'recibida' && (
        <Section title="Recepción">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Fecha de recepción"
              value={
                compra.fecha_recepcion
                  ? fmtDateISO(compra.fecha_recepcion)
                  : '—'
              }
            />
            <Field
              label="Condición fiscal al recibir"
              value={
                compra.condicion_fiscal_club
                  ? FISCAL_LABEL[compra.condicion_fiscal_club]
                  : <span className="italic text-muted-foreground">
                      (no registrada — compra histórica pre-0041)
                    </span>
              }
            />
            <Field
              label="Comprobante"
              value={
                compra.comprobante_tipo || compra.comprobante_numero
                  ? `${compra.comprobante_tipo ?? ''} ${compra.comprobante_numero ?? ''}`.trim()
                  : <span className="italic text-muted-foreground">Sin comprobante</span>
              }
            />
            <Field
              label="Totales"
              value={
                <p className="text-sm">
                  NETO{' '}
                  <strong className="tabular-nums text-foreground">
                    {fmtMoney(Number(compra.monto_neto ?? 0))}
                  </strong>{' '}
                  + IVA{' '}
                  <strong className="tabular-nums text-foreground">
                    {fmtMoney(Number(compra.monto_iva ?? 0))}
                  </strong>{' '}
                  ={' '}
                  <strong className="tabular-nums text-foreground">
                    {fmtMoney(Number(compra.monto_total ?? 0))}
                  </strong>
                </p>
              }
            />
          </div>
        </Section>
      )}

      {/* ── Gasto vinculado (solo si recibida) ──────────────────── */}
      {compra.estado === 'recibida' && gasto && (
        <Section title="Gasto vinculado">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Estado"
              value={
                gasto.fecha_pago !== null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Pagada
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Pendiente
                  </span>
                )
              }
            />
            <Field
              label="Fecha de pago"
              value={gasto.fecha_pago ? fmtDateISO(gasto.fecha_pago) : '—'}
            />
            <Field
              label="Medio"
              value={gasto.medio_pago ? MEDIO_PAGO_LABEL[gasto.medio_pago] : '—'}
            />
            <Field label="Gasto" value={`#${gasto.id}`} />
          </div>
        </Section>
      )}

      {/* ── Observaciones (siempre, si hay) ─────────────────────── */}
      {compra.observaciones && (
        <Section title={compra.estado === 'cancelada' ? 'Motivo / observaciones' : 'Observaciones'}>
          <p className="whitespace-pre-line text-sm text-foreground">
            {compra.observaciones}
          </p>
        </Section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Items table — render condicional según estado
// ─────────────────────────────────────────────────────────────────────

function ItemsTable({
  items,
  estado,
}: {
  items: CompraItem[];
  estado: EstadoCompra;
}) {
  const showIva = estado === 'recibida';

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <p className="border-b border-border bg-muted/30 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        Ítems · {items.length}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Producto</th>
              <th className="px-3 py-2 text-right font-semibold">Bultos</th>
              <th className="px-3 py-2 text-right font-semibold">Und / bulto</th>
              <th className="px-3 py-2 text-right font-semibold">$ NETO / bulto</th>
              <th className="px-3 py-2 text-right font-semibold">Total und</th>
              <th className="px-3 py-2 text-right font-semibold">$ NETO / und</th>
              <th className="px-3 py-2 text-right font-semibold">Subtotal NETO</th>
              {showIva && (
                <>
                  <th className="px-3 py-2 text-right font-semibold">IVA %</th>
                  <th className="px-3 py-2 text-right font-semibold">Subtotal IVA</th>
                  <th className="px-3 py-2 text-right font-semibold">Subtotal TOTAL</th>
                  <th className="px-3 py-2 text-right font-semibold">PPP aplicado</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className="border-b border-border/50 last:border-b-0"
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {it.producto_nombre}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {it.cantidad_bultos}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {it.unidades_por_bulto}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {fmtMoney(Number(it.costo_por_bulto))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                  {it.cantidad}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {fmtMoney(Number(it.costo_unitario_compra))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                  {fmtMoney(Number(it.subtotal))}
                </td>
                {showIva && (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {it.tasa_iva !== null ? `${Number(it.tasa_iva).toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {it.subtotal_iva !== null ? fmtMoney(Number(it.subtotal_iva)) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                      {it.subtotal_total !== null
                        ? fmtMoney(Number(it.subtotal_total))
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {it.costo_unitario_ppp !== null
                        ? fmtMoney(Number(it.costo_unitario_ppp))
                        : '—'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-md border border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className={cn('mt-0.5 text-sm')}>{value}</div>
    </div>
  );
}

function EstadoChipInline({ estado }: { estado: EstadoCompra }) {
  if (estado === 'pedida') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        Pedida
      </span>
    );
  }
  if (estado === 'recibida') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
        Recibida
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      Cancelada
    </span>
  );
}
