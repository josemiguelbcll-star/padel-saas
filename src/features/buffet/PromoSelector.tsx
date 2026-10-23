import { PackageCheck, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProductoConStock, PromoBuffet } from '@/types/database';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface PromoSelectorProps {
  promos: PromoBuffet[];
  productos: ProductoConStock[];
  cantidadesReservadas?: Map<number, number>;
  onSelect: (promo: PromoBuffet) => void;
  disabled?: boolean;
}

export function PromoSelector({
  promos,
  productos,
  cantidadesReservadas = new Map(),
  onSelect,
  disabled = false,
}: PromoSelectorProps) {
  const promosActivas = promos.filter((promo) => promo.activo);
  if (promosActivas.length === 0) return null;

  return (
    <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3" aria-label="Promos predefinidas">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Tag className="h-4 w-4 text-primary" aria-hidden="true" />
        Promos para canchas
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {promosActivas.map((promo) => {
          const lineas = promo.items.map((item) => {
            const producto = productos.find((p) => p.id === item.producto_id);
            const stockDisponible = producto
              ? Math.max(0, producto.stock_actual - (cantidadesReservadas.get(producto.id) ?? 0))
              : 0;
            return { item, producto, stockDisponible };
          });
          const faltantes = lineas.filter(({ item, producto, stockDisponible }) =>
            !producto?.activo || stockDisponible < item.cantidad,
          );
          const tieneProductosValidos = lineas.length > 0 && faltantes.length === 0;
          const total = lineas.reduce(
            (sum, { item, producto }) => sum + (producto?.precio ?? 0) * item.cantidad,
            0,
          );
          const resumen = lineas.map(({ item, producto }) =>
            `${item.cantidad} × ${producto?.nombre ?? 'Producto no disponible'}`,
          ).join(' · ');

          return (
            <Button
              key={promo.id}
              type="button"
              variant="outline"
              className="h-auto justify-between gap-3 whitespace-normal py-2 text-left"
              disabled={disabled || !tieneProductosValidos}
              onClick={() => onSelect(promo)}
              aria-label={`Agregar promo ${promo.nombre} por ${currencyFmt.format(total)}`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold">
                  <PackageCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                  {promo.nombre}
                </span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {resumen}
                </span>
                {!tieneProductosValidos && (
                  <span className="mt-1 block text-xs font-medium text-destructive">
                    Sin stock suficiente: {faltantes.map(({ item, producto, stockDisponible }) =>
                      `${producto?.nombre ?? 'Producto inactivo'} (hay ${stockDisponible}, necesita ${item.cantidad})`,
                    ).join(' · ')}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs font-semibold tabular-nums">
                {currencyFmt.format(total)}
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
