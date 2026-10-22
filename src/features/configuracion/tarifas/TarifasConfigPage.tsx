import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { useProfesores } from '@/features/configuracion/hooks/useProfesores';
import {
  useAsignarTarifaClaseAProfesor,
  useTarifasClasesSinProfesor,
} from '@/features/configuracion/hooks/useTarifasClases';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { agruparPorLinaje } from './tarifaLineage';
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
 */
export function TarifasConfigPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tipo = parseTipo(searchParams.get('tipo'));

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
      {tipo === 'clases' ? (
        <TarifasClasesPanel key={tipo} />
      ) : (
        <TarifasPanel key={tipo} config={tarifasTurnosConfig} />
      )}
    </div>
  );
}

function TarifasClasesPanel() {
  const { user } = useSession();
  const profesoresQuery = useProfesores();
  const tarifasSinProfesorQuery = useTarifasClasesSinProfesor();
  const asignarTarifa = useAsignarTarifaClaseAProfesor();
  const [profesorId, setProfesorId] = useState<number | null>(null);
  const profesores = profesoresQuery.data ?? [];
  const profesorSeleccionado = profesores.find(
    (profesor) => profesor.id === profesorId,
  );
  const canEdit = getPermiso(user, 'configuracion', 'editar');
  const tarifasSinProfesor = agruparPorLinaje(
    tarifasSinProfesorQuery.data ?? [],
  ).filter((linaje) =>
    linaje.versiones.every((version) => version.profesor_id == null),
  );
  const moneda = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  });

  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-2">
        <Label htmlFor="tarifas-profesor">Profesor</Label>
        <select
          id="tarifas-profesor"
          value={profesorId ?? ''}
          onChange={(event) =>
            setProfesorId(event.target.value === '' ? null : Number(event.target.value))
          }
          disabled={profesoresQuery.isLoading}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Elegí un profesor</option>
          {profesores.map((profesor) => (
            <option key={profesor.id} value={profesor.id}>
              {profesor.nombre}{!profesor.activo ? ' (inactivo)' : ''}
            </option>
          ))}
        </select>
        {profesoresQuery.error && (
          <p role="alert" className="text-sm text-destructive">
            {profesoresQuery.error.message}
          </p>
        )}
      </div>
      {tarifasSinProfesorQuery.error && (
        <p role="alert" className="text-sm text-destructive">
          {tarifasSinProfesorQuery.error.message}
        </p>
      )}
      {tarifasSinProfesor.length > 0 && (
        <section className="space-y-3 rounded-lg border border-border p-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Franjas existentes sin asignar
            </h2>
            <p className="text-xs text-muted-foreground">
              Asignar mueve la franja y todo su historial de precios al
              profesor seleccionado.
            </p>
          </div>
          {tarifasSinProfesor.map((linaje) => (
            <div
              key={linaje.lineage_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div>
                <p className="text-sm font-medium text-foreground">
                  {linaje.nombre}
                </p>
                <p className="text-xs text-muted-foreground">
                  {linaje.desde_hora && linaje.hasta_hora
                    ? `${linaje.desde_hora.slice(0, 5)}–${linaje.hasta_hora.slice(0, 5)}`
                    : 'Todo horario'}
                  {' · '}
                  {linaje.vigenteHoy
                    ? moneda.format(linaje.vigenteHoy.monto)
                    : 'Sin precio vigente'}
                  {` · ${linaje.versiones.length} ${
                    linaje.versiones.length === 1 ? 'versión' : 'versiones'
                  }`}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canEdit || profesorId == null || asignarTarifa.isPending}
                onClick={() => {
                  if (profesorId === null) return;
                  asignarTarifa.mutate({
                    lineage_id: linaje.lineage_id,
                    profesor_id: profesorId,
                  });
                }}
              >
                Asignar a {profesorSeleccionado?.nombre ?? 'profesor'}
              </Button>
            </div>
          ))}
          {asignarTarifa.error && (
            <p role="alert" className="text-sm text-destructive">
              {asignarTarifa.error.message}
            </p>
          )}
        </section>
      )}
      <TarifasPanel
        key={profesorId ?? 'sin-profesor'}
        config={tarifasClasesConfig}
        profesorId={profesorId}
        profesorNombre={profesorSeleccionado?.nombre}
      />
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
