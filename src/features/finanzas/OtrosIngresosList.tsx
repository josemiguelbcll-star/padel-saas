import { Clock, TrendingUp } from 'lucide-react';
import type { OtroIngreso } from '@/types/database';
import { MEDIO_PAGO_LABEL, TIPO_UNIDAD_LABEL } from './finanzasSchemas';

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

export function OtrosIngresosList({ ingresos }: { ingresos: OtroIngreso[] }) {
  if (ingresos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <TrendingUp
          className="mx-auto h-8 w-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Todavía no hay otros ingresos registrados.
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
            <th className="px-3 py-2 font-medium">Concepto / Unidad</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 text-right font-medium">Monto</th>
          </tr>
        </thead>
        <tbody>
          {ingresos.map((i) => {
            const esCobrado = i.fecha_cobro !== null;
            return (
              <tr
                key={i.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/20"
              >
                <td className="px-3 py-2 align-top text-muted-foreground tabular-nums">
                  {fmt(i.fecha)}
                </td>
                <td className="px-3 py-2 align-top">
                  <p className="text-foreground">{i.concepto}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {i.unidad_nombre} · {TIPO_UNIDAD_LABEL[i.unidad_tipo]}
                  </p>
                </td>
                <td className="px-3 py-2 align-top">
                  {esCobrado ? (
                    <div className="space-y-0.5">
                      <span
                        className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: 'hsl(var(--estado-pagada) / 0.12)',
                          color: 'hsl(var(--estado-pagada))',
                        }}
                      >
                        Cobrado
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        {i.medio_pago ? MEDIO_PAGO_LABEL[i.medio_pago] : ''}
                        {i.fecha_cobro && ` · ${fmt(i.fecha_cobro)}`}
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
                <td
                  className="px-3 py-2 align-top text-right font-medium tabular-nums"
                  style={{ color: 'hsl(var(--estado-pagada))' }}
                >
                  {currencyFmt.format(Number(i.monto))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
