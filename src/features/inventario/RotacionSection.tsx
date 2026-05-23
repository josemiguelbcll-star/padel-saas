import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info, Snail, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRotacion, type RotacionFila } from './hooks/useRotacion';

const DIAS_VENTANA = 30;

/**
 * Umbral debajo del cual decimos que el volumen de la ventana es bajo
 * y los números de rotación pueden mentir. Si menos de 10 productos
 * tuvieron alguna venta en {diasVentana}, mostramos una banda de
 * contexto bien explícita.
 */
const UMBRAL_BAJO_VOLUMEN = 10;

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
});

export function RotacionSection() {
  const [abierta, setAbierta] = useState(false);
  const query = useRotacion(DIAS_VENTANA);

  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-4 py-3 text-left',
          'transition-colors hover:bg-muted/30',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        <span className="flex items-center gap-2">
          {abierta ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-base font-semibold text-foreground">
            Rotación de inventario
          </span>
          <span className="text-[11px] text-muted-foreground">
            · estimación con ventas de los últimos {DIAS_VENTANA} días
          </span>
        </span>
      </button>

      {abierta && (
        <div className="border-t border-border px-4 py-4">
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

          {query.data && <RotacionContenido data={query.data} />}
        </div>
      )}
    </section>
  );
}

function RotacionContenido({
  data,
}: {
  data: {
    diasVentana: number;
    filas: RotacionFila[];
    totalActivosConStock: number;
    totalSinVentasConStock: number;
  };
}) {
  // ── Derivar listas: top rotación (más rápido) y slow movers. ────────
  // Top rotación: productos con ventas en la ventana, ordenados por
  // dias_de_stock ascendente (menos días = se va más rápido).
  // Slow movers: productos con stock > 0 y SIN ventas en la ventana
  // (estancados). NO incluimos los que tienen ventas y dias_de_stock
  // alto — esos son "lentos pero se mueven", caso menos urgente.
  const { topRotacion, slowMovers, conVentas } = useMemo(() => {
    const conVentas = data.filas.filter(
      (f) => f.dias_de_stock !== null && f.stock_actual > 0,
    );
    conVentas.sort((a, b) => (a.dias_de_stock ?? 0) - (b.dias_de_stock ?? 0));
    const topRotacion = conVentas.slice(0, 5);

    const slowMovers = data.filas
      .filter(
        (f) => f.stock_actual > 0 && f.unidades_vendidas_ventana === 0,
      )
      .sort((a, b) => b.stock_actual - a.stock_actual)
      .slice(0, 10);

    return { topRotacion, slowMovers, conVentas };
  }, [data.filas]);

  const productosConAlgunaVenta = conVentas.length;
  const bajoVolumen = productosConAlgunaVenta < UMBRAL_BAJO_VOLUMEN;

  return (
    <div className="space-y-4">
      {/* Contexto honesto */}
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border p-3 text-xs',
          bajoVolumen
            ? 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400'
            : 'border-border bg-muted/30 text-muted-foreground',
        )}
      >
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          {bajoVolumen ? (
            <p>
              <strong className="font-semibold">Volumen bajo:</strong>{' '}
              solo {productosConAlgunaVenta} producto
              {productosConAlgunaVenta === 1 ? ' tuvo' : 's tuvieron'} ventas
              en los últimos {data.diasVentana} días. Los "días de stock"
              estimados pueden dar valores muy grandes o "Sin ventas" para
              productos que se mueven ocasionalmente. Tomalo como
              orientación, no como verdad firme.
            </p>
          ) : (
            <p>
              {productosConAlgunaVenta} de {data.totalActivosConStock} productos
              con stock tuvieron ventas en {data.diasVentana} días.{' '}
              {data.totalSinVentasConStock > 0 && (
                <>
                  {data.totalSinVentasConStock} producto
                  {data.totalSinVentasConStock === 1 ? '' : 's'} con stock no se vendi
                  {data.totalSinVentasConStock === 1 ? 'ó' : 'eron'} en ese período.
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RotacionPanel
          titulo="Top rotación"
          subtitulo="Los que se mueven más rápido"
          icon={<Zap className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          empty="Todavía no hay ventas suficientes para estimar rotación."
          filas={topRotacion}
          render={(f) => (
            <>
              <ColumnaFila f={f} />
              <td className="px-3 py-2 text-right tabular-nums">
                <span
                  className={cn(
                    'font-semibold',
                    (f.dias_de_stock ?? 0) <= 7
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-foreground',
                  )}
                >
                  {f.dias_de_stock !== null
                    ? `${Math.round(f.dias_de_stock)} d`
                    : '—'}
                </span>
              </td>
            </>
          )}
          headerExtra="Días stock"
        />

        <RotacionPanel
          titulo="Slow movers"
          subtitulo={`Con stock y sin ventas en ${data.diasVentana} días`}
          icon={<Snail className="h-4 w-4 text-amber-600" aria-hidden="true" />}
          empty="No hay productos estancados — todos con stock tuvieron al menos una venta."
          filas={slowMovers}
          render={(f) => (
            <>
              <ColumnaFila f={f} />
              <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-500">
                {f.stock_actual}
              </td>
            </>
          )}
          headerExtra="Stock"
        />
      </div>
    </div>
  );
}

function ColumnaFila({ f }: { f: RotacionFila }) {
  return (
    <>
      <td className="px-4 py-2 text-sm text-foreground">
        <span className="font-medium">{f.producto_nombre}</span>
        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          {f.linea}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
        {f.unidades_vendidas_ventana > 0
          ? `${f.unidades_vendidas_ventana} vta`
          : f.ultima_venta_en_ventana
            ? dateFmt.format(new Date(f.ultima_venta_en_ventana))
            : 'Sin ventas'}
      </td>
    </>
  );
}

interface RotacionPanelProps {
  titulo: string;
  subtitulo: string;
  icon: React.ReactNode;
  empty: string;
  filas: RotacionFila[];
  /** Render del par de columnas a la derecha (después de Producto y Vta). */
  render: (f: RotacionFila) => React.ReactNode;
  headerExtra: string;
}

function RotacionPanel({
  titulo,
  subtitulo,
  icon,
  empty,
  filas,
  render,
  headerExtra,
}: RotacionPanelProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <header className="border-b border-border bg-muted/30 px-4 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {icon}
          {titulo}
        </p>
        <p className="text-[11px] text-muted-foreground">{subtitulo}</p>
      </header>
      {filas.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {empty}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-1.5 text-left font-semibold">Producto</th>
              <th className="px-3 py-1.5 text-right font-semibold">Vta</th>
              <th className="px-3 py-1.5 text-right font-semibold">
                {headerExtra}
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr
                key={f.producto_id}
                className="border-b border-border/40 last:border-b-0"
              >
                {render(f)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
