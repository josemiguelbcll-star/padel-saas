import { useMemo, useState } from 'react';
import { Plus, ShoppingCart, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ConsumosCatalogo } from './ConsumosCatalogo';
import {
  useCargarConsumoTurno,
  useQuitarConsumoTurno,
  useReservaConsumos,
} from './hooks/useReservaConsumos';
import type { ReservaConsumo } from '@/types/database';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface ConsumosTurnoSectionProps {
  reservaId: number;
  /**
   * Monto del alquiler (reserva.monto_total). Se usa para el chip
   * "Total del turno = alquiler + consumos" al final de la sección.
   * NO se mezcla con la lógica de pagos (eso es paso 4).
   */
  montoAlquiler: number;
}

/**
 * Sección "Consumos" del DetalleReservaDialog (paso 2 del módulo cuenta
 * del turno). Lista los consumos cargados al turno + botón para agregar
 * via mini-catálogo embebido.
 *
 * La lista en DB son filas individuales (1 fila = 1 carga, preserva
 * cronología). La UI las CONSOLIDA por producto_id ("3× Coca") para
 * lectura más limpia. El × quita el último consumo del grupo (id más
 * alto): la cantidad del grupo baja, la fila desaparece de DB, el stock
 * se repone via fn_quitar_consumo_turno (Modelo B de la 0013).
 *
 * NO toca la lógica de pagos del alquiler ni la "Cuenta" del dialog. El
 * chip "Total del turno" abajo es informativo (alquiler + consumos)
 * pero NO unifica el saldo cobrable — eso es paso 4.
 */
export function ConsumosTurnoSection({
  reservaId,
  montoAlquiler,
}: ConsumosTurnoSectionProps) {
  const consumosQuery = useReservaConsumos(reservaId);
  const cargar = useCargarConsumoTurno();
  const quitar = useQuitarConsumoTurno();

  const [showCatalogo, setShowCatalogo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consumos = useMemo<ReservaConsumo[]>(
    () => consumosQuery.data ?? [],
    [consumosQuery.data],
  );

  // Consolidación por producto_id. La lista entra ordenada por fecha_hora
  // ASC (oldest first), así que el último id del array de cada grupo es
  // el más reciente — ese es el que × quita.
  const grupos = useMemo<ConsumoGrupo[]>(() => {
    const map = new Map<number, ConsumoGrupo>();
    for (const c of consumos) {
      const existing = map.get(c.producto_id);
      if (existing) {
        existing.cantidad_total += c.cantidad;
        existing.subtotal_total += c.subtotal;
        existing.consumos.push(c);
      } else {
        map.set(c.producto_id, {
          producto_id: c.producto_id,
          producto_nombre: c.producto_nombre,
          precio_unitario: c.precio_unitario,
          cantidad_total: c.cantidad,
          subtotal_total: c.subtotal,
          consumos: [c],
        });
      }
    }
    return Array.from(map.values());
  }, [consumos]);

  const totalConsumos = useMemo(
    () => consumos.reduce((sum, c) => sum + c.subtotal, 0),
    [consumos],
  );

  const totalTurno = montoAlquiler + totalConsumos;
  const anyPending = cargar.isPending || quitar.isPending;

  async function handleAgregar(productoId: number): Promise<void> {
    setError(null);
    try {
      await cargar.mutateAsync({
        reserva_id: reservaId,
        producto_id: productoId,
        cantidad: 1,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos cargar el consumo.',
      );
    }
  }

  async function handleQuitarUltimoDelGrupo(
    grupo: ConsumoGrupo,
  ): Promise<void> {
    // Como `grupo.consumos` está ordenado por fecha_hora ASC (igual que
    // la query), el último elemento es el más reciente (id mayor).
    const ultimo = grupo.consumos[grupo.consumos.length - 1];
    if (!ultimo) return;
    setError(null);
    try {
      await quitar.mutateAsync({
        consumo_id: ultimo.id,
        reserva_id: reservaId,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos quitar el consumo.',
      );
    }
  }

  if (consumosQuery.isLoading) {
    return (
      <section className="space-y-2">
        <Label>Consumos</Label>
        <div className="h-20 animate-pulse rounded-md border border-border bg-muted/40" />
      </section>
    );
  }

  if (consumosQuery.error) {
    return (
      <section className="space-y-2">
        <Label>Consumos</Label>
        <p className="text-xs text-destructive" role="alert">
          {consumosQuery.error.message}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Consumos</Label>
        {totalConsumos > 0 && (
          <span className="text-xs text-muted-foreground">
            Total consumos:{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {currencyFmt.format(totalConsumos)}
            </span>
          </span>
        )}
      </div>

      <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
        {/* Lista agrupada */}
        {grupos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin consumos cargados. Sumá productos del buffet al turno.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {grupos.map((g) => (
              <ConsumoGrupoRow
                key={g.producto_id}
                grupo={g}
                onQuitarUno={() => {
                  void handleQuitarUltimoDelGrupo(g);
                }}
                disabled={anyPending}
              />
            ))}
          </ul>
        )}

        {/* Agregar consumo: toggle del catálogo */}
        {showCatalogo ? (
          <div className="space-y-2 rounded-md border border-primary/30 bg-background p-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cargar producto
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCatalogo(false)}
                disabled={cargar.isPending}
              >
                Cerrar
              </Button>
            </div>
            <ConsumosCatalogo onAdd={handleAgregar} disabled={cargar.isPending} />
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              setShowCatalogo(true);
            }}
            disabled={anyPending}
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar consumo
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {/* Chip informativo: total del turno = alquiler + consumos.
          NO unifica el saldo cobrable; eso queda para el paso 4. */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
        <ShoppingCart
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="text-muted-foreground">
          Total del turno (alquiler + consumos):
        </span>
        <span className="ml-auto font-semibold tabular-nums text-foreground">
          {currencyFmt.format(totalTurno)}
        </span>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-componentes y tipos locales
// ─────────────────────────────────────────────────────────────────────

interface ConsumoGrupo {
  producto_id: number;
  producto_nombre: string;
  precio_unitario: number;
  cantidad_total: number;
  subtotal_total: number;
  /** Filas de DB que componen este grupo, ordenadas por fecha_hora ASC. */
  consumos: ReservaConsumo[];
}

function ConsumoGrupoRow({
  grupo,
  onQuitarUno,
  disabled,
}: {
  grupo: ConsumoGrupo;
  onQuitarUno: () => void;
  disabled: boolean;
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className="shrink-0 text-sm font-medium tabular-nums text-foreground"
        aria-label={`${grupo.cantidad_total} unidades`}
      >
        {grupo.cantidad_total}×
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {grupo.producto_nombre}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {currencyFmt.format(grupo.precio_unitario)} c/u
      </span>
      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">
        {currencyFmt.format(grupo.subtotal_total)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onQuitarUno}
        disabled={disabled}
        aria-label={`Quitar 1 unidad de ${grupo.producto_nombre}`}
        title={`Quitar 1 unidad (queda ${grupo.cantidad_total - 1})`}
        className={cn(
          'h-7 w-7 shrink-0 text-muted-foreground',
          'hover:bg-destructive/10 hover:text-destructive',
        )}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
