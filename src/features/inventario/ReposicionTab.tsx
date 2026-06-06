import { useMemo, useState } from 'react';
import { PackageCheck, PackageX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRotacion } from './hooks/useRotacion';
import {
  productosParaReponer,
  UMBRAL_DIAS_REPONER,
  type ProductoReponer,
} from './utils/reponer';

/** Ventana de venta para estimar agotamiento. Igual a la de la alarma del
 *  dashboard → los números coinciden por construcción. */
const DIAS_VENTANA = 14;

const LINEA_LABEL: Record<string, string> = {
  buffet: 'Buffet',
  shop: 'Shop',
};

/**
 * Tab "Reposición": lista operativa de "lo que hay que pedir". Productos con
 * cobertura de stock por debajo de {UMBRAL_DIAS_REPONER} días al ritmo de los
 * últimos {DIAS_VENTANA} días, ordenados por urgencia (menos días arriba).
 *
 * Comparte fuente con la alarma del dashboard (useRotacion(14) +
 * productosParaReponer) → el conteo es idéntico al de la banda "Hoy".
 *
 * Distinto de RotacionSection (análisis de rotación: top movers / slow movers,
 * ventana 30d): esto es operativo, foco en agotamiento inminente.
 */
export function ReposicionTab() {
  const [soloReponer, setSoloReponer] = useState(true);
  const query = useRotacion(DIAS_VENTANA);

  const { reponer, completa } = useMemo(() => {
    const filas = query.data?.filas ?? [];
    return {
      reponer: productosParaReponer(filas),
      // Lista completa ranqueada por urgencia: todos los que tienen ritmo de
      // venta (dias_de_stock !== null), ordenados por días ascendente.
      completa: productosParaReponer(filas, Number.POSITIVE_INFINITY),
    };
  }, [query.data]);

  const lista = soloReponer ? reponer : completa;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">
            Productos para reponer
          </h2>
          <p className="text-xs text-muted-foreground">
            Estimación con las ventas de los últimos {DIAS_VENTANA} días ·
            urgencia primero
          </p>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={soloReponer}
            onChange={(e) => setSoloReponer(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          Solo &lt; {UMBRAL_DIAS_REPONER} días
          {!query.isLoading && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium tabular-nums text-muted-foreground">
              {reponer.length}
            </span>
          )}
        </label>
      </header>

      {query.isLoading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-11 animate-pulse rounded-md border border-border bg-muted/30"
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

      {query.data &&
        (lista.length === 0 ? (
          <VacioReponer soloReponer={soloReponer} />
        ) : (
          <TablaReponer filas={lista} />
        ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tabla
// ─────────────────────────────────────────────────────────────────────

type SeveridadFila = 'rojo' | 'ambar' | 'normal';

/**
 * Color de la fila por urgencia REAL (independiente del campo `severidad`,
 * que en la lista completa marcaría ámbar todo lo que tiene stock):
 *  - sin stock (con ventas) → rojo (crítico).
 *  - 0 < días < umbral → ámbar.
 *  - resto → normal.
 */
function severidadFila(p: ProductoReponer): SeveridadFila {
  if (p.stock_actual <= 0) return 'rojo';
  if (p.dias_de_stock !== null && p.dias_de_stock < UMBRAL_DIAS_REPONER) {
    return 'ambar';
  }
  return 'normal';
}

function TablaReponer({ filas }: { filas: ProductoReponer[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-medium">Producto</th>
            <th className="px-3 py-2 font-medium">Línea</th>
            <th className="px-3 py-2 text-right font-medium">Stock actual</th>
            <th className="px-3 py-2 text-right font-medium">Días de stock</th>
            <th className="px-3 py-2 text-right font-medium">
              Ventas {DIAS_VENTANA}d
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const sev = severidadFila(f);
            return (
              <tr
                key={f.producto_id}
                className={cn(
                  'border-b border-border last:border-b-0',
                  sev === 'rojo'
                    ? 'bg-red-500/10 hover:bg-red-500/15'
                    : 'hover:bg-muted/20',
                )}
              >
                <td className="px-3 py-2 align-middle font-medium text-foreground">
                  {f.producto_nombre}
                  {sev === 'rojo' && (
                    <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-600 ring-1 ring-red-500/40 dark:text-red-500">
                      Sin stock
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-middle text-[11px] uppercase tracking-wider text-muted-foreground">
                  {LINEA_LABEL[f.linea] ?? f.linea}
                </td>
                <td
                  className={cn(
                    'px-3 py-2 text-right align-middle tabular-nums',
                    sev === 'rojo'
                      ? 'font-semibold text-red-600 dark:text-red-500'
                      : 'text-foreground',
                  )}
                >
                  {f.stock_actual}
                </td>
                <td className="px-3 py-2 text-right align-middle tabular-nums">
                  <span
                    className={cn(
                      'font-semibold',
                      sev === 'rojo'
                        ? 'text-red-600 dark:text-red-500'
                        : sev === 'ambar'
                          ? 'text-amber-600 dark:text-amber-500'
                          : 'text-foreground',
                    )}
                  >
                    {f.dias_de_stock !== null
                      ? `${Math.round(f.dias_de_stock)} d`
                      : '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right align-middle tabular-nums text-muted-foreground">
                  {f.unidades_vendidas_ventana}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado vacío
// ─────────────────────────────────────────────────────────────────────

function VacioReponer({ soloReponer }: { soloReponer: boolean }) {
  if (soloReponer) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <PackageCheck
          className="mx-auto h-8 w-8 text-emerald-500"
          aria-hidden="true"
        />
        <p className="mt-2 text-sm font-medium text-foreground">
          Nada para reponer
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Todos los productos tienen stock suficiente para los próximos{' '}
          {UMBRAL_DIAS_REPONER} días.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <PackageX
        className="mx-auto h-8 w-8 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="mt-2 text-sm text-muted-foreground">
        No hubo ventas en los últimos {DIAS_VENTANA} días para estimar
        reposición.
      </p>
    </div>
  );
}
