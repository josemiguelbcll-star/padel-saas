import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { useProductosConStock } from '@/features/configuracion/hooks/useProductosConStock';
import { Catalogo } from './Catalogo';
import { CerrarVentaDialog } from './CerrarVentaDialog';
import { VentaActual, type VentaItemEnriquecido } from './VentaActual';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Página de venta de mostrador del buffet.
 *
 * Layout split: catálogo a la izquierda (lee `useProductosConStock`),
 * carrito a la derecha. Estado del carrito local (useState) — no se
 * persiste hasta el cierre. La RPC `fn_cerrar_venta` (vía
 * `useCerrarVenta`) consolida cabecera + items + movimientos de stock
 * atómicamente; si stock no alcanza al momento del cierre (race con
 * otra venta concurrente), banner con el mensaje del RPC.
 *
 * Tras un cierre exitoso: el carrito se vacía y aparece un banner
 * temporal "Venta registrada por $X" (~5s).
 */
export function BuffetPage() {
  const { user } = useSession();
  const canEdit = getPermiso(user, 'mostrador', 'editar');

  const productosQuery = useProductosConStock();
  const productos = useMemo(
    () => productosQuery.data ?? [],
    [productosQuery.data],
  );

  // Carrito local: Map<producto_id, cantidad>. Vive solo en memoria; el
  // cierre lo materializa en la DB. Si el usuario navega a otra página
  // sin cerrar, el carrito se pierde (UX consciente: una venta abierta
  // implica un cliente atendiendo).
  const [cart, setCart] = useState<Map<number, number>>(() => new Map());

  // Banner de confirmación temporal tras cerrar venta.
  const [lastSale, setLastSale] = useState<{ total: number } | null>(null);
  useEffect(() => {
    if (lastSale === null) return;
    const id = window.setTimeout(() => setLastSale(null), 5000);
    return () => window.clearTimeout(id);
  }, [lastSale]);

  // Modal de cierre de venta.
  const [cerrarOpen, setCerrarOpen] = useState(false);

  function addOne(productoId: number): void {
    setLastSale(null);
    setCart((prev) => {
      const next = new Map(prev);
      next.set(productoId, (prev.get(productoId) ?? 0) + 1);
      return next;
    });
  }

  function decrementOne(productoId: number): void {
    setCart((prev) => {
      const next = new Map(prev);
      const current = prev.get(productoId) ?? 0;
      if (current <= 1) next.delete(productoId);
      else next.set(productoId, current - 1);
      return next;
    });
  }

  function incrementOne(productoId: number): void {
    setCart((prev) => {
      const next = new Map(prev);
      next.set(productoId, (prev.get(productoId) ?? 0) + 1);
      return next;
    });
  }

  function clearCart(): void {
    setCart(new Map());
  }

  // Enriquecemos los entries del carrito con el producto + subtotal.
  // Si un producto del carrito desaparece del catálogo (admin lo borró,
  // muy improbable mid-venta), se omite silenciosamente — el cierre se
  // hace solo con lo que tenga producto resuelto. La RPC validaría
  // igual del lado server.
  const items: VentaItemEnriquecido[] = useMemo(() => {
    const result: VentaItemEnriquecido[] = [];
    for (const [id, cantidad] of cart.entries()) {
      const producto = productos.find((p) => p.id === id);
      if (!producto) continue;
      result.push({
        producto,
        cantidad,
        subtotal: producto.precio * cantidad,
      });
    }
    return result;
  }, [cart, productos]);

  const total = useMemo(
    () => items.reduce((sum, i) => sum + i.subtotal, 0),
    [items],
  );

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Buffet
        </h1>
        <p className="text-sm text-muted-foreground">
          Venta de mostrador. Tocá productos del catálogo para armar la
          venta, ajustá cantidades en el carrito y cerrala con el medio
          de pago.
        </p>
      </header>

      {lastSale && (
        <div
          role="status"
          // Verde "pagada" leve. Usamos inline style con las CSS vars del
          // token --estado-pagada para evitar issues de cache del JIT de
          // Tailwind con utilities de opacidad sobre colores custom.
          className="flex items-center gap-2 rounded-md border p-3 text-sm"
          style={{
            borderColor: 'hsl(var(--estado-pagada) / 0.3)',
            backgroundColor: 'hsl(var(--estado-pagada) / 0.1)',
          }}
        >
          <CheckCircle2
            className="h-4 w-4 shrink-0"
            style={{ color: 'hsl(var(--estado-pagada))' }}
            aria-hidden="true"
          />
          <span className="text-foreground">
            Venta registrada por{' '}
            <span className="font-semibold tabular-nums">
              {currencyFmt.format(lastSale.total)}
            </span>
            .
          </span>
        </div>
      )}

      {productosQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : productosQuery.error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {productosQuery.error.message}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Catalogo productos={productos} cart={cart} onAdd={addOne} readOnly={!canEdit} />
          <VentaActual
            items={items}
            total={total}
            onIncrement={incrementOne}
            onDecrement={decrementOne}
            onCerrar={() => setCerrarOpen(true)}
            readOnly={!canEdit}
          />
        </div>
      )}

      <CerrarVentaDialog
        open={cerrarOpen}
        onOpenChange={setCerrarOpen}
        items={items}
        total={total}
        onSuccess={(venta) => {
          setCerrarOpen(false);
          clearCart();
          // monto_total viene como number desde supabase-js para DECIMAL.
          setLastSale({ total: venta.monto_total });
        }}
      />
    </div>
  );
}
