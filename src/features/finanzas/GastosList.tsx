import { Ban, Clock, Receipt, Repeat } from 'lucide-react';
import type { Gasto, MedioPago } from '@/types/database';
import { MEDIO_PAGO_LABEL } from './finanzasSchemas';
import type { GastoFila } from './hooks/useGastos';

function medioPagoLabel(medio: MedioPago | 'varios' | null): string {
  if (medio === null) return '';
  return medio === 'varios' ? 'Varios' : MEDIO_PAGO_LABEL[medio];
}

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

function fmt(iso: string): string {
  return fechaFmt.format(new Date(iso + 'T00:00:00'));
}

/**
 * Tabla simple de gastos. Snapshots de categoría + unidad ya vienen en
 * la fila. Solo muestra gastos activos (useGastos filtra activo=TRUE);
 * los anulados quedan fuera (su rastro vive en `anulaciones`).
 *
 * Estado de pago DERIVADO de las cuotas (g.pago, vía estadoPagoGasto): un gasto
 * a plazo / con cuota nace con fecha_pago NULL pero puede estar pagado por sus
 * cuotas. Pagada (verde + medio) / Parcial (ámbar, "1/3") / Pendiente (ámbar).
 *
 * Si se pasa `onAnular`, cada fila muestra la acción "Anular" (0048).
 * La RPC rechaza si el gasto tiene cuotas pagadas o viene de una OC;
 * el dialog del padre muestra ese error.
 */
export function GastosList({
  gastos,
  onAnular,
}: {
  gastos: GastoFila[];
  onAnular?: (g: Gasto) => void;
}) {
  if (gastos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <Receipt
          className="mx-auto h-8 w-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Todavía no hay gastos registrados.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Categoría / Unidad</th>
            <th className="px-3 py-2 font-medium">Proveedor</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 text-right font-medium">Monto</th>
            {onAnular && (
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
            )}
          </tr>
        </thead>
        <tbody>
          {gastos.map((g) => {
            const pago = g.pago;
            return (
              <tr
                key={g.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/20"
              >
                <td className="px-3 py-2 align-top text-muted-foreground tabular-nums">
                  {fmt(g.fecha_gasto)}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-1.5">
                    <p className="text-foreground">{g.categoria_nombre}</p>
                    {g.gasto_recurrente_id !== null && (
                      <span
                        title="Cargado desde una plantilla recurrente"
                        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-muted-foreground ring-1 ring-border"
                      >
                        <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                        Recurrente
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {g.unidad_nombre}
                  </p>
                </td>
                <td className="px-3 py-2 align-top text-muted-foreground">
                  {g.proveedor ?? '—'}
                </td>
                <td className="px-3 py-2 align-top">
                  {pago.estado === 'pagada' ? (
                    <div className="space-y-0.5">
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: 'hsl(var(--estado-pagada) / 0.12)',
                          color: 'hsl(var(--estado-pagada))',
                        }}
                      >
                        Pagado
                      </span>
                      {medioPagoLabel(pago.medio) && (
                        <p className="text-[11px] text-muted-foreground">
                          {medioPagoLabel(pago.medio)}
                        </p>
                      )}
                    </div>
                  ) : pago.estado === 'parcial' ? (
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: 'hsl(var(--estado-senada) / 0.12)',
                        color: 'hsl(var(--estado-senada))',
                      }}
                    >
                      <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                      Parcial · {pago.pagadas}/{pago.total}
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: 'hsl(var(--estado-senada) / 0.12)',
                        color: 'hsl(var(--estado-senada))',
                      }}
                    >
                      <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                      Pendiente
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-right font-medium tabular-nums text-foreground">
                  {currencyFmt.format(Number(g.monto))}
                </td>
                {onAnular && (
                  <td className="px-3 py-2 align-top text-right">
                    <button
                      type="button"
                      onClick={() => onAnular(g)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Ban className="h-3 w-3" aria-hidden="true" />
                      Anular
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
