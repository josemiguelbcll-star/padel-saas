import { useState, useMemo } from 'react';
import {
  Building2,
  CalendarCheck,
  DollarSign,
  Loader2,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/features/auth/useSession';
import { ClubesList } from './ClubesList';
import { DetalleClubDialog } from './DetalleClubDialog';
import { NuevoClubDialog } from './NuevoClubDialog';
import { useClubesPlataforma } from './hooks/useClubesPlataforma';

const dineroFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtDinero(monto: number): string {
  return dineroFmt.format(monto);
}

export function PlataformaPage() {
  const { plataformaAdmin, signOut } = useSession();
  const clubesQuery = useClubesPlataforma();

  const [selectedClubId, setSelectedClubId] = useState<number | null>(null);
  const [nuevoClubOpen, setNuevoClubOpen] = useState(false);

  // Filtros y búsqueda
  const [busqueda, setBusqueda] = useState('');
  const [filtroOrigen, setFiltroOrigen] = useState<'todos' | 'con_app' | 'sin_app' | 'activos'>('todos');
  const [orden, setOrden] = useState<'nombre' | 'reservas_app' | 'total_reservas' | 'ventas'>('nombre');

  const clubes = clubesQuery.data ?? [];

  // Métricas globales de la red MatchGo
  const metrics = useMemo(() => {
    const totalClubes = clubes.length;
    const totalCanchas = clubes.reduce((acc, c) => acc + (c.cantidad_canchas || 0), 0);
    const totalReservas = clubes.reduce((acc, c) => acc + (c.total_reservas || 0), 0);
    const totalReservasApp = clubes.reduce((acc, c) => acc + (c.reservas_app || 0), 0);
    const totalReservasPresencial = clubes.reduce((acc, c) => acc + (c.reservas_presenciales || 0), 0);
    const totalVentasMes = clubes.reduce((acc, c) => acc + (Number(c.total_ventas_mes_actual) || 0), 0);
    const totalVentasTotal = clubes.reduce((acc, c) => acc + (Number(c.total_ventas_historico) || 0), 0);
    const pctApp = totalReservas > 0 ? Math.round((totalReservasApp / totalReservas) * 100) : 0;

    return {
      totalClubes,
      totalCanchas,
      totalReservas,
      totalReservasApp,
      totalReservasPresencial,
      totalVentasMes,
      totalVentasTotal,
      pctApp,
    };
  }, [clubes]);

  // Filtrado y ordenamiento de clubes
  const clubesFiltrados = useMemo(() => {
    let result = [...clubes];

    // Búsqueda por texto (nombre, slug, admin, email)
    if (busqueda.trim()) {
      const q = busqueda.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.nombre.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          (c.admin_nombre && c.admin_nombre.toLowerCase().includes(q)) ||
          (c.admin_email && c.admin_email.toLowerCase().includes(q)),
      );
    }

    // Filtro por adopción / estado
    if (filtroOrigen === 'con_app') {
      result = result.filter((c) => (c.reservas_app ?? 0) > 0);
    } else if (filtroOrigen === 'sin_app') {
      result = result.filter((c) => (c.reservas_app ?? 0) === 0);
    } else if (filtroOrigen === 'activos') {
      result = result.filter((c) => c.estado === 'activo' || c.estado === 'trial');
    }

    // Ordenamiento
    result.sort((a, b) => {
      if (orden === 'reservas_app') {
        return (b.reservas_app ?? 0) - (a.reservas_app ?? 0);
      }
      if (orden === 'total_reservas') {
        return (b.total_reservas ?? 0) - (a.total_reservas ?? 0);
      }
      if (orden === 'ventas') {
        return (b.total_ventas_mes_actual ?? 0) - (a.total_ventas_mes_actual ?? 0);
      }
      return a.nombre.localeCompare(b.nombre);
    });

    return result;
  }, [clubes, busqueda, filtroOrigen, orden]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header sticky con identidad del superadmin + signOut */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-semibold uppercase tracking-wide">
              Panel de plataforma MatchGo
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-foreground">
                {plataformaAdmin?.nombre ?? '—'}
              </p>
              {plataformaAdmin?.email && (
                <p className="text-[11px] text-muted-foreground">
                  {plataformaAdmin.email}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void signOut();
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
        {/* Encabezado + Botón Nuevo Club */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Panel de Control y Clubes
              {clubes.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({clubes.length} {clubes.length === 1 ? 'club' : 'clubes'})
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              Monitoreo de red, adopción de reservas de jugador MatchGo y acceso a clubes.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setNuevoClubOpen(true)}
            className="shrink-0 gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nuevo club
          </Button>
        </div>

        {/* Tarjetas KPI de la Red */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Clubes / Canchas</span>
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">
                {metrics.totalClubes}
              </span>
              <span className="text-xs text-muted-foreground">
                ({metrics.totalCanchas} canchas)
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Reservas Totales</span>
              <CalendarCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">
                {metrics.totalReservas.toLocaleString('es-AR')}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Reservas App MatchGo</span>
              <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {metrics.totalReservasApp.toLocaleString('es-AR')}
              </span>
              <span className="text-xs font-medium text-emerald-600/80 dark:text-emerald-400/80">
                ({metrics.pctApp}% adopción)
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Ventas Red (Mes)</span>
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">
                {fmtDinero(metrics.totalVentasMes)}
              </span>
            </div>
          </div>
        </div>

        {/* Barra de Búsqueda y Filtros de Reservas */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border bg-card/60 p-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por club, slug, admin o email…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1 text-xs">
              <Button
                type="button"
                size="sm"
                variant={filtroOrigen === 'todos' ? 'secondary' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setFiltroOrigen('todos')}
              >
                Todos ({clubes.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filtroOrigen === 'con_app' ? 'secondary' : 'ghost'}
                className="h-7 px-2.5 text-xs gap-1 text-emerald-600 dark:text-emerald-400 font-medium"
                onClick={() => setFiltroOrigen('con_app')}
              >
                <Smartphone className="h-3 w-3" />
                Con App ({clubes.filter((c) => (c.reservas_app ?? 0) > 0).length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filtroOrigen === 'sin_app' ? 'secondary' : 'ghost'}
                className="h-7 px-2.5 text-xs text-muted-foreground"
                onClick={() => setFiltroOrigen('sin_app')}
              >
                Sin App ({clubes.filter((c) => (c.reservas_app ?? 0) === 0).length})
              </Button>
            </div>

            <select
              value={orden}
              onChange={(e) => setOrden(e.target.value as any)}
              className="h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="nombre">Ordenar: Nombre A-Z</option>
              <option value="reservas_app">Ordenar: Mayor reservas App</option>
              <option value="total_reservas">Ordenar: Mayor reservas totales</option>
              <option value="ventas">Ordenar: Mayor ventas (mes)</option>
            </select>
          </div>
        </div>

        {clubesQuery.isLoading && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Cargando clubes y métricas…
          </div>
        )}

        {clubesQuery.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {clubesQuery.error.message}
          </div>
        )}

        {clubesQuery.data && (
          <ClubesList
            clubes={clubesFiltrados}
            onClickClub={(club) => setSelectedClubId(club.id)}
          />
        )}
      </main>

      <DetalleClubDialog
        open={selectedClubId !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedClubId(null);
        }}
        clubId={selectedClubId}
      />

      <NuevoClubDialog
        open={nuevoClubOpen}
        onOpenChange={setNuevoClubOpen}
      />
    </div>
  );
}
