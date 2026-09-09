import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { Cancha } from '@/types/database';
import {
  detectarDeporte,
  obtenerInfoDeporte,
  type DeporteId,
} from '@/lib/deportes';

interface DeportesTabsProps {
  canchas: Cancha[];
  deporteSeleccionado: string;
  onSelectDeporte: (deporte: string) => void;
  className?: string;
}

export function DeportesTabs({
  canchas,
  deporteSeleccionado,
  onSelectDeporte,
  className,
}: DeportesTabsProps) {
  // Agrupar canchas por deporte y contar cuántas hay de cada uno
  const { deportesDisponibles, conteoPorDeporte } = useMemo(() => {
    const conteo: Record<string, number> = {};
    const ordenados: DeporteId[] = [];

    for (const c of canchas) {
      const dep = detectarDeporte(c);
      if (!conteo[dep]) {
        conteo[dep] = 0;
        ordenados.push(dep);
      }
      conteo[dep] += 1;
    }

    return {
      deportesDisponibles: ordenados,
      conteoPorDeporte: conteo,
    };
  }, [canchas]);

  if (canchas.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-1 backdrop-blur-sm',
        className,
      )}
      role="tablist"
      aria-label="Filtrar grilla por deporte"
    >
      {/* Botón: Todos */}
      <button
        type="button"
        role="tab"
        aria-selected={deporteSeleccionado === 'todos'}
        onClick={() => onSelectDeporte('todos')}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150',
          deporteSeleccionado === 'todos'
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
            : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
        )}
      >
        <span>Todos</span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums',
            deporteSeleccionado === 'todos'
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {canchas.length}
        </span>
      </button>

      {/* Pestañas por deporte presente */}
      {deportesDisponibles.map((depId) => {
        const info = obtenerInfoDeporte(depId);
        const count = conteoPorDeporte[depId] ?? 0;
        const isSelected = deporteSeleccionado === depId;

        return (
          <button
            key={depId}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelectDeporte(depId)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150',
              isSelected
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
                : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
            )}
          >
            <span>{info.icono}</span>
            <span>{info.label}</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums',
                isSelected
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
