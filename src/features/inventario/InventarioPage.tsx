import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { ProductoFormDialog } from '@/features/configuracion/productos/ProductoFormDialog';
import { CatalogoTab } from './CatalogoTab';
import { MovimientosTab } from './MovimientosTab';
import { ComprasTab } from './ComprasTab';
import { ReposicionTab } from './ReposicionTab';

type Tab = 'catalogo' | 'movimientos' | 'compras' | 'reposicion';

function esTab(v: string | null): v is Tab {
  return (
    v === 'catalogo' ||
    v === 'movimientos' ||
    v === 'compras' ||
    v === 'reposicion'
  );
}

/**
 * Página principal del módulo de Inventario (Nivel A, Bloque 2).
 * Solo admin (gateada en sidebar + recomendable gatear ruta también).
 *
 * Tabs:
 *   - Catálogo: productos + stock + KPIs + ajustes manuales + top
 *     vendidos del mes + rotación.
 *   - Movimientos: auditoría del libro mayor (filtros producto / fuente
 *     / período).
 */
export function InventarioPage() {
  const { user } = useSession();
  const canEdit =
    getPermiso(user, 'inventario', 'editar') ||
    getPermiso(user, 'configuracion', 'editar');

  // Tab inicial desde la URL (?tab=reposicion) → deep-link desde la alarma del
  // dashboard. Solo inicializa; el cambio de tab posterior no toca la URL.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab');
    return esTab(t) ? t : 'catalogo';
  });
  const [crearProductoOpen, setCrearProductoOpen] = useState(false);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Package className="h-3.5 w-3.5" aria-hidden="true" />
            Inventario
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Buffet & Shop
          </h1>
        </div>
        {canEdit && (
          <Button
            type="button"
            onClick={() => setCrearProductoOpen(true)}
            className="gap-1.5 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Nuevo producto
          </Button>
        )}
      </header>

      <TabsBar activa={tab} onChange={setTab} />

      {tab === 'catalogo' && <CatalogoTab />}
      {tab === 'movimientos' && <MovimientosTab />}
      {tab === 'compras' && <ComprasTab />}
      {tab === 'reposicion' && <ReposicionTab />}

      <ProductoFormDialog
        open={crearProductoOpen}
        onOpenChange={setCrearProductoOpen}
        initialValue={null}
        initialLinea="buffet"
      />
    </div>
  );
}

interface TabsBarProps {
  activa: Tab;
  onChange: (next: Tab) => void;
}

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'catalogo', label: 'Catálogo + stock' },
  { value: 'movimientos', label: 'Movimientos' },
  { value: 'compras', label: 'Compras' },
  { value: 'reposicion', label: 'Reposición' },
];

function TabsBar({ activa, onChange }: TabsBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Vistas del inventario"
      className="flex w-fit gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
    >
      {TABS.map((t) => {
        const isActive = activa === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.value)}
            className={cn(
              'rounded px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

