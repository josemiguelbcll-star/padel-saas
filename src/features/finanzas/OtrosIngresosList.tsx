import { useMemo } from 'react';
import { Ban, Clock, Pencil, Repeat, TrendingUp } from 'lucide-react';
import type { OtroIngreso } from '@/types/database';
import { MEDIO_PAGO_LABEL } from './finanzasSchemas';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';

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

export function OtrosIngresosList({
  ingresos,
  onEditar,
  onAnular,
}: {
  ingresos: OtroIngreso[];
  onEditar?: (i: OtroIngreso) => void;
  onAnular?: (i: OtroIngreso) => void;
}) {
  const cuentasQuery = useCuentas();
  const cuentasById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cuentasQuery.data ?? []) m.set(c.id, c.nombre);
    return m;
  }, [cuentasQuery.data]);

  if (ingresos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <TrendingUp
          className="mx-auto h-8 w-8 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Todavía no hay ingresos registrados.
        </p>
      </div>
    );
  }

  const hasActions = Boolean(onEditar || onAnular);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Concepto / Unidad</th>
            <th className="px-3 py-2 font-medium">Estado / Cuenta</th>
            <th className="px-3 py-2 text-right font-medium">Monto</th>
            {hasActions && (
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
            )}
          </tr>
        </thead>
        <tbody>
          {ingresos.map((i) => {
            const esCobrado = i.fecha_cobro !== null;
            const cuentaNombre = i.cuenta_id ? cuentasById.get(i.cuenta_id) : null;
            return (
              <tr
                key={i.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/20"
              >
                <td className="px-3 py-2 align-top text-muted-foreground tabular-nums">
                  {fmt(i.fecha)}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-1.5">
                    <p className="text-foreground">{i.concepto}</p>
                    {i.ingreso_recurrente_id !== null && (
                      <span
                        title="Cargado desde una plantilla recurrente"
                        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium text-muted-foreground ring-1 ring-border"
                      >
                        <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                        Recurrente
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{i.unidad_nombre}</p>
                  {i.observaciones && (
                    <p className="text-[11px] italic text-muted-foreground/80 mt-0.5">
                      &ldquo;{i.observaciones}&rdquo;
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {esCobrado ? (
                    <div>
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        Cobrado
                      </span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {fmt(i.fecha_cobro!)}
                        {i.medio_pago && ` · ${MEDIO_PAGO_LABEL[i.medio_pago] ?? i.medio_pago}`}
                        {cuentaNombre && (
                          <span className="font-medium text-foreground"> · {cuentaNombre}</span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        Pendiente
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top font-medium tabular-nums text-foreground">
                  {currencyFmt.format(i.monto)}
                </td>
                {hasActions && (
                  <td className="px-3 py-2 text-right align-top">
                    <div className="flex items-center justify-end gap-1">
                      {onEditar && (
                        <button
                          type="button"
                          onClick={() => onEditar(i)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Editar ingreso"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {onAnular && (
                        <button
                          type="button"
                          onClick={() => onAnular(i)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Anular ingreso"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
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
