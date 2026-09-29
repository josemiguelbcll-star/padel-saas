import { useMemo, useState } from 'react';
import { AlertTriangle, Search, User, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useProductosConStock } from '@/features/configuracion/hooks/useProductosConStock';
import {
  CATEGORIAS_BUFFET,
  CATEGORIAS_SHOP,
  CATEGORIA_LABEL,
} from '@/features/configuracion/productos/productoSchema';
import type {
  CategoriaProducto,
  ProductoConStock,
  TipoRepartoConsumo,
} from '@/types/database';

const CATEGORIAS_TURNO = [
  ...CATEGORIAS_BUFFET,
  ...CATEGORIAS_SHOP,
] as const;

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COLOR_WARN = 'hsl(var(--estado-senada))';
const COLOR_WARN_FG = 'hsl(var(--estado-senada-foreground))';
const COLOR_WARN_BG = 'hsl(var(--estado-senada) / 0.12)';
const COLOR_WARN_BORDER = 'hsl(var(--estado-senada) / 0.40)';

type FiltroCategoria = 'todas' | CategoriaProducto;

export interface PersonaDestinoConsumo {
  id: number;
  nombre: string;
}

export interface ConsumosCatalogoProps {
  onAdd: (
    productoId: number,
    tipoReparto: TipoRepartoConsumo,
    personaId?: number | null,
  ) => void;
  disabled?: boolean;
  personas?: PersonaDestinoConsumo[];
  labelPersonas?: string;
}

export function ConsumosCatalogo({
  onAdd,
  disabled,
  personas = [],
  labelPersonas = 'Asignar consumo a:',
}: ConsumosCatalogoProps) {
  const productosQuery = useProductosConStock();
  const productos = useMemo(
    () => productosQuery.data ?? [],
    [productosQuery.data],
  );

  const [filtroCategoria, setFiltroCategoria] = useState<FiltroCategoria>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [tipoReparto, setTipoReparto] = useState<TipoRepartoConsumo>('general');
  const [personaSeleccionadaId, setPersonaSeleccionadaId] = useState<number | null>(null);

  const isIndividual = personaSeleccionadaId !== null;
  const isPartido = !isIndividual && tipoReparto === 'partido';

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

  const personaSeleccionadaNombre = useMemo(() => {
    if (!personaSeleccionadaId) return null;
    return personas.find((p) => p.id === personaSeleccionadaId)?.nombre ?? null;
  }, [personaSeleccionadaId, personas]);

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

  function handleProductClick(productoId: number) {
    if (isIndividual) {
      onAdd(productoId, 'individual', personaSeleccionadaId);
    } else {
      onAdd(productoId, tipoReparto, null);
    }
  }

  return (
    <div
      className={cn(
        'space-y-2.5',
        isPartido && 'rounded-md border-2 p-2',
        isIndividual && 'rounded-md border-2 border-primary/40 bg-primary/5 p-2',
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
      {/* 1. Selector de asignación (Grupal vs Individual) */}
      {personas.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>{labelPersonas}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setPersonaSeleccionadaId(null)}
              disabled={disabled}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border',
                !isIndividual
                  ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted',
              )}
            >
              <Users className="h-3 w-3" />
              Todo el grupo (Dividido)
            </button>
            {personas.map((p) => {
              const selected = personaSeleccionadaId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPersonaSeleccionadaId(p.id)}
                  disabled={disabled}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  <User className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">{p.nombre}</span>
                </button>
              );
            })}
          </div>

          {isIndividual && personaSeleccionadaNombre && (
            <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
              <User className="h-3.5 w-3.5" />
              <span>
                Cargando 100% a la cuenta de:{' '}
                <span className="underline">{personaSeleccionadaNombre}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* 2. Sub-opción grupal (si no es individual): Para todos vs Del partido */}
      {!isIndividual && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Reparto grupal:
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
      )}

      {/* 3. Filtros por categoría */}
      <div className="flex flex-wrap gap-1">
        <CategoriaPill
          label="Todas"
          active={filtroCategoria === 'todas'}
          onClick={() => setFiltroCategoria('todas')}
        />
        {CATEGORIAS_TURNO.map((cat) => (
          <CategoriaPill
            key={cat}
            label={CATEGORIA_LABEL[cat]}
            active={filtroCategoria === cat}
            onClick={() => setFiltroCategoria(cat)}
          />
        ))}
      </div>

      {/* 4. Buscador */}
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto..."
          className="h-8 pl-8 text-xs"
          aria-label="Buscar producto por nombre"
        />
      </div>

      {/* 5. Grid de productos */}
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
              onAdd={() => handleProductClick(p.id)}
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
      aria-label={`Sumar 1 ${producto.nombre}`}
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
