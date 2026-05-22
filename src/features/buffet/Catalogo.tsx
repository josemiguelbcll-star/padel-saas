import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  CategoriaProducto,
  Linea,
  ProductoConStock,
} from '@/types/database';
import {
  CATEGORIA_LABEL,
  LINEA_LABEL,
  categoriasPermitidas,
} from '@/features/configuracion/productos/productoSchema';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Filtro primario por línea. 'todas' muestra buffet + shop. */
type FiltroLinea = 'todas' | Linea;

/** Filtro secundario por categoría. 'todas' muestra todas las del filtro de línea. */
type FiltroCategoria = 'todas' | CategoriaProducto;

interface CatalogoProps {
  productos: ProductoConStock[];
  /** Mapa producto_id → cantidad ya en el carrito (para saber si llegamos al máximo de stock). */
  cart: Map<number, number>;
  /** Click en una card → suma 1 unidad de ese producto al carrito. */
  onAdd: (productoId: number) => void;
}

/**
 * Catálogo del mostrador (POS). Filtros en dos niveles:
 *   - Pills PRIMARIOS de línea: Todas / Buffet / Shop.
 *   - Pills SECUNDARIOS de categoría: dependientes del filtro de línea.
 *     Si la línea es "todas", se muestran todas las categorías (de
 *     ambas líneas).
 *
 * Cada card muestra un chip con la línea (Buffet/Shop) para que la
 * vendedora identifique de qué línea es el producto sin tener que
 * cambiar el filtro. Carrito mezcla líneas — se cobra todo junto en
 * una sola venta (fn_cerrar_venta server-side acepta carritos mixtos).
 *
 * El costo NO se muestra: es información interna del club.
 */
export function Catalogo({ productos, cart, onAdd }: CatalogoProps) {
  // El filtro de línea vive en el querystring (?linea=buffet|shop)
  // para que los sub-items del sidebar puedan deep-linkear al POS con
  // un filtro pre-aplicado. Si el querystring no está o tiene un valor
  // distinto, asumimos 'todas'.
  const [searchParams, setSearchParams] = useSearchParams();
  const filtroLineaRaw = searchParams.get('linea');
  const filtroLinea: FiltroLinea =
    filtroLineaRaw === 'buffet' || filtroLineaRaw === 'shop'
      ? filtroLineaRaw
      : 'todas';

  const [filtroCategoria, setFiltroCategoria] = useState<FiltroCategoria>('todas');
  const [busqueda, setBusqueda] = useState('');

  const productosActivos = useMemo(
    () => productos.filter((p) => p.activo),
    [productos],
  );

  // Categorías a mostrar como pills secundarios según el filtro de línea.
  // 'todas' → unión de buffet + shop. Línea específica → solo esa.
  const categoriasVisibles = useMemo<readonly CategoriaProducto[]>(() => {
    if (filtroLinea === 'todas') {
      return [...categoriasPermitidas('buffet'), ...categoriasPermitidas('shop')];
    }
    return categoriasPermitidas(filtroLinea);
  }, [filtroLinea]);

  // Cuando cambia el filtro de línea, sincronizamos el querystring y
  // reseteamos el filtro de categoría a 'todas' si la categoría actual
  // ya no es válida para la nueva línea.
  function handleChangeLinea(next: FiltroLinea): void {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'todas') {
          params.delete('linea');
        } else {
          params.set('linea', next);
        }
        return params;
      },
      { replace: true },
    );
    if (filtroCategoria === 'todas') return;
    if (next === 'todas') return;
    if (!categoriasPermitidas(next).includes(filtroCategoria)) {
      setFiltroCategoria('todas');
    }
  }

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productosActivos.filter((p) => {
      if (filtroLinea !== 'todas' && p.linea !== filtroLinea) return false;
      if (filtroCategoria !== 'todas' && p.categoria !== filtroCategoria) {
        return false;
      }
      if (q !== '' && !p.nombre.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [productosActivos, filtroLinea, filtroCategoria, busqueda]);

  return (
    <section className="space-y-3" aria-label="Catálogo del mostrador">
      {/* Filtros primarios — línea */}
      <div className="flex flex-wrap gap-1.5">
        <FiltroPill
          label="Todas"
          active={filtroLinea === 'todas'}
          variant="primary"
          onClick={() => handleChangeLinea('todas')}
        />
        {(['buffet', 'shop'] as const).map((linea) => (
          <FiltroPill
            key={linea}
            label={LINEA_LABEL[linea]}
            active={filtroLinea === linea}
            variant="primary"
            onClick={() => handleChangeLinea(linea)}
          />
        ))}
      </div>

      {/* Filtros secundarios — categoría (dependiente de la línea) */}
      <div className="flex flex-wrap gap-1.5">
        <FiltroPill
          label="Todas"
          active={filtroCategoria === 'todas'}
          variant="secondary"
          onClick={() => setFiltroCategoria('todas')}
        />
        {categoriasVisibles.map((cat) => (
          <FiltroPill
            key={cat}
            label={CATEGORIA_LABEL[cat]}
            active={filtroCategoria === cat}
            variant="secondary"
            onClick={() => setFiltroCategoria(cat)}
          />
        ))}
      </div>

      {/* Buscador */}
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

function FiltroPill({
  label,
  active,
  variant,
  onClick,
}: {
  label: string;
  active: boolean;
  variant: 'primary' | 'secondary';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        variant === 'primary'
          ? 'px-3 py-1.5 text-xs font-semibold'
          : 'px-2.5 py-1 text-[11px] font-medium',
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
      {/* Chip de línea — para identificar visualmente si es Buffet o Shop */}
      <LineaChip linea={producto.linea} />
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

function LineaChip({ linea }: { linea: Linea }) {
  // Buffet usa token estado-pagada (verde), Shop usa primary.
  // Inline style con hsl(var(--token) / X) — mismo patrón validado
  // contra el bug de cache de Tailwind con utilidades dinámicas.
  const color = linea === 'buffet'
    ? 'hsl(var(--estado-pagada))'
    : 'hsl(var(--primary))';
  const bg = linea === 'buffet'
    ? 'hsl(var(--estado-pagada) / 0.12)'
    : 'hsl(var(--primary) / 0.12)';

  return (
    <span
      className="inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ color, backgroundColor: bg }}
    >
      {LINEA_LABEL[linea]}
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
