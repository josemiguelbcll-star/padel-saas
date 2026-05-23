import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResumenFinanciero } from './hooks/useResumenFinanciero';
import type { DrillKey } from './EERRTable';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: 'short',
});

function fmtFechaCorta(iso: string): string {
  return fechaCortaFmt.format(new Date(iso.length > 10 ? iso : iso + 'T00:00:00'));
}

interface DrillDownPanelProps {
  open: boolean;
  drillKey: DrillKey | null;
  resumen: ResumenFinanciero | null;
  onClose: () => void;
}

/**
 * Slide-over lateral que muestra el detalle de una línea del EERR.
 * Cero queries nuevas — los datos ya vienen en el resumen (ingresos
 * por unidad, costos por línea, top categorías de gasto, movimientos
 * recientes).
 *
 * Implementación custom (sin Radix): fixed right + transform translate
 * + backdrop. Cierra con click en backdrop, botón X o tecla Esc.
 */
export function DrillDownPanel({
  open,
  drillKey,
  resumen,
  onClose,
}: DrillDownPanelProps) {
  // Cerrar con Esc.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Bloquear scroll del body cuando el panel está abierto.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de línea del EERR"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card shadow-xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Detalle
            </p>
            <h3 className="text-base font-semibold text-foreground">
              {tituloDe(drillKey)}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {open && drillKey && resumen ? (
            <DrillContenido drillKey={drillKey} resumen={resumen} />
          ) : null}
        </div>
      </aside>
    </>
  );
}

function tituloDe(key: DrillKey | null): string {
  switch (key) {
    case 'ingresos':
      return 'Ingresos operativos';
    case 'ingreso_canchas':
      return 'Ingresos de Canchas';
    case 'ingreso_clases':
      return 'Ingresos de Clases';
    case 'ingreso_buffet':
      return 'Ingresos de Buffet';
    case 'ingreso_shop':
      return 'Ingresos de Shop';
    case 'costos_directos':
      return 'Costos directos (mercadería)';
    case 'gastos_directos':
      return 'Gastos directos a unidades';
    case 'gastos_estructura':
      return 'Gastos de estructura';
    case 'gastos_financieros':
      return 'Resultados financieros';
    case 'gastos_otros':
      return 'Otros gastos';
    default:
      return 'Detalle';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Contenido por tipo de drill
// ─────────────────────────────────────────────────────────────────────

function DrillContenido({
  drillKey,
  resumen,
}: {
  drillKey: DrillKey;
  resumen: ResumenFinanciero;
}) {
  switch (drillKey) {
    case 'ingresos':
      return <DetalleIngresos resumen={resumen} />;
    case 'ingreso_canchas':
    case 'ingreso_clases':
    case 'ingreso_buffet':
    case 'ingreso_shop': {
      const tipo = drillKey.replace('ingreso_', '');
      return <DetalleIngresoUnidad resumen={resumen} tipo={tipo} />;
    }
    case 'costos_directos':
      return <DetalleCostosDirectos resumen={resumen} />;
    case 'gastos_directos':
      return (
        <DetalleGastosPorCategoria
          resumen={resumen}
          filtroTipos={['canchas', 'clases', 'buffet', 'shop']}
        />
      );
    case 'gastos_estructura':
      return (
        <DetalleGastosPorCategoria
          resumen={resumen}
          filtroTipos={['estructura']}
        />
      );
    case 'gastos_financieros':
      return (
        <DetalleGastosPorCategoria
          resumen={resumen}
          filtroTipos={['financiero']}
        />
      );
    case 'gastos_otros':
      return (
        <DetalleGastosPorCategoria
          resumen={resumen}
          filtroTipos={['auspicios', 'membresias', 'otro']}
        />
      );
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Detalle: Ingresos operativos (todas las unidades juntas)
// ─────────────────────────────────────────────────────────────────────

function DetalleIngresos({ resumen }: { resumen: ResumenFinanciero }) {
  const unidades = resumen.ingresos_por_unidad;
  if (unidades.length === 0) {
    return <EstadoVacio mensaje="Sin ingresos cargados este mes." />;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Composición de los ingresos del mes por unidad de negocio.
      </p>
      <ul className="space-y-1">
        {unidades.map((u) => {
          const pct =
            resumen.ingresos_total > 0
              ? (u.monto / resumen.ingresos_total) * 100
              : 0;
          return (
            <li
              key={`${u.tipo}-${u.unidad}`}
              className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                  {u.unidad}
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {fmtMoney(u.monto)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Detalle: ingreso de UNA unidad — top movimientos del mes
// ─────────────────────────────────────────────────────────────────────

const TIPO_A_MOV: Record<string, string[]> = {
  canchas: ['cobro_reserva'],
  clases: ['cobro_clase'],
  buffet: ['venta'],
  shop: ['venta'],
};

function DetalleIngresoUnidad({
  resumen,
  tipo,
}: {
  resumen: ResumenFinanciero;
  tipo: string;
}) {
  const unidad = resumen.ingresos_por_unidad.find((u) => u.tipo === tipo);
  const tiposMov = TIPO_A_MOV[tipo] ?? [];
  const movsRelacionados = resumen.movimientos_recientes
    .filter((m) => tiposMov.includes(m.tipo))
    .slice(0, 15);

  if (!unidad || unidad.monto === 0) {
    return (
      <EstadoVacio
        mensaje={`Sin ingresos de ${unidad?.unidad ?? 'esta unidad'} este mes.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Total {unidad.unidad}
        </p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
          {fmtMoney(unidad.monto)}
        </p>
      </div>

      {movsRelacionados.length === 0 ? (
        <EstadoVacio mensaje="No hay movimientos recientes para mostrar." />
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Movimientos recientes
          </p>
          <ul className="divide-y divide-border">
            {movsRelacionados.map((m) => (
              <li key={m.id} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {fmtFechaCorta(m.fecha)}
                </span>
                <span className="flex-1 truncate text-foreground">
                  {m.descripcion}
                  {m.detalle && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {m.detalle}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-emerald-600 dark:text-emerald-500">
                  + {fmtMoney(m.monto)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Detalle: Costos directos (mercadería por línea)
// ─────────────────────────────────────────────────────────────────────

function DetalleCostosDirectos({ resumen }: { resumen: ResumenFinanciero }) {
  const lineas = resumen.costos_por_linea;
  if (lineas.length === 0 || resumen.costos_directos === 0) {
    return (
      <EstadoVacio mensaje="Sin costos directos cargados este mes." />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Costo de mercadería vendida — snapshot del costo al momento de
        cada venta. Solo aplica a Buffet y Shop.
      </p>
      <ul className="space-y-1">
        {lineas.map((l) => (
          <li
            key={l.linea}
            className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2"
          >
            <span className="text-sm font-medium capitalize text-foreground">
              {l.linea}
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {fmtMoney(l.monto)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Detalle: gastos por categoría — filtrado por tipo de unidad
// ─────────────────────────────────────────────────────────────────────

function DetalleGastosPorCategoria({
  resumen,
  filtroTipos,
}: {
  resumen: ResumenFinanciero;
  filtroTipos: string[];
}) {
  const items = resumen.top_gastos_categoria.filter((c) =>
    filtroTipos.includes(c.unidad_tipo),
  );
  if (items.length === 0) {
    return <EstadoVacio mensaje="Sin gastos cargados en esta categoría este mes." />;
  }
  const total = items.reduce((acc, c) => acc + c.monto, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Total
        </p>
        <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
          {fmtMoney(total)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Top categorías ordenadas por monto.
      </p>
      <ul className="space-y-1">
        {items.map((c) => {
          const pct = total > 0 ? (c.monto / total) * 100 : 0;
          return (
            <li
              key={`${c.unidad_nombre}-${c.categoria_nombre}`}
              className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {c.categoria_nombre}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {c.unidad_nombre}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {fmtMoney(c.monto)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Estado vacío
// ─────────────────────────────────────────────────────────────────────

function EstadoVacio({ mensaje }: { mensaje: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border">
      <p className="text-xs text-muted-foreground">{mensaje}</p>
    </div>
  );
}
