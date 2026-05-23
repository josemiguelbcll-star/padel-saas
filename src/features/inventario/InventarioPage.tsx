import { useState } from 'react';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CatalogoTab } from './CatalogoTab';
import { MovimientosTab } from './MovimientosTab';

type Tab = 'catalogo' | 'movimientos';

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
  const [tab, setTab] = useState<Tab>('catalogo');

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Package className="h-3.5 w-3.5" aria-hidden="true" />
          Inventario
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Buffet & Shop
        </h1>
      </header>

      <TabsBar activa={tab} onChange={setTab} />

      {tab === 'catalogo' ? <CatalogoTab /> : <MovimientosTab />}
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

