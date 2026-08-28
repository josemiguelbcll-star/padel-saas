import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CircleDashed,
  Coins,
  Download,
  Layers,
  Package,
  Percent,
  Search,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ProductoConStock, Linea } from '@/types/database';
import { useResumenFinanciero } from '@/features/finanzas/hooks/useResumenFinanciero';
import { useInventarioProductos } from './hooks/useInventarioProductos';
import { AjustarStockDialog } from './AjustarStockDialog';
import { TopVendidosSection } from './TopVendidosSection';
import { RotacionSection } from './RotacionSection';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const fechaHoraFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

// ─────────────────────────────────────────────────────────────────────
// Tipos derivados de los filtros
// ─────────────────────────────────────────────────────────────────────

type LineaFiltro = 'todas' | Linea;
type EstadoFiltro = 'activos' | 'inactivos' | 'todos';
type StockFiltro = 'todos' | 'con' | 'sin';
type CostoFiltro = 'todos' | 'con' | 'sin';

interface CatalogoFiltros {
  linea: LineaFiltro;
  categoria: string;
  estado: EstadoFiltro;
  stock: StockFiltro;
  costo: CostoFiltro;
  busqueda: string;
  soloAlertas: boolean;
}

const INITIAL_FILTROS: CatalogoFiltros = {
  linea: 'todas',
  categoria: 'todas',
  estado: 'activos',
  stock: 'todos',
  costo: 'todos',
  busqueda: '',
  soloAlertas: false,
};

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────

export function CatalogoTab() {
  const query = useInventarioProductos();

  const ahora = new Date();
  const resumenMes = useResumenFinanciero(
    ahora.getFullYear(),
    ahora.getMonth() + 1,
  );

  const [filtros, setFiltros] = useState<CatalogoFiltros>(INITIAL_FILTROS);
  const [ajustando, setAjustando] = useState<ProductoConStock | null>(null);

  // Debounce de la búsqueda — evita re-renderizar la tabla en cada
  // keystroke. 200 ms es suficiente para que se sienta inmediato sin
  // hacer scroll/blink mientras el usuario tipea.
  const busquedaDebounced = useDebouncedValue(filtros.busqueda, 200);

  const todos = query.data ?? [];

  // Categorías disponibles según línea seleccionada (sobre los datos).
  const categoriasDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const p of todos) {
      if (filtros.linea !== 'todas' && p.linea !== filtros.linea) continue;
      set.add(p.categoria);
    }
    return Array.from(set).sort();
  }, [todos, filtros.linea]);

  // Filtrado de la tabla.
  const productos = useMemo(() => {
    const busq = busquedaDebounced.trim().toLowerCase();
    return todos.filter((p) => {
      if (filtros.linea !== 'todas' && p.linea !== filtros.linea) return false;
      if (filtros.categoria !== 'todas' && p.categoria !== filtros.categoria) return false;
      if (filtros.estado === 'activos' && !p.activo) return false;
      if (filtros.estado === 'inactivos' && p.activo) return false;
      if (filtros.stock === 'con' && p.stock_actual <= 0) return false;
      if (filtros.stock === 'sin' && p.stock_actual > 0) return false;
      if (filtros.costo === 'con' && p.costo === null) return false;
      if (filtros.costo === 'sin' && p.costo !== null) return false;
      if (busq && !p.nombre.toLowerCase().includes(busq)) return false;
      if (filtros.soloAlertas && !esEnAlerta(p)) return false;
      return true;
    });
  }, [todos, filtros, busquedaDebounced]);

  // KPIs sobre productos ACTIVOS (base coherente para los 4).
  const kpis = useMemo(() => computeKpis(todos), [todos]);

  // Margen real del mes (de useResumenFinanciero).
  const margenMes = useMemo(() => {
    const r = resumenMes.data;
    if (!r || r.ingresos_total === 0) return null;
    // Margen del negocio buffet+shop = ingresos buffet+shop − costos_directos.
    const ingresosVenta = r.ingresos_por_unidad
      .filter((u) => u.tipo === 'buffet' || u.tipo === 'shop')
      .reduce((acc, u) => acc + u.monto, 0);
    if (ingresosVenta === 0) return null;
    const margen = ingresosVenta - r.costos_directos;
    return {
      ingresosVenta,
      margen,
      pct: (margen / ingresosVenta) * 100,
    };
  }, [resumenMes.data]);

  async function handleExportValuedPdf() {
    if (productos.length === 0) return;
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
    const totalValores = productos.reduce((acc, p) => acc + (p.stock_actual * (p.costo ?? 0)), 0);
    const totalProductos = productos.length;

    doc.setFontSize(14);
    doc.text('MatchGo - Inventario Valorizado', 14, 16);
    doc.setFontSize(9);
    doc.text(`Generado: ${fechaHoraFmt.format(new Date())}`, 14, 22);
    doc.text(`Productos incluidos: ${totalProductos}`, 14, 27);

    autoTable(doc, {
      startY: 32,
      head: [['PRODUCTO', 'LÍNEA', 'CATEGORÍA', 'COSTO UNIT.', 'STOCK', 'VALOR TOTAL']],
      body: productos.map((p) => [
        p.nombre,
        p.linea === 'buffet' ? 'Buffet' : 'Shop',
        p.categoria,
        p.costo !== null ? currencyFmt.format(p.costo) : '—',
        String(p.stock_actual),
        p.costo !== null ? currencyFmt.format(p.stock_actual * p.costo) : '—',
      ]),
      foot: [['TOTAL VALORIZADO', '', '', '', '', currencyFmt.format(totalValores)]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 
        3: { halign: 'right' }, 
        4: { halign: 'right' }, 
        5: { halign: 'right' } 
      },
    });

    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    const d = String(new Date().getDate()).padStart(2, '0');
    doc.save(`inventario_valorizado_${y}_${m}_${d}.pdf`);
  }

  async function handleExportCountPdf() {
    if (productos.length === 0) return;
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
    doc.setFontSize(14);
    doc.text('MatchGo - Planilla de Conteo de Inventario', 14, 16);
    doc.setFontSize(9);
    doc.text(`Generado: ${fechaHoraFmt.format(new Date())}`, 14, 22);
    doc.text('Complete las columnas "Real" y "Ajuste" durante el conteo físico en el club.', 14, 27);

    autoTable(doc, {
      startY: 32,
      head: [['PRODUCTO', 'LÍNEA', 'CATEGORÍA', 'STOCK SISTEMA', 'STOCK REAL', 'AJUSTE']],
      body: productos.map((p) => [
        p.nombre,
        p.linea === 'buffet' ? 'Buffet' : 'Shop',
        p.categoria,
        String(p.stock_actual),
        '________________',
        '________________',
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [79, 70, 229] },
      columnStyles: { 
        3: { halign: 'right' }, 
        4: { halign: 'center' }, 
        5: { halign: 'center' } 
      },
    });

    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    const d = String(new Date().getDate()).padStart(2, '0');
    doc.save(`planilla_conteo_inventario_${y}_${m}_${d}.pdf`);
  }

  return (
    <div className="space-y-5">
      {/* ── KPIs hero ────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Coins}
          label="Valor del inventario"
          valor={query.isLoading ? null : fmtMoney(kpis.valorInventario)}
          subtitulo={
            kpis.sinCostoCount > 0
              ? `${kpis.sinCostoCount} producto(s) sin costo cargado · valor incompleto`
              : 'Calculado sobre productos activos con costo cargado'
          }
        />
        <KpiCard
          icon={Package}
          label="Productos activos"
          valor={query.isLoading ? null : String(kpis.activos)}
          subtitulo={
            `${kpis.conStock} con stock · ${kpis.sinStock} sin stock`
          }
          active={filtros.estado === 'activos' && !filtros.soloAlertas}
          onClick={() => {
            setFiltros((prev) => ({
              ...prev,
              estado: 'activos',
              soloAlertas: false,
            }));
          }}
        />
        <KpiCard
          icon={AlertTriangle}
          label="En alerta"
          valor={query.isLoading ? null : String(kpis.alertaTotal)}
          subtitulo={
            `${kpis.alertaSinStock} sin stock · ${kpis.alertaBajo} bajo mínimo`
          }
          tone={kpis.alertaTotal > 0 ? 'warning' : 'neutral'}
          active={filtros.soloAlertas}
          onClick={() => {
            setFiltros((prev) => ({
              ...prev,
              soloAlertas: !prev.soloAlertas,
            }));
          }}
        />
        <KpiCard
          icon={Percent}
          label="Margen del catálogo"
          valor={
            query.isLoading
              ? null
              : kpis.margenCatalogoPct === null
                ? '—'
                : `${kpis.margenCatalogoPct.toFixed(1)}%`
          }
          subtitulo={
            margenMes !== null
              ? `Margen real del mes (vta): ${margenMes.pct.toFixed(1)}%`
              : 'Promedio (precio − costo) / precio · catálogo, no negocio'
          }
        />
      </div>

      {/* ── Filtros ──────────────────────────────────────────────── */}
      <FiltrosBar
        filtros={filtros}
        onChange={setFiltros}
        categoriasDisponibles={categoriasDisponibles}
        onExportValued={handleExportValuedPdf}
        onExportCount={handleExportCountPdf}
        hayDatos={productos.length > 0}
      />

      {/* ── Tabla ────────────────────────────────────────────────── */}
      {query.isLoading && <SkeletonTabla />}
      {query.error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {query.error.message}
        </div>
      )}
      {query.data && (
        <ProductosTable
          productos={productos}
          totalSinFiltros={todos.length}
          onAjustar={(p) => setAjustando(p)}
        />
      )}

      {/* ── Secciones de análisis (Bloque 3, abajo de la tabla) ──── */}
      <TopVendidosSection />
      <RotacionSection />

      <AjustarStockDialog
        open={ajustando !== null}
        onOpenChange={(o) => {
          if (!o) setAjustando(null);
        }}
        producto={ajustando}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers de estado/KPIs
// ─────────────────────────────────────────────────────────────────────

type EstadoStock = 'sin_stock' | 'bajo' | 'ok';

function estadoDe(p: ProductoConStock): EstadoStock {
  if (p.stock_actual <= 0) return 'sin_stock';
  if (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo) return 'bajo';
  return 'ok';
}

function esEnAlerta(p: ProductoConStock): boolean {
  const e = estadoDe(p);
  return e === 'sin_stock' || e === 'bajo';
}

interface Kpis {
  activos: number;
  conStock: number;
  sinStock: number;
  alertaSinStock: number;
  alertaBajo: number;
  alertaTotal: number;
  valorInventario: number;
  sinCostoCount: number;
  margenCatalogoPct: number | null;
}

function computeKpis(productos: ProductoConStock[]): Kpis {
  const activos = productos.filter((p) => p.activo);
  let conStock = 0;
  let sinStock = 0;
  let alertaSinStock = 0;
  let alertaBajo = 0;
  let valorInventario = 0;
  let sinCostoCount = 0;
  const margenesPct: number[] = [];

  for (const p of activos) {
    if (p.stock_actual > 0) conStock++;
    else sinStock++;

    const e = estadoDe(p);
    if (e === 'sin_stock') alertaSinStock++;
    else if (e === 'bajo') alertaBajo++;

    if (p.costo === null) {
      sinCostoCount++;
    } else {
      valorInventario += p.stock_actual * Number(p.costo);
      if (Number(p.precio) > 0) {
        margenesPct.push(((p.precio - p.costo) / p.precio) * 100);
      }
    }
  }

  const margenCatalogoPct =
    margenesPct.length === 0
      ? null
      : margenesPct.reduce((a, b) => a + b, 0) / margenesPct.length;

  return {
    activos: activos.length,
    conStock,
    sinStock,
    alertaSinStock,
    alertaBajo,
    alertaTotal: alertaSinStock + alertaBajo,
    valorInventario,
    sinCostoCount,
    margenCatalogoPct,
  };
}

// ─────────────────────────────────────────────────────────────────────
// KpiCard (estilo dashboard/finanzas)
// ─────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  valor: string | null;
  subtitulo: string;
  tone?: 'neutral' | 'warning';
  onClick?: () => void;
  active?: boolean;
}

function KpiCard({
  icon: Icon,
  label,
  valor,
  subtitulo,
  tone = 'neutral',
  onClick,
  active = false,
}: KpiCardProps) {
  const isClickable = !!onClick;
  const Component = isClickable ? 'button' : 'article';

  return (
    <Component
      type={isClickable ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-card p-4 transition-all text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isClickable && 'cursor-pointer hover:bg-muted/30 hover:border-foreground/20',
        tone === 'warning' && valor && valor !== '0'
          ? active
            ? 'border-amber-500 bg-amber-500/10 dark:bg-amber-500/20'
            : 'border-amber-500/40'
          : active
            ? 'border-primary bg-primary/10 dark:bg-primary/20'
            : 'border-border',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
      </div>
      {valor === null ? (
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-muted/50" />
      ) : (
        <p
          className={cn(
            'mt-3 text-2xl font-bold tabular-nums leading-none',
            tone === 'warning' && valor !== '0'
              ? 'text-amber-700 dark:text-amber-500'
              : 'text-foreground',
          )}
        >
          {valor}
        </p>
      )}
      <p className="mt-3 line-clamp-2 text-[11px] text-muted-foreground">{subtitulo}</p>
    </Component>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Barra de filtros
// ─────────────────────────────────────────────────────────────────────

interface FiltrosBarProps {
  filtros: CatalogoFiltros;
  onChange: (f: CatalogoFiltros) => void;
  categoriasDisponibles: string[];
  onExportValued: () => void;
  onExportCount: () => void;
  hayDatos: boolean;
}

function FiltrosBar({
  filtros,
  onChange,
  categoriasDisponibles,
  onExportValued,
  onExportCount,
  hayDatos,
}: FiltrosBarProps) {
  function set<K extends keyof CatalogoFiltros>(key: K, value: CatalogoFiltros[K]) {
    onChange({ ...filtros, [key]: value });
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label htmlFor="buscar" className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Buscar
          </Label>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="buscar"
              type="search"
              value={filtros.busqueda}
              onChange={(e) => set('busqueda', e.target.value)}
              placeholder="Nombre del producto…"
              className="pl-8"
            />
          </div>
        </div>

        <SelectFiltro
          label="Línea"
          value={filtros.linea}
          onChange={(v) => {
            // Reset categoría al cambiar de línea (puede ya no existir).
            onChange({ ...filtros, linea: v as LineaFiltro, categoria: 'todas' });
          }}
          options={[
            { value: 'todas', label: 'Todas' },
            { value: 'buffet', label: 'Buffet' },
            { value: 'shop', label: 'Shop' },
          ]}
        />
        <SelectFiltro
          label="Categoría"
          value={filtros.categoria}
          onChange={(v) => set('categoria', v)}
          options={[
            { value: 'todas', label: 'Todas' },
            ...categoriasDisponibles.map((c) => ({ value: c, label: c })),
          ]}
        />
        <SelectFiltro
          label="Estado"
          value={filtros.estado}
          onChange={(v) => set('estado', v as EstadoFiltro)}
          options={[
            { value: 'activos', label: 'Activos' },
            { value: 'inactivos', label: 'Inactivos' },
            { value: 'todos', label: 'Todos' },
          ]}
        />
        <SelectFiltro
          label="Stock"
          value={filtros.stock}
          onChange={(v) => set('stock', v as StockFiltro)}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'con', label: 'Con stock' },
            { value: 'sin', label: 'Sin stock' },
          ]}
        />
        <SelectFiltro
          label="Costo"
          value={filtros.costo}
          onChange={(v) => set('costo', v as CostoFiltro)}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'con', label: 'Con costo' },
            { value: 'sin', label: 'Sin costo' },
          ]}
        />

        <div className="flex items-center gap-2 pb-1">
          <button
            type="button"
            onClick={() => set('soloAlertas', !filtros.soloAlertas)}
            aria-pressed={filtros.soloAlertas}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              filtros.soloAlertas
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'border-border bg-background text-muted-foreground hover:bg-muted',
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Solo alertas
          </button>
          {(filtros.busqueda !== '' ||
            filtros.linea !== 'todas' ||
            filtros.categoria !== 'todas' ||
            filtros.estado !== 'activos' ||
            filtros.stock !== 'todos' ||
            filtros.costo !== 'todos' ||
            filtros.soloAlertas) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(INITIAL_FILTROS)}
            >
              Limpiar
            </Button>
          )}

          {hayDatos && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onExportValued}
                className="h-8 gap-1 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                Valorizado
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onExportCount}
                className="h-8 gap-1 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                Planilla
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface SelectFiltroProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}

function SelectFiltro({ label, value, onChange, options }: SelectFiltroProps) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'flex h-9 rounded-md border border-input bg-background px-2 text-xs',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tabla
// ─────────────────────────────────────────────────────────────────────

function ProductosTable({
  productos,
  totalSinFiltros,
  onAjustar,
}: {
  productos: ProductoConStock[];
  totalSinFiltros: number;
  onAjustar: (p: ProductoConStock) => void;
}) {
  if (productos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <Layers className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          {totalSinFiltros === 0
            ? 'Todavía no hay productos cargados. Andá a Configuración → Productos.'
            : 'Ningún producto cumple los filtros actuales.'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          Mostrando{' '}
          <strong className="font-semibold text-foreground tabular-nums">
            {productos.length}
          </strong>{' '}
          de{' '}
          <strong className="font-semibold text-foreground tabular-nums">
            {totalSinFiltros}
          </strong>{' '}
          productos
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-semibold">Producto</th>
              <th className="px-3 py-2 text-left font-semibold">Línea</th>
              <th className="px-3 py-2 text-left font-semibold">Categoría</th>
              <th className="px-3 py-2 text-right font-semibold">Precio</th>
              <th className="px-3 py-2 text-right font-semibold">Costo</th>
              <th className="px-3 py-2 text-right font-semibold">Stock</th>
              <th className="px-3 py-2 text-right font-semibold">Mín.</th>
              <th className="px-3 py-2 text-left font-semibold">Estado</th>
              <th className="w-1 px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <ProductoRow key={p.id} p={p} onAjustar={() => onAjustar(p)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductoRow({ p, onAjustar }: { p: ProductoConStock; onAjustar: () => void }) {
  const estado = estadoDe(p);
  return (
    <tr
      className={cn(
        'border-b border-border/50 last:border-b-0 transition-colors hover:bg-muted/20',
        !p.activo && 'opacity-60',
      )}
    >
      <td className="px-4 py-2.5">
        <span className="font-medium text-foreground">{p.nombre}</span>
        {!p.activo && (
          <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Inactivo
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs capitalize text-muted-foreground">{p.linea}</td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">{p.categoria}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {fmtMoney(p.precio)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {p.costo === null ? (
          <span
            className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="Sin costo cargado: margen no calculable"
          >
            <CircleDashed className="h-3 w-3" aria-hidden="true" />
            sin costo
          </span>
        ) : (
          <span className="text-foreground">{fmtMoney(p.costo)}</span>
        )}
      </td>
      <td
        className={cn(
          'px-3 py-2.5 text-right font-semibold tabular-nums',
          estado === 'sin_stock'
            ? 'text-red-600 dark:text-red-500'
            : estado === 'bajo'
              ? 'text-amber-600 dark:text-amber-500'
              : 'text-foreground',
        )}
      >
        {p.stock_actual}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
        {p.stock_minimo > 0 ? p.stock_minimo : '—'}
      </td>
      <td className="px-3 py-2.5">
        <EstadoChip estado={estado} />
      </td>
      <td className="px-4 py-2.5 text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAjustar}
          aria-label={`Ajustar stock de ${p.nombre}`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Ajustar
        </Button>
      </td>
    </tr>
  );
}

function EstadoChip({ estado }: { estado: EstadoStock }) {
  if (estado === 'sin_stock') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Sin stock
      </span>
    );
  }
  if (estado === 'bajo') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Bajo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      OK
    </span>
  );
}

function SkeletonTabla() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-md border border-border bg-muted/30" />
      ))}
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

