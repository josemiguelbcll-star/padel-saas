import { Clock, Receipt } from 'lucide-react';
import type { Gasto } from '@/types/database';
import { MEDIO_PAGO_LABEL } from './finanzasSchemas';

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
 * Tabla simple de gastos. Sin acciones por fila (anular/editar van en
 * iteración 2). Snapshots de categoría + unidad ya vienen en la fila.
 *
 * Estado: pendiente (sin fecha_pago) → chip "Pendiente" ámbar.
 *         Pagado → chip "Pagado" verde + medio de pago en línea.
 */
export function GastosList({ gastos }: { gastos: Gasto[] }) {
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
          </tr>
        </thead>
        <tbody>
          {gastos.map((g) => {
            const esPagado = g.fecha_pago !== null;
            return (
              <tr
                key={g.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/20"
              >
                <td className="px-3 py-2 align-top text-muted-foreground tabular-nums">
                  {fmt(g.fecha_gasto)}
                </td>
                <td className="px-3 py-2 align-top">
                  <p className="text-foreground">{g.categoria_nombre}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {g.unidad_nombre}
                  </p>
                </td>
                <td className="px-3 py-2 align-top text-muted-foreground">
                  {g.proveedor ?? '—'}
                </td>
                <td className="px-3 py-2 align-top">
                  {esPagado ? (
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
                      <p className="text-[11px] text-muted-foreground">
                        {g.medio_pago ? MEDIO_PAGO_LABEL[g.medio_pago] : ''}
                        {g.fecha_pago && ` · ${fmt(g.fecha_pago)}`}
                      </p>
                    </div>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
