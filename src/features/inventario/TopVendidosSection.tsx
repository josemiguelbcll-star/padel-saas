import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTopVendidos, type TopVendido } from './hooks/useTopVendidos';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

const mesFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
});

/**
 * Sección "Top vendidos del mes" (Bloque 3) — debajo de la tabla de
 * productos en /inventario. Agregación por producto desde venta_items
 * + ventas del mes actual. Honesto sobre productos sin costo cargado
 * (no asume 0; muestra n/c).
 */
export function TopVendidosSection() {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth() + 1;
  const query = useTopVendidos(anio, mes);

  const mesLabel = mesFmt.format(ahora);

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Top vendidos del mes
        </h2>
        <p className="text-[11px] capitalize text-muted-foreground">{mesLabel}</p>
      </header>

      {query.isLoading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md border border-border bg-muted/30" />
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

      {query.data && query.data.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-xs text-muted-foreground">
            Todavía no hay ventas registradas este mes.
          </p>
        </div>
      )}

      {query.data && query.data.length > 0 && (
        <TopVendidosTable filas={query.data} />
      )}
    </section>
  );
}

function TopVendidosTable({ filas }: { filas: TopVendido[] }) {
  const algunoConParcial = filas.some((f) => f.parcial);
  const algunoSinCosto = filas.some((f) => f.unidades_con_costo === 0);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                <th className="px-3 py-2 text-left font-semibold">Línea</th>
                <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                <th className="px-3 py-2 text-right font-semibold">Ingreso</th>
                <th className="px-3 py-2 text-right font-semibold">Margen $</th>
                <th className="px-4 py-2 text-right font-semibold">Margen %</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, idx) => (
                <Row key={f.producto_id} f={f} pos={idx + 1} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(algunoSinCosto || algunoConParcial) && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-semibold">n/c</span> = margen no calculable
          (producto sin costo cargado al momento de la venta).{' '}
          {algunoConParcial && (
            <>
              <span className="font-semibold">parcial</span> = parte de las
              unidades se vendieron antes de cargar costo; el margen mostrado
              corresponde solo a la porción con costo conocido.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Row({ f, pos }: { f: TopVendido; pos: number }) {
  const sinCosto = f.unidades_con_costo === 0;
  return (
    <tr className="border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/20">
      <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
        {pos}
      </td>
      <td className="px-3 py-2.5 font-medium text-foreground">
        {f.producto_nombre}
      </td>
      <td className="px-3 py-2.5 text-xs capitalize text-muted-foreground">
        {f.linea}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {f.unidades}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {fmtMoney(f.ingreso)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {sinCosto || f.margen === null ? (
          <span className="text-muted-foreground">n/c</span>
        ) : (
          <span className="text-foreground">{fmtMoney(f.margen)}</span>
        )}
        {f.parcial && (
          <span
            className="ml-1.5 inline-flex items-center rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400"
            title={`${f.unidades_sin_costo} de ${f.unidades} unidades sin costo cargado`}
          >
            parcial
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {sinCosto || f.margen_pct === null ? (
          <span className="text-muted-foreground">n/c</span>
        ) : (
          <span
            className={cn(
              'font-semibold',
              f.margen_pct >= 30
                ? 'text-emerald-700 dark:text-emerald-400'
                : f.margen_pct < 10
                  ? 'text-amber-700 dark:text-amber-500'
                  : 'text-foreground',
            )}
          >
            {f.margen_pct.toFixed(1)}%
          </span>
        )}
      </td>
    </tr>
  );
}
