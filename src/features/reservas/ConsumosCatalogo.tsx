import { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useProductosConStock } from '@/features/configuracion/hooks/useProductosConStock';
import {
  CATEGORIAS_PRODUCTO,
  CATEGORIA_LABEL,
} from '@/features/configuracion/productos/productoSchema';
import type {
  CategoriaProducto,
  ProductoConStock,
  TipoRepartoConsumo,
} from '@/types/database';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Tokens warning para resaltar el modo "del partido". Mismo patrón
// (inline style con hsl(var(...) / X)) que ya usamos en
// PersonasTurnoSection para evitar el bug de cache de Tailwind con
// utilidades dinámicas.
const COLOR_WARN = 'hsl(var(--estado-senada))';
const COLOR_WARN_FG = 'hsl(var(--estado-senada-foreground))';
const COLOR_WARN_BG = 'hsl(var(--estado-senada) / 0.12)';
const COLOR_WARN_BORDER = 'hsl(var(--estado-senada) / 0.40)';

type FiltroCategoria = 'todas' | CategoriaProducto;

interface ConsumosCatalogoProps {
  /**
   * Click en una card → suma 1 unidad del producto al turno con el
   * tipo de reparto activo en el catálogo (general por default; partido
   * cuando la vendedora cambió el segmented control).
   */
  onAdd: (productoId: number, tipoReparto: TipoRepartoConsumo) => void;
  /** Deshabilita toda interacción mientras hay una mutación en curso. */
  disabled?: boolean;
}

/**
 * Mini-catálogo embebido en la sección Consumos del DetalleReservaDialog.
 *
 * Diferencia con `features/buffet/Catalogo`: el del Buffet llena un
 * carrito antes de cerrar venta; éste es de acción directa (1 click =
 * +1 unidad cargada al turno via fn_cargar_consumo_turno). No hay
 * carrito, no hay límite client-side por unidades acumuladas — la RPC
 * valida stock en cada click.
 *
 * Grid de 2 columnas para entrar cómodo dentro del dialog. Filtros por
 * categoría (pills) + buscador por nombre. Sólo productos activos.
 *
 * Lee el catálogo via `useProductosConStock`. React Query cachea, así
 * que si el parent ya tenía la query, no hay double-fetch.
 */
export function ConsumosCatalogo({ onAdd, disabled }: ConsumosCatalogoProps) {
  const productosQuery = useProductosConStock();
  const productos = useMemo(
    () => productosQuery.data ?? [],
    [productosQuery.data],
  );

  const [filtroCategoria, setFiltroCategoria] = useState<FiltroCategoria>('todas');
  const [busqueda, setBusqueda] = useState('');
  // Reparto del próximo click. Default 'general' (caso común). El
  // state se resetea naturalmente al cerrar el catálogo (el componente
  // se desmonta cuando ConsumosTurnoSection pone showCatalogo=false).
  const [tipoReparto, setTipoReparto] =
    useState<TipoRepartoConsumo>('general');

  const isPartido = tipoReparto === 'partido';

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

  if (productosQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (productosQuery.error) {
    return (
      <p className="text-xs text-destructive" role="alert">
        {productosQuery.error.message}
      </p>
    );
  }

  return (
    <div
      // Border ámbar suave cuando el modo es "del partido" — refuerzo
      // visual del segmented control + banner. La vendedora no debería
      // poder dejar el modo "del partido" puesto y cargar consumos
      // generales sin notarlo.
      className={cn(
        'space-y-2',
        isPartido && 'rounded-md border-2 p-2',
      )}
      style={
        isPartido
          ? {
              borderColor: COLOR_WARN_BORDER,
              backgroundColor: COLOR_WARN_BG,
            }
          : undefined
      }
    >
      {/* Toggle del reparto + banner cuando "del partido" */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">
            Reparto:
          </span>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setTipoReparto('general')}
              disabled={disabled}
              aria-pressed={!isPartido}
              className={cn(
                'px-2.5 py-1 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                !isPartido
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted',
              )}
            >
              Para todos
            </button>
            <button
              type="button"
              onClick={() => setTipoReparto('partido')}
              disabled={disabled}
              aria-pressed={isPartido}
              className={cn(
                'px-2.5 py-1 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                !isPartido && 'bg-background text-muted-foreground hover:bg-muted',
              )}
              style={
                isPartido
                  ? { backgroundColor: COLOR_WARN, color: COLOR_WARN_FG }
                  : undefined
              }
            >
              Del partido
            </button>
          </div>
        </div>

        {isPartido && (
          <div
            role="status"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium"
            style={{ backgroundColor: COLOR_WARN_BG, color: COLOR_WARN }}
          >
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>
              Los próximos clicks cargan como{' '}
              <span className="uppercase">consumo del partido</span> (sólo
              entre jugadores).
            </span>
          </div>
        )}
      </div>

      {/* Filtros por categoría */}
      <div className="flex flex-wrap gap-1">
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

      {/* Buscador */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto…"
          className="h-8 pl-8 text-xs"
          aria-label="Buscar producto por nombre"
        />
      </div>

      {/* Grid 2-col */}
      {productosActivos.length === 0 ? (
        <EmptyState>
          No hay productos activos en el catálogo. Cargá productos en
          Configuración → Productos.
        </EmptyState>
      ) : productosFiltrados.length === 0 ? (
        <EmptyState>Ningún producto coincide con el filtro.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {productosFiltrados.map((p) => (
            <ProductoCard
              key={p.id}
              producto={p}
              // Cierro el tipoReparto por closure — el ProductoCard
              // queda agnóstico de la feature 0015.
              onAdd={(productoId) => onAdd(productoId, tipoReparto)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
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
        'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
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
  onAdd: (productoId: number) => void;
  disabled?: boolean;
}

function ProductoCard({ producto, onAdd, disabled }: ProductoCardProps) {
  const noStock = producto.stock_actual <= 0;
  const cardDisabled = noStock || !!disabled;

  return (
    <button
      type="button"
      onClick={() => onAdd(producto.id)}
      disabled={cardDisabled}
      aria-label={`Sumar 1 ${producto.nombre} al turno`}
      className={cn(
        'flex flex-col gap-0.5 rounded-md border border-border bg-card p-2 text-left',
        'shadow-sm transition-shadow hover:shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:shadow-none',
      )}
    >
      <div className="line-clamp-2 text-xs font-medium text-foreground">
        {producto.nombre}
      </div>
      <div className="text-xs font-semibold tabular-nums text-foreground">
        {currencyFmt.format(producto.precio)}
      </div>
      <div
        className={cn(
          'text-[10px]',
          noStock ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {noStock ? 'Sin stock' : `Stock: ${producto.stock_actual}`}
      </div>
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-center">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
