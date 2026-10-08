import { useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  ArrowRight,
  Receipt,
  FileSpreadsheet,
  Search,
  TrendingUp,
  Lock,
  Eye,
  RefreshCw,
  Loader2,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  useTurnosCajaHistorial,
  type TurnoCajaConDetalles,
} from './hooks/useTurnosCajaHistorial';
import { DetalleArqueoDialog } from './DetalleArqueoDialog';
import { useUsuariosClub } from '@/features/configuracion/hooks/useUsuariosClub';

const AR_TZ = 'America/Argentina/Buenos_Aires';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: AR_TZ,
});

const horaFmt = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: AR_TZ,
});

function hoyAR(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ }).format(new Date());
}

function restarDias(fechaIso: string, dias: number): string {
  const d = new Date(fechaIso + 'T12:00:00');
  d.setDate(d.getDate() - dias);
  return new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ }).format(d);
}

function primerDiaMes(fechaIso: string): string {
  const [y, m] = fechaIso.split('-');
  return `${y}-${m}-01`;
}

type PresetRango = 'todos' | 'hoy' | 'ayer' | 'ultimos7' | 'esteMes' | 'custom';

export function ArqueosCajaPage() {
  const { data: turnos = [], isLoading, error, refetch, isFetching } =
    useTurnosCajaHistorial();
  const usuariosQuery = useUsuariosClub();
  const usuariosClub = usuariosQuery.data ?? [];

  // Estados de Filtros
  const [preset, setPreset] = useState<PresetRango>('todos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [usuarioFiltro, setUsuarioFiltro] = useState<string>('todos');
  const [estadoFiltro, setEstadoFiltro] = useState<'todos' | 'abierta' | 'cerrada'>('todos');
  const [diferenciaFiltro, setDiferenciaFiltro] = useState<
    'todos' | 'cuadrada' | 'con_diferencia' | 'faltante' | 'sobrante'
  >('todos');
  const [busqueda, setBusqueda] = useState('');

  // Turno seleccionado para ver detalle
  const [turnoSeleccionado, setTurnoSeleccionado] =
    useState<TurnoCajaConDetalles | null>(null);

  // Manejador de presets de fecha
  function handlePresetChange(p: PresetRango) {
    setPreset(p);
    const hoy = hoyAR();
    if (p === 'todos') {
      setFechaDesde('');
      setFechaHasta('');
    } else if (p === 'hoy') {
      setFechaDesde(hoy);
      setFechaHasta(hoy);
    } else if (p === 'ayer') {
      const ayer = restarDias(hoy, 1);
      setFechaDesde(ayer);
      setFechaHasta(ayer);
    } else if (p === 'ultimos7') {
      setFechaDesde(restarDias(hoy, 6));
      setFechaHasta(hoy);
    } else if (p === 'esteMes') {
      setFechaDesde(primerDiaMes(hoy));
      setFechaHasta(hoy);
    }
  }

  // Filtrado reactivo en cliente
  const turnosFiltrados = useMemo(() => {
    return turnos.filter((t) => {
      // Filtro por fecha jornada
      if (fechaDesde && t.fecha_jornada < fechaDesde) return false;
      if (fechaHasta && t.fecha_jornada > fechaHasta) return false;

      // Filtro por usuario (apertura o cierre)
      if (usuarioFiltro !== 'todos') {
        const coincideApertura = t.usuario_apertura === usuarioFiltro;
        const coincideCierre = t.usuario_cierre === usuarioFiltro;
        if (!coincideApertura && !coincideCierre) return false;
      }

      // Filtro por estado
      if (estadoFiltro === 'abierta' && t.cerrada_en !== null) return false;
      if (estadoFiltro === 'cerrada' && t.cerrada_en === null) return false;

      // Filtro por arqueo / diferencia
      if (diferenciaFiltro !== 'todos') {
        if (t.cerrada_en === null) return false;
        const diff = t.diferencia ?? 0;
        const esExacta = Math.abs(diff) < 0.01;
        if (diferenciaFiltro === 'cuadrada' && !esExacta) return false;
        if (diferenciaFiltro === 'con_diferencia' && esExacta) return false;
        if (diferenciaFiltro === 'faltante' && diff >= -0.01) return false;
        if (diferenciaFiltro === 'sobrante' && diff <= 0.01) return false;
      }

      // Filtro por búsqueda de texto
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase().trim();
        const idMatch = String(t.id).includes(q);
        const userAperturaMatch = t.usuarioAperturaNombre.toLowerCase().includes(q);
        const userCierreMatch = (t.usuarioCierreNombre || '').toLowerCase().includes(q);
        const obsMatch = (t.observaciones_cierre || '').toLowerCase().includes(q);
        const fechaMatch = t.fecha_jornada.includes(q);
        if (!idMatch && !userAperturaMatch && !userCierreMatch && !obsMatch && !fechaMatch) {
          return false;
        }
      }

      return true;
    });
  }, [
    turnos,
    fechaDesde,
    fechaHasta,
    usuarioFiltro,
    estadoFiltro,
    diferenciaFiltro,
    busqueda,
  ]);

  // KPIs del período filtrado
  const kpis = useMemo(() => {
    const totalCount = turnosFiltrados.length;
    let cerradasCount = 0;
    let cuadradasCount = 0;
    let conDiferenciaCount = 0;
    let sumaContado = 0;
    let sumaEsperado = 0;
    let sumaDiferenciaNeta = 0;

    for (const t of turnosFiltrados) {
      if (t.cerrada_en !== null) {
        cerradasCount++;
        const diff = t.diferencia ?? 0;
        if (Math.abs(diff) < 0.01) {
          cuadradasCount++;
        } else {
          conDiferenciaCount++;
        }
        sumaContado += t.efectivo_contado ?? 0;
        sumaEsperado += t.efectivo_esperado ?? 0;
        sumaDiferenciaNeta += diff;
      }
    }

    const efectividadCuadre =
      cerradasCount > 0 ? Math.round((cuadradasCount / cerradasCount) * 100) : 100;

    return {
      totalCount,
      cerradasCount,
      cuadradasCount,
      conDiferenciaCount,
      efectividadCuadre,
      sumaContado,
      sumaEsperado,
      sumaDiferenciaNeta,
    };
  }, [turnosFiltrados]);

  // Exportar a CSV para auditoría
  function handleExportarCsv() {
    if (turnosFiltrados.length === 0) return;

    const headers = [
      'ID Turno',
      'Fecha Jornada',
      'Estado',
      'Apertura Fecha/Hora',
      'Usuario Apertura',
      'Monto Apertura',
      'Cierre Fecha/Hora',
      'Usuario Cierre',
      'Efectivo Esperado',
      'Efectivo Contado',
      'Diferencia',
      'Observaciones Cierre',
      'Siguiente Apertura Monto',
      'Siguiente Apertura Usuario',
    ];

    const rows = turnosFiltrados.map((t) => [
      t.id,
      t.fecha_jornada,
      t.cerrada_en ? 'Cerrada' : 'Abierta',
      t.abierta_en,
      `"${t.usuarioAperturaNombre.replace(/"/g, '""')}"`,
      t.monto_apertura.toFixed(2),
      t.cerrada_en || '',
      `"${(t.usuarioCierreNombre || '').replace(/"/g, '""')}"`,
      t.efectivo_esperado !== null ? t.efectivo_esperado.toFixed(2) : '',
      t.efectivo_contado !== null ? t.efectivo_contado.toFixed(2) : '',
      t.diferencia !== null ? t.diferencia.toFixed(2) : '',
      `"${(t.observaciones_cierre || '').replace(/"/g, '""')}"`,
      t.siguienteTurno ? t.siguienteTurno.monto_apertura.toFixed(2) : '',
      `"${(t.siguienteTurno?.usuarioAperturaNombre || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `arqueos_caja_${hoyAR()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleLimpiarFiltros() {
    setPreset('todos');
    setFechaDesde('');
    setFechaHasta('');
    setUsuarioFiltro('todos');
    setEstadoFiltro('todos');
    setDiferenciaFiltro('todos');
    setBusqueda('');
  }

  const tieneFiltrosActivos =
    preset !== 'todos' ||
    fechaDesde !== '' ||
    fechaHasta !== '' ||
    usuarioFiltro !== 'todos' ||
    estadoFiltro !== 'todos' ||
    diferenciaFiltro !== 'todos' ||
    busqueda.trim() !== '';

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            <span>Arqueo de Caja</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Historial de aperturas, cierres y auditoría de arqueos con control
            de movimientos y usuarios responsables.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5 h-8 text-xs"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')}
            />
            <span>Actualizar</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportarCsv}
            disabled={turnosFiltrados.length === 0}
            className="gap-1.5 h-8 text-xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Exportar CSV</span>
          </Button>
        </div>
      </header>

      {/* Tarjetas de Métricas / KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Jornadas / Cajas
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {kpis.totalCount}
            </span>
            <span className="text-xs text-muted-foreground">
              ({kpis.cerradasCount} cerradas)
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Efectividad de Arqueo
          </span>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-bold tabular-nums',
                kpis.efectividadCuadre >= 90
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400',
              )}
            >
              {kpis.efectividadCuadre}%
            </span>
            <span className="text-xs text-muted-foreground">
              cuadraron exactas ({kpis.cuadradasCount}/{kpis.cerradasCount})
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Efectivo Contado Total
          </span>
          <span className="text-2xl font-bold tabular-nums text-primary block truncate">
            {currencyFmt.format(kpis.sumaContado)}
          </span>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Diferencia Acumulada
          </span>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-bold tabular-nums block truncate',
                Math.abs(kpis.sumaDiferenciaNeta) < 0.01
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : kpis.sumaDiferenciaNeta > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-destructive',
              )}
            >
              {kpis.sumaDiferenciaNeta > 0 ? '+' : ''}
              {currencyFmt.format(kpis.sumaDiferenciaNeta)}
            </span>
            {kpis.conDiferenciaCount > 0 && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                ({kpis.conDiferenciaCount} con diff)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Panel de Filtros */}
      <div className="rounded-xl border border-border bg-card p-3.5 sm:p-4 space-y-3 shadow-2xs">
        {/* Fila superior: Presets de fecha rápidos + Buscador */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          {/* Presets de fecha */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              Período:
            </span>
            {(
              [
                ['todos', 'Todos'],
                ['hoy', 'Hoy'],
                ['ayer', 'Ayer'],
                ['ultimos7', 'Últimos 7 días'],
                ['esteMes', 'Este mes'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant={preset === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => handlePresetChange(key)}
                className="h-7 px-2.5 text-xs rounded-md"
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Buscador de texto */}
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por #ID, usuario, notas…"
              className="h-8 pl-8 pr-7 text-xs w-full"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Fila inferior: Selectores de Fecha personalizada, Usuario, Estado y Diferencia */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-border/60 text-xs">
          {/* Rango de fechas manual */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium">
              Rango de fecha:
            </Label>
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={fechaDesde}
                onChange={(e) => {
                  setFechaDesde(e.target.value);
                  setPreset('custom');
                }}
                className="h-8 text-xs px-2"
              />
              <span className="text-muted-foreground text-xs">a</span>
              <Input
                type="date"
                value={fechaHasta}
                onChange={(e) => {
                  setFechaHasta(e.target.value);
                  setPreset('custom');
                }}
                className="h-8 text-xs px-2"
              />
            </div>
          </div>

          {/* Filtro por Usuario */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
              <User className="h-3 w-3" />
              Filtrar por usuario:
            </Label>
            <select
              value={usuarioFiltro}
              onChange={(e) => setUsuarioFiltro(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="todos">Todos los usuarios</option>
              {usuariosClub.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre || u.email} ({u.rol})
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Estado */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Estado de la caja:
            </Label>
            <select
              value={estadoFiltro}
              onChange={(e) =>
                setEstadoFiltro(e.target.value as 'todos' | 'abierta' | 'cerrada')
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="todos">Todas (Abiertas y Cerradas)</option>
              <option value="cerrada">Solo Cerradas con Arqueo</option>
              <option value="abierta">Solo Abiertas en curso</option>
            </select>
          </div>

          {/* Filtro por Arqueo / Diferencia */}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
              <SlidersHorizontal className="h-3 w-3" />
              Resultado del arqueo:
            </Label>
            <div className="flex items-center gap-1">
              <select
                value={diferenciaFiltro}
                onChange={(e) =>
                  setDiferenciaFiltro(
                    e.target.value as
                      | 'todos'
                      | 'cuadrada'
                      | 'con_diferencia'
                      | 'faltante'
                      | 'sobrante',
                  )
                }
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-w-0"
              >
                <option value="todos">Todos los resultados</option>
                <option value="cuadrada">✓ Cuadrada exacta</option>
                <option value="con_diferencia">⚠ Con diferencia</option>
                <option value="faltante">Faltante (−)</option>
                <option value="sobrante">Sobrante (+)</option>
              </select>

              {tieneFiltrosActivos && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleLimpiarFiltros}
                  className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                  title="Limpiar todos los filtros"
                >
                  Limpiar
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lista / Tabla de Turnos de Caja */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span>Cargando historial de arqueos de caja…</span>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error.message}
        </div>
      ) : turnosFiltrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center space-y-2">
          <Receipt className="h-8 w-8 text-muted-foreground mx-auto opacity-50" />
          <h3 className="font-semibold text-foreground">
            No se encontraron arqueos de caja
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            {tieneFiltrosActivos
              ? 'No hay registros que coincidan con los filtros aplicados. Probá modificando el rango de fechas o los filtros.'
              : 'Aún no se registraron jornadas de caja en este club.'}
          </p>
          {tieneFiltrosActivos && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLimpiarFiltros}
              className="mt-2 text-xs"
            >
              Restablecer filtros
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Vista Desktop: Tabla completa */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Jornada / Turno</th>
                  <th className="px-4 py-3 font-semibold">Apertura</th>
                  <th className="px-4 py-3 font-semibold">Cierre</th>
                  <th className="px-4 py-3 font-semibold">Arqueo / Diferencia</th>
                  <th className="px-4 py-3 font-semibold">Continuidad</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {turnosFiltrados.map((t) => {
                  const esAbierta = t.cerrada_en === null;
                  const diff = t.diferencia ?? 0;
                  const esCuadrada = !esAbierta && Math.abs(diff) < 0.01;
                  const esSobrante = !esAbierta && diff > 0.01;
                  const esFaltante = !esAbierta && diff < -0.01;

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-muted/20 transition-colors group"
                    >
                      {/* Jornada / Turno */}
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-0.5">
                          <span className="font-bold text-foreground block">
                            #{t.id}
                          </span>
                          <span className="text-xs text-muted-foreground capitalize block">
                            {fechaCortaFmt.format(
                              new Date(t.fecha_jornada + 'T12:00:00'),
                            )}
                          </span>
                        </div>
                      </td>

                      {/* Apertura */}
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-0.5 text-xs">
                          <span className="font-semibold text-foreground tabular-nums block">
                            {currencyFmt.format(t.monto_apertura)}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {horaFmt.format(new Date(t.abierta_en))}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1 truncate max-w-[140px]" title={t.usuarioAperturaNombre}>
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate">{t.usuarioAperturaNombre}</span>
                          </span>
                        </div>
                      </td>

                      {/* Cierre */}
                      <td className="px-4 py-3 align-top">
                        {esAbierta ? (
                          <span className="text-xs text-muted-foreground italic">
                            En curso (Caja abierta)
                          </span>
                        ) : (
                          <div className="space-y-0.5 text-xs">
                            <span className="font-semibold text-foreground tabular-nums block">
                              {currencyFmt.format(t.efectivo_contado ?? 0)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              Esperado: {currencyFmt.format(t.efectivo_esperado ?? 0)}
                            </span>
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {horaFmt.format(new Date(t.cerrada_en!))}
                            </span>
                            <span className="text-muted-foreground flex items-center gap-1 truncate max-w-[140px]" title={t.usuarioCierreNombre || ''}>
                              <User className="h-3 w-3 shrink-0" />
                              <span className="truncate">{t.usuarioCierreNombre}</span>
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Arqueo / Diferencia */}
                      <td className="px-4 py-3 align-top">
                        {esAbierta ? (
                          <span className="text-xs text-muted-foreground">-</span>
                        ) : esCuadrada ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Exacta ($0)
                          </span>
                        ) : esSobrante ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                            <TrendingUp className="h-3.5 w-3.5" />
                            +{currencyFmt.format(diff)}
                          </span>
                        ) : esFaltante ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {currencyFmt.format(diff)}
                          </span>
                        ) : null}
                      </td>

                      {/* Continuidad */}
                      <td className="px-4 py-3 align-top">
                        {t.siguienteTurno ? (
                          <div className="space-y-0.5 text-xs">
                            <div className="flex items-center gap-1 text-foreground font-medium">
                              <span className="tabular-nums">
                                {currencyFmt.format(t.siguienteTurno.monto_apertura)}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                (#{t.siguienteTurno.id})
                              </span>
                            </div>
                            {t.diferenciaConProximaApertura !== null && (
                              <span
                                className={cn(
                                  'text-[10px] block font-medium',
                                  Math.abs(t.diferenciaConProximaApertura) < 0.01
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-muted-foreground',
                                )}
                              >
                                {Math.abs(t.diferenciaConProximaApertura) < 0.01
                                  ? 'Pase idéntico'
                                  : t.diferenciaConProximaApertura < 0
                                    ? `Retirado: ${currencyFmt.format(Math.abs(t.diferenciaConProximaApertura))}`
                                    : `Refuerzo: +${currencyFmt.format(t.diferenciaConProximaApertura)}`}
                              </span>
                            )}
                          </div>
                        ) : esAbierta ? (
                          <span className="text-xs text-muted-foreground italic">
                            Caja actual
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            Última cerrada
                          </span>
                        )}
                      </td>

                      {/* Estado */}
                      <td className="px-4 py-3 align-top">
                        {esAbierta ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Abierta
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                            <Lock className="h-3 w-3" />
                            Cerrada
                          </span>
                        )}
                      </td>

                      {/* Acciones */}
                      <td className="px-4 py-3 text-right align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setTurnoSeleccionado(t)}
                          className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 gap-1"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Ver Arqueo</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Vista Mobile: Tarjetas táctiles y compactas */}
          <div className="md:hidden space-y-2.5">
            {turnosFiltrados.map((t) => {
              const esAbierta = t.cerrada_en === null;
              const diff = t.diferencia ?? 0;
              const esCuadrada = !esAbierta && Math.abs(diff) < 0.01;
              const esSobrante = !esAbierta && diff > 0.01;
              const esFaltante = !esAbierta && diff < -0.01;

              return (
                <div
                  key={t.id}
                  onClick={() => setTurnoSeleccionado(t)}
                  className="rounded-xl border border-border bg-card p-3.5 space-y-2.5 shadow-2xs active:bg-muted/30 transition-all cursor-pointer"
                >
                  {/* Encabezado tarjeta */}
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground">
                        Turno #{t.id}
                      </span>
                      {esAbierta ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Abierta
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                          <Lock className="h-2.5 w-2.5" />
                          Cerrada
                        </span>
                      )}
                    </div>

                    <span className="text-xs text-muted-foreground capitalize">
                      {fechaCortaFmt.format(new Date(t.fecha_jornada + 'T12:00:00'))}
                    </span>
                  </div>

                  {/* Detalle numérico */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="space-y-0.5 bg-muted/20 p-2 rounded-lg border border-border/50">
                      <span className="text-[10px] text-muted-foreground font-medium block">
                        Apertura ({horaFmt.format(new Date(t.abierta_en))})
                      </span>
                      <span className="font-bold text-foreground tabular-nums">
                        {currencyFmt.format(t.monto_apertura)}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate block">
                        {t.usuarioAperturaNombre}
                      </span>
                    </div>

                    <div className="space-y-0.5 bg-muted/20 p-2 rounded-lg border border-border/50">
                      <span className="text-[10px] text-muted-foreground font-medium block">
                        {esAbierta ? 'Cierre' : `Cierre (${horaFmt.format(new Date(t.cerrada_en!))})`}
                      </span>
                      <span className="font-bold text-foreground tabular-nums">
                        {esAbierta
                          ? 'En curso'
                          : currencyFmt.format(t.efectivo_contado ?? 0)}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate block">
                        {esAbierta ? 'Abierta actualmente' : t.usuarioCierreNombre}
                      </span>
                    </div>
                  </div>

                  {/* Arqueo y Continuidad */}
                  <div className="flex items-center justify-between pt-0.5 text-xs">
                    <div>
                      {!esAbierta && (
                        <div>
                          {esCuadrada ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Exacta ($0)
                            </span>
                          ) : esSobrante ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400">
                              <TrendingUp className="h-3 w-3" /> +{currencyFmt.format(diff)}
                            </span>
                          ) : esFaltante ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-destructive/10 text-destructive">
                              <AlertTriangle className="h-3 w-3" /> {currencyFmt.format(diff)}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 text-primary text-xs font-semibold">
                      <span>Ver Arqueo</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Diálogo de Detalle y Movimientos de la Caja */}
      <DetalleArqueoDialog
        open={turnoSeleccionado !== null}
        onOpenChange={(open) => {
          if (!open) setTurnoSeleccionado(null);
        }}
        turno={turnoSeleccionado}
      />
    </div>
  );
}
