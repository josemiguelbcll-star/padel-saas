import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  // Tab inicial desde la URL (?tab=reposicion) → deep-link desde la alarma del
  // dashboard. Solo inicializa; el cambio de tab posterior no toca la URL.
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab');
    return esTab(t) ? t : 'catalogo';
  });

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

      {tab === 'catalogo' && <CatalogoTab />}
      {tab === 'movimientos' && <MovimientosTab />}
      {tab === 'compras' && <ComprasTab />}
      {tab === 'reposicion' && <ReposicionTab />}
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

