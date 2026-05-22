import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TarifasPanel } from './TarifasPanel';
import {
  tarifasClasesConfig,
  tarifasTurnosConfig,
  type TarifasModulo,
} from './tarifasModuleConfig';

type TipoTarifa = TarifasModulo;

function parseTipo(raw: string | null): TipoTarifa {
  return raw === 'clases' ? 'clases' : 'turnos';
}

/**
 * Página de configuración de Tarifas con tabs Turnos | Clases.
 *
 * - Tab activo en URL search param `?tipo=turnos|clases`.
 *   Default `turnos` (retrocompatible: `/configuracion/tarifas` sin
 *   params funciona como antes y muestra turnos).
 * - Cada tab renderiza el mismo `TarifasPanel` con su config
 *   (tarifasTurnosConfig vs tarifasClasesConfig).
 *
 * El onboarding (StepTarifas) NO usa esta página — usa TarifasPanel
 * directo con tarifasTurnosConfig vía `TarifasPage`, evitando exponer
 * el concepto "Clases" durante el setup inicial.
 */
export function TarifasConfigPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tipo = parseTipo(searchParams.get('tipo'));
  const config = tipo === 'clases' ? tarifasClasesConfig : tarifasTurnosConfig;

  function cambiarTab(next: TipoTarifa): void {
    if (next === tipo) return;
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('tipo', next);
        return p;
      },
      { replace: true },
    );
  }

  return (
    <div className="space-y-4">
      <TabsBar activo={tipo} onChange={cambiarTab} />
      {/* key={tipo} fuerza remount al cambiar tab: garantiza que
          query y estado de dialogs arrancan limpios para el módulo
          nuevo. */}
      <TarifasPanel key={tipo} config={config} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TabsBar — segmented buttons (mismo patrón que el toggle Simple/Avanzado
// del form viejo de tarifas; sin shadcn Tabs para no sumar dependencia).
// ─────────────────────────────────────────────────────────────────────

interface TabsBarProps {
  activo: TipoTarifa;
  onChange: (next: TipoTarifa) => void;
}

const TABS: ReadonlyArray<{ value: TipoTarifa; label: string }> = [
  { value: 'turnos', label: 'Turnos' },
  { value: 'clases', label: 'Clases' },
];

function TabsBar({ activo, onChange }: TabsBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Tipo de tarifa"
      className="flex w-fit gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
    >
      {TABS.map((t) => {
        const isActive = activo === t.value;
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
