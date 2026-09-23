import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Building2,
  FileSpreadsheet,
  Loader2,
  Search,
  User,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import {
  useMovimientosCuentas,
  type OrigenMovimientoCuenta,
} from './hooks/useMovimientosCuentas';

const AR_TZ = 'America/Argentina/Buenos_Aires';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

const fechaHoraFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: AR_TZ,
});

function fmtFechaHora(iso: string): string {
  try {
    return fechaHoraFmt.format(new Date(iso));
  } catch {
    return iso;
  }
}

function hoyAR(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function inicioSemanaAR(): string {
  const now = new Date();
  const day = now.getDay(); // 0 es domingo
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // lunes
  const lunes = new Date(now.setDate(diff));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(lunes);
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function inicioMesAR(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}-01`;
}

const ORIGEN_LABELS: Record<OrigenMovimientoCuenta, { label: string; badgeClass: string }> = {
  reserva_pago: { label: 'Turno', badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  venta: { label: 'Buffet', badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  clase_cobro: { label: 'Clase', badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  gasto: { label: 'Gasto', badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
  otro_ingreso: { label: 'Otro Ingreso', badgeClass: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' },
  gasto_cuota: { label: 'Cuota CxP', badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
  caja_manual: { label: 'Caja Manual', badgeClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  transferencia_origen: { label: 'Transferencia Salida', badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
  transferencia_destino: { label: 'Transferencia Entrada', badgeClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
};

export function MovimientosCuentasPage() {
  // useSession hook
  const cuentasQuery = useCuentas();
  const cuentas = cuentasQuery.data ?? [];

  // Filtros
  const [desde, setDesde] = useState<string>(inicioMesAR);
  const [hasta, setHasta] = useState<string>(hoyAR);
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'ingresos' | 'egresos' | 'transferencias'>('todos');
  const [search, setSearch] = useState('');

  const movimientosQuery = useMovimientosCuentas({
    desde,
    hasta,
    cuentaId,
  });

  const rawRows = movimientosQuery.data ?? [];

  // Filtrado client-side por tipo de flujo y búsqueda
  const filteredRows = useMemo(() => {
    let rows = rawRows;

    if (filtroTipo === 'ingresos') {
      rows = rows.filter((r) => r.signo > 0 && !r.origen.startsWith('transferencia'));
    } else if (filtroTipo === 'egresos') {
      rows = rows.filter((r) => r.signo < 0 && !r.origen.startsWith('transferencia'));
    } else if (filtroTipo === 'transferencias') {
      rows = rows.filter((r) => r.origen.startsWith('transferencia'));
    }

    const q = search.trim().toLowerCase();
    if (q !== '') {
      rows = rows.filter(
        (r) =>
          r.concepto.toLowerCase().includes(q) ||
          (r.detalle?.toLowerCase().includes(q) ?? false) ||
          r.cuenta_nombre.toLowerCase().includes(q) ||
          r.usuario_nombre.toLowerCase().includes(q)
      );
    }

    return rows;
  }, [rawRows, filtroTipo, search]);

  // Métricas del período
  const { totalIngresos, totalEgresos, flujoNeto } = useMemo(() => {
    let ingresos = 0;
    let egresos = 0;
    for (const r of filteredRows) {
      if (r.signo > 0) {
        ingresos += r.monto;
      } else {
        egresos += r.monto;
      }
    }
    return {
      totalIngresos: ingresos,
      totalEgresos: egresos,
      flujoNeto: ingresos - egresos,
    };
  }, [filteredRows]);

  // Saldo de la cuenta seleccionada o saldo total
  const saldoCuentaActual = useMemo(() => {
    if (cuentaId) {
      const c = cuentas.find((x) => x.id === cuentaId);
      return c?.saldo ?? 0;
    }
    return cuentas.reduce((acc, c) => acc + (c.saldo ?? 0), 0);
  }, [cuentas, cuentaId]);

  // Acciones de fecha rápida
  function setRangoHoy() {
    const h = hoyAR();
    setDesde(h);
    setHasta(h);
  }

  function setRangoSemana() {
    setDesde(inicioSemanaAR());
    setHasta(hoyAR());
  }

  function setRangoMes() {
    setDesde(inicioMesAR());
    setHasta(hoyAR());
  }

  // Exportar a Excel
  async function handleExportExcel() {
    if (filteredRows.length === 0) return;
    const XLSX = await import('xlsx');
    const headers = [
      'Fecha y Hora',
      'Cuenta',
      'Tipo de Cuenta',
      'Origen',
      'Concepto',
      'Detalle / Referencia',
      'Usuario que lo realizó',
      'Signo',
      'Monto',
    ];

    const data = filteredRows.map((r) => [
      fmtFechaHora(r.fecha_hora),
      r.cuenta_nombre,
      r.tipo_cuenta,
      ORIGEN_LABELS[r.origen]?.label ?? r.origen,
      r.concepto,
      r.detalle ?? '',
      r.usuario_nombre,
      r.signo > 0 ? '+' : '-',
      r.monto,
    ]);

    // Fila totalizadora
    data.push([
      '',
      '',
      '',
      '',
      'TOTAL NETO',
      '',
      '',
      flujoNeto >= 0 ? '+' : '-',
      flujoNeto,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
    XLSX.writeFile(wb, `movimientos_cuentas_${desde}_${hasta}.xlsx`);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Movimientos de Cuentas y Tesorería
          </h2>
          <p className="text-sm text-muted-foreground">
            Auditoría integral de movimientos bancarios, transferencias y cobros por cuenta con registro de usuario.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={filteredRows.length === 0}
            className="gap-1.5"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Exportar Excel</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              {cuentaId ? 'Saldo Cuenta Actual' : 'Saldo Total Tesorería'}
            </span>
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {fmtMoney(saldoCuentaActual)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {cuentaId
              ? cuentas.find((c) => c.id === cuentaId)?.nombre
              : 'Consolidado de todas las cuentas activas'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              Ingresos del Período
            </span>
            <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              +{fmtMoney(totalIngresos)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Cobros, ventas y entradas registradas
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              Egresos del Período
            </span>
            <ArrowUpRight className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
              -{fmtMoney(totalEgresos)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Gastos y cuotas pagadas
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              Flujo Neto Período
            </span>
            <ArrowLeftRight className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-bold tracking-tight',
                flujoNeto >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              )}
            >
              {flujoNeto >= 0 ? '+' : ''}
              {fmtMoney(flujoNeto)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Diferencia entre ingresos y egresos
          </p>
        </div>
      </div>

      {/* Barra de Filtros y Controles */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        {/* Fila 1: Cuenta y Período rápido */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Selector de Cuentas */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground mr-1">Cuenta:</span>
            <button
              type="button"
              onClick={() => setCuentaId(null)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                cuentaId === null
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              )}
            >
              Todas las cuentas
            </button>
            {cuentas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCuentaId(c.id)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5',
                  cuentaId === c.id
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                )}
              >
                <span>{c.nombre}</span>
                <span
                  className={cn(
                    'text-[10px] px-1 py-0.2 rounded uppercase tracking-wider',
                    cuentaId === c.id
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {c.tipo === 'billetera' ? 'MP' : c.tipo === 'banco' ? 'Banco' : c.tipo}
                </span>
              </button>
            ))}
          </div>

          {/* Botones de período rápido */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            <button
              type="button"
              onClick={setRangoHoy}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                desde === hoyAR() && hasta === hoyAR()
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={setRangoSemana}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                desde === inicioSemanaAR() && hasta === hoyAR()
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Esta Semana
            </button>
            <button
              type="button"
              onClick={setRangoMes}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                desde === inicioMesAR() && hasta === hoyAR()
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Este Mes
            </button>
          </div>
        </div>

        {/* Fila 2: Rango personalizado, buscador y tipo */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end pt-2 border-t border-border/60">
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tipo de Movimiento</Label>
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as any)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="todos">Todos los movimientos</option>
              <option value="ingresos">Solo Ingresos (+)</option>
              <option value="egresos">Solo Egresos (-)</option>
              <option value="transferencias">Solo Transferencias internas</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Búsqueda rápida</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Concepto, usuario, detalle..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de Movimientos */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {movimientosQuery.isLoading ? (
          <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Cargando movimientos de cuentas...</span>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Building2 className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No se encontraron movimientos</p>
            <p className="text-xs">
              Probá cambiando el rango de fechas o seleccionando otra cuenta.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                <tr>
                  <th className="py-2.5 px-4">Fecha y Hora</th>
                  <th className="py-2.5 px-4">Cuenta</th>
                  <th className="py-2.5 px-4">Origen / Concepto</th>
                  <th className="py-2.5 px-4">Detalle / Referencia</th>
                  <th className="py-2.5 px-4">Usuario</th>
                  <th className="py-2.5 px-4 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredRows.map((r) => {
                  const meta = ORIGEN_LABELS[r.origen] ?? {
                    label: r.origen,
                    badgeClass: 'bg-muted text-muted-foreground',
                  };
                  const esIngreso = r.signo > 0;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-4 whitespace-nowrap text-muted-foreground font-mono">
                        {fmtFechaHora(r.fecha_hora)}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          <span>{r.cuenta_nombre}</span>
                          <span className="text-[10px] px-1 py-0.2 rounded bg-muted text-muted-foreground uppercase">
                            {r.tipo_cuenta === 'billetera' ? 'MP' : r.tipo_cuenta}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border',
                              meta.badgeClass
                            )}
                          >
                            {meta.label}
                          </span>
                          <span className="font-medium text-foreground">{r.concepto}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 max-w-xs truncate text-muted-foreground" title={r.detalle ?? ''}>
                        {r.detalle ?? '—'}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-foreground">
                          <User className="h-3 w-3 text-muted-foreground" />
                          <span>{r.usuario_nombre}</span>
                          {r.usuario_rol && (
                            <span className="text-[9px] text-muted-foreground">({r.usuario_rol})</span>
                          )}
                        </div>
                      </td>
                      <td
                        className={cn(
                          'py-2.5 px-4 text-right font-mono font-medium whitespace-nowrap tabular-nums text-sm',
                          esIngreso
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        )}
                      >
                        {esIngreso ? '+' : '-'}
                        {fmtMoney(r.monto)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/20 font-medium">
                <tr>
                  <td colSpan={5} className="py-3 px-4 text-right text-xs font-semibold text-foreground uppercase tracking-wider">
                    Total del período ({filteredRows.length} movimientos):
                  </td>
                  <td
                    className={cn(
                      'py-3 px-4 text-right font-mono font-bold tabular-nums text-sm',
                      flujoNeto >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    )}
                  >
                    {flujoNeto >= 0 ? '+' : ''}
                    {fmtMoney(flujoNeto)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
