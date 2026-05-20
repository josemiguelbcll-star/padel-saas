import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CategoriaProducto, ProductoConStock } from '@/types/database';
import {
  CATEGORIAS_PRODUCTO,
  CATEGORIA_LABEL,
} from '@/features/configuracion/productos/productoSchema';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type FiltroCategoria = 'todas' | CategoriaProducto;

interface CatalogoProps {
  productos: ProductoConStock[];
  /** Mapa producto_id → cantidad ya en el carrito (para saber si llegamos al máximo de stock). */
  cart: Map<number, number>;
  /** Click en una card → suma 1 unidad de ese producto al carrito. */
  onAdd: (productoId: number) => void;
}

/**
 * Catálogo del buffet. Solo productos activos. Filtros por categoría
 * (pills: Todas / Bebida / Snack / Otro) + buscador por nombre.
 *
 * Cada producto se muestra como una card grande tap-friendly (toda la
 * card es un <button>). Click suma 1 al carrito. La card se deshabilita
 * cuando stock_actual = 0 (sin stock) o cuando la cantidad ya en el
 * carrito iguala al stock (no se puede sumar más).
 *
 * El costo NO se muestra: es información interna del club, no del
 * vendedor de mostrador.
 */
export function Catalogo({ productos, cart, onAdd }: CatalogoProps) {
  const [filtroCategoria, setFiltroCategoria] = useState<FiltroCategoria>('todas');
  const [busqueda, setBusqueda] = useState('');

  const productosActivos = useMemo(
    () => productos.filter((p) => p.activo),
    [productos],
  );

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productosActivos.filter((p) => {
      if (filtroCategoria !== 'todas' && p.categoria !== filtroCategoria) {
        return false;
      }
      if (q !== '' && !p.nombre.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [productosActivos, filtroCategoria, busqueda]);

  return (
    <section className="space-y-3" aria-label="Catálogo del buffet">
      {/* Filtros + buscador */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <CategoriaPill
            label="Todas"
            active={filtroCategoria === 'todas'}
            onClick={() => setFiltroCategoria('todas')}
          />
          {CATEGORIAS_PRODUCTO.map((cat) => (
            <CategoriaPill
              key={cat}
              label={CATEGORIA_LABEL[cat]}
              active={filtroCategoria === cat}
              onClick={() => setFiltroCategoria(cat)}
            />
          ))}
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto…"
            className="pl-9"
            aria-label="Buscar producto por nombre"
          />
        </div>
      </div>

      {/* Grid de productos */}
      {productosActivos.length === 0 ? (
        <EmptyState>
          No hay productos activos en el catálogo. Cargá productos en
          Configuración → Productos.
        </EmptyState>
      ) : productosFiltrados.length === 0 ? (
        <EmptyState>Ningún producto coincide con el filtro.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {productosFiltrados.map((p) => (
            <ProductoCard
              key={p.id}
              producto={p}
              cartCantidad={cart.get(p.id) ?? 0}
              onAdd={onAdd}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CategoriaPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

interface ProductoCardProps {
  producto: ProductoConStock;
  cartCantidad: number;
  onAdd: (productoId: number) => void;
}

function ProductoCard({ producto, cartCantidad, onAdd }: ProductoCardProps) {
  const noStock = producto.stock_actual <= 0;
  const atMax = !noStock && cartCantidad >= producto.stock_actual;
  const disabled = noStock || atMax;

  const stockText = noStock
    ? 'Sin stock'
    : atMax
      ? `Stock: ${producto.stock_actual} (todo en el carrito)`
      : `Stock: ${producto.stock_actual}`;

  return (
    <button
      type="button"
      onClick={() => onAdd(producto.id)}
      disabled={disabled}
      aria-label={`Sumar ${producto.nombre} al carrito`}
      className={cn(
        'flex flex-col gap-1 rounded-md border border-border bg-card p-3 text-left',
        'shadow-sm transition-shadow hover:shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:shadow-none',
      )}
    >
      <div className="line-clamp-2 text-sm font-medium text-foreground">
        {producto.nombre}
      </div>
      <div className="text-sm font-semibold tabular-nums text-foreground">
        {currencyFmt.format(producto.precio)}
      </div>
      <div
        className={cn(
          'mt-1 text-[11px]',
          noStock ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {stockText}
      </div>
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
