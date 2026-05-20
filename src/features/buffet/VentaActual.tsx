import { Minus, Plus, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductoConStock } from '@/types/database';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface VentaItemEnriquecido {
  producto: ProductoConStock;
  cantidad: number;
  subtotal: number;
}

interface VentaActualProps {
  items: VentaItemEnriquecido[];
  total: number;
  onIncrement: (productoId: number) => void;
  onDecrement: (productoId: number) => void;
  onCerrar: () => void;
}

/**
 * Panel "Venta actual" (derecha de la pantalla). Lista los items del
 * carrito con [-] cantidad [+] para ajustar, subtotales y total vivo.
 *
 * El carrito vive en BuffetPage como `Map<producto_id, cantidad>`; este
 * componente sólo recibe la lista enriquecida con el producto+subtotal
 * ya resueltos.
 *
 * Sticky en desktop (top-4) para que quede visible al scrollear el
 * catálogo largo.
 */
export function VentaActual({
  items,
  total,
  onIncrement,
  onDecrement,
  onCerrar,
}: VentaActualProps) {
  const vacio = items.length === 0;

  return (
    <aside
      aria-label="Venta actual"
      className="space-y-3 rounded-md border border-border bg-card p-4 lg:sticky lg:top-4"
    >
      <div className="flex items-center gap-2">
        <ShoppingCart className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Venta actual</h2>
      </div>

      {vacio ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Vacía. Tocá un producto del catálogo para sumarlo.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.producto.id}
                className="flex items-start gap-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">
                    {item.producto.nombre}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {currencyFmt.format(item.producto.precio)} c/u
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => onDecrement(item.producto.id)}
                    aria-label={`Quitar uno de ${item.producto.nombre}`}
                    className="h-7 w-7"
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center text-sm tabular-nums">
                    {item.cantidad}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => onIncrement(item.producto.id)}
                    disabled={item.cantidad >= item.producto.stock_actual}
                    aria-label={`Sumar uno de ${item.producto.nombre}`}
                    className="h-7 w-7"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>

                <div className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
                  {currencyFmt.format(item.subtotal)}
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {currencyFmt.format(total)}
            </span>
          </div>

          <Button
            type="button"
            onClick={onCerrar}
            className="w-full"
            size="lg"
          >
            Cerrar venta
          </Button>
        </>
      )}
    </aside>
  );
}
