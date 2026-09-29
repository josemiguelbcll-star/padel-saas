import { useMemo, useState } from 'react';
import {
  Award,
  Coffee,
  DollarSign,
  Medal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import {
  useDeleteJugador,
  useJugadores,
} from '@/features/reservas/hooks/useJugadores';
import type { Jugador, JugadorConEstadisticas } from '@/types/database';
import { JugadorFormDialog } from './JugadorFormDialog';
import {
  CATEGORIA_LABEL,
  GENERO_LABEL,
  POSICION_LABEL,
} from './jugadorSchema';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

function fmtFechaCorta(iso: string | null): string {
  if (!iso) return '—';
  // ISO date YYYY-MM-DD
  const [y, m, d] = iso.split('-');
  if (!d) return iso;
  return `${d}/${m}/${y}`;
}

type CriterioOrden = 'ranking' | 'visitas' | 'buffet' | 'nombre';

export function JugadoresPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';
  const canEdit = getPermiso(user, 'reservas', 'editar');

  const jugadoresQuery = useJugadores();
  const deleteMutation = useDeleteJugador();

  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<CriterioOrden>('ranking');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Jugador | null>(null);
  const [toDelete, setToDelete] = useState<Jugador | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const jugadores = useMemo(
    () => jugadoresQuery.data ?? [],
    [jugadoresQuery.data],
  );

  // Estadísticas globales del club
  const metricasGlobales = useMemo(() => {
    const totalJugadores = jugadores.length;
    const totalGastoTurnos = jugadores.reduce((s, j) => s + (j.gasto_turnos || 0), 0);
    const totalGastoBuffet = jugadores.reduce((s, j) => s + (j.gasto_buffet || 0), 0);
    const totalGastoGeneral = totalGastoTurnos + totalGastoBuffet;

    // Top jugador con más visitas
    const topVisitas = [...jugadores].sort((a, b) => (b.visitas || 0) - (a.visitas || 0))[0];
    // Top jugador con más gasto en buffet
    const topBuffet = [...jugadores].sort((a, b) => (b.gasto_buffet || 0) - (a.gasto_buffet || 0))[0];

    return {
      totalJugadores,
      totalGastoTurnos,
      totalGastoBuffet,
      totalGastoGeneral,
      topVisitas,
      topBuffet,
    };
  }, [jugadores]);

  // Filtrado y ordenamiento de jugadores
  const jugadoresFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    let res = jugadores;
    if (q !== '') {
      res = res.filter(
        (j) =>
          j.nombre.toLowerCase().includes(q) ||
          (j.telefono && j.telefono.toLowerCase().includes(q)) ||
          (j.email && j.email.toLowerCase().includes(q)),
      );
    }

    const copia = [...res];
    if (orden === 'ranking') {
      copia.sort((a, b) => (b.gasto_total || 0) - (a.gasto_total || 0) || (b.visitas || 0) - (a.visitas || 0));
    } else if (orden === 'visitas') {
      copia.sort((a, b) => (b.visitas || 0) - (a.visitas || 0) || (b.gasto_total || 0) - (a.gasto_total || 0));
    } else if (orden === 'buffet') {
      copia.sort((a, b) => (b.gasto_buffet || 0) - (a.gasto_buffet || 0));
    } else if (orden === 'nombre') {
      copia.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    return copia;
  }, [jugadores, busqueda, orden]);

  function openNew(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(j: Jugador): void {
    setEditing(j);
    setFormOpen(true);
  }

  function requestDelete(j: Jugador): void {
    setDeleteError(null);
    setToDelete(j);
  }

  async function confirmDelete(): Promise<void> {
    if (!toDelete) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(toDelete.id);
      setToDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'No pudimos eliminar el jugador. Probá de nuevo.',
      );
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-500" />
            Jugadores y Ranking
          </h1>
          <p className="text-sm text-muted-foreground">
            Frecuencia de asistencia, consumo en turnos de pádel, buffet y ranking del club.
          </p>
        </div>
        {canEdit && (
          <Button type="button" onClick={openNew} className="shrink-0">
            <Plus className="mr-1.5 h-4 w-4" />
            Agregar jugador
          </Button>
        )}
      </header>

      {/* Tarjetas de Métricas Globales */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users className="h-4 w-4 text-primary" />
            <span>Total Jugadores</span>
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {metricasGlobales.totalJugadores}
          </div>
          <div className="text-[11px] text-muted-foreground">Registrados en el club</div>
        </div>

        <div className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Medal className="h-4 w-4 text-amber-500" />
            <span>Más Asistencias</span>
          </div>
          <div className="mt-1 text-base font-bold text-foreground truncate" title={metricasGlobales.topVisitas?.nombre}>
            {metricasGlobales.topVisitas?.nombre || '—'}
          </div>
          <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
            {metricasGlobales.topVisitas ? `${metricasGlobales.topVisitas.visitas} partidos jugados` : 'Sin datos'}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Coffee className="h-4 w-4 text-emerald-500" />
            <span>Top Buffet</span>
          </div>
          <div className="mt-1 text-base font-bold text-foreground truncate" title={metricasGlobales.topBuffet?.nombre}>
            {metricasGlobales.topBuffet?.nombre || '—'}
          </div>
          <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            {metricasGlobales.topBuffet ? fmtMoney(metricasGlobales.topBuffet.gasto_buffet) : '$0,00'}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <DollarSign className="h-4 w-4 text-primary" />
            <span>Total Recaudado</span>
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
            {fmtMoney(metricasGlobales.totalGastoGeneral)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Turnos: {fmtMoney(metricasGlobales.totalGastoTurnos)}
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Orden */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, teléfono o email…"
            className="pl-9 h-9 text-xs"
            aria-label="Buscar jugador"
          />
        </div>

        {/* Pestañas de ordenamiento */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1 text-xs">
          <button
            type="button"
            onClick={() => setOrden('ranking')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors',
              orden === 'ranking'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Trophy className="h-3.5 w-3.5 text-amber-500" />
            Ranking General
          </button>
          <button
            type="button"
            onClick={() => setOrden('visitas')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors',
              orden === 'visitas'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Users className="h-3.5 w-3.5 text-blue-500" />
            Más Asistencias
          </button>
          <button
            type="button"
            onClick={() => setOrden('buffet')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors',
              orden === 'buffet'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Coffee className="h-3.5 w-3.5 text-emerald-500" />
            Top Buffet
          </button>
          <button
            type="button"
            onClick={() => setOrden('nombre')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors',
              orden === 'nombre'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            A-Z
          </button>
        </div>
      </div>

      <JugadoresTable
        query={jugadoresQuery}
        jugadores={jugadoresFiltrados}
        busquedaActiva={busqueda.trim() !== ''}
        isAdmin={isAdmin}
        canEdit={canEdit}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      <JugadorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialValue={editing}
      />

      <Dialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) {
            setToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar jugador?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. El jugador
              {toDelete ? ` "${toDelete.nombre}"` : ''} se va a eliminar
              de forma permanente. Si tiene reservas o pagos asociados, no
              se puede borrar — usá "Desactivar" desde el formulario de
              edición en su lugar.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToDelete(null)}
              disabled={deleteMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void confirmDelete();
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface JugadoresTableProps {
  query: ReturnType<typeof useJugadores>;
  jugadores: JugadorConEstadisticas[];
  busquedaActiva: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  onEdit: (j: JugadorConEstadisticas) => void;
  onDelete: (j: JugadorConEstadisticas) => void;
}

function JugadoresTable({
  query,
  jugadores,
  busquedaActiva,
  isAdmin,
  canEdit,
  onEdit,
  onDelete,
}: JugadoresTableProps) {
  if (query.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (query.error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {query.error.message}
      </div>
    );
  }

  if (jugadores.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {busquedaActiva
            ? 'Ningún jugador coincide con la búsqueda.'
            : 'Todavía no agregaste jugadores. Cargá el primero para empezar.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Tabla (Desktop) */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3.5 py-2.5 font-semibold text-center w-12">#</th>
              <th className="px-3.5 py-2.5 font-semibold">Jugador</th>
              <th className="px-3.5 py-2.5 font-semibold text-center">Visitas</th>
              <th className="px-3.5 py-2.5 font-semibold text-right">Gasto Turnos</th>
              <th className="px-3.5 py-2.5 font-semibold text-right">Gasto Buffet</th>
              <th className="px-3.5 py-2.5 font-semibold text-right">Total Gastado</th>
              <th className="px-3.5 py-2.5 font-semibold">Categoría</th>
              <th className="px-3.5 py-2.5 font-semibold">Estado</th>
              <th className="w-1 px-3.5 py-2.5 text-right font-semibold">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jugadores.map((j, idx) => {
              const inicial = j.nombre.trim().charAt(0).toUpperCase();
              const rankPos = j.ranking || idx + 1;

              return (
                <tr
                  key={j.id}
                  className={cn(
                    'transition-colors hover:bg-muted/30',
                    !j.activo && 'bg-muted/20 opacity-70',
                  )}
                >
                  {/* Posición / Ranking */}
                  <td className="px-3.5 py-3 text-center">
                    {rankPos === 1 ? (
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-500/15 text-amber-600 font-bold text-xs" title="Top 1">
                        🥇
                      </span>
                    ) : rankPos === 2 ? (
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-300/30 text-slate-600 font-bold text-xs" title="Top 2">
                        🥈
                      </span>
                    ) : rankPos === 3 ? (
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-700/15 text-amber-700 font-bold text-xs" title="Top 3">
                        🥉
                      </span>
                    ) : (
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                        #{rankPos}
                      </span>
                    )}
                  </td>

                  {/* Nombre y Datos */}
                  <td className="px-3.5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {inicial}
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-foreground block truncate">
                          {j.nombre}
                        </span>
                        <span className="text-[11px] text-muted-foreground block truncate">
                          {j.telefono ?? j.email ?? 'Sin teléfono'}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Veces que vino / Visitas */}
                  <td className="px-3.5 py-3 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                        j.visitas > 0
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {j.visitas} {j.visitas === 1 ? 'partido' : 'partidos'}
                    </span>
                    {j.ultimo_partido && (
                      <span className="block text-[10px] text-muted-foreground mt-0.5">
                        Último: {fmtFechaCorta(j.ultimo_partido)}
                      </span>
                    )}
                  </td>

                  {/* Gasto Turnos */}
                  <td className="px-3.5 py-3 text-right tabular-nums text-foreground font-medium">
                    {fmtMoney(j.gasto_turnos || 0)}
                  </td>

                  {/* Gasto Buffet */}
                  <td className="px-3.5 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                    {fmtMoney(j.gasto_buffet || 0)}
                  </td>

                  {/* Gasto Total */}
                  <td className="px-3.5 py-3 text-right tabular-nums font-bold text-foreground">
                    {fmtMoney(j.gasto_total || 0)}
                  </td>

                  {/* Categoría / Posición */}
                  <td className="px-3.5 py-3 text-muted-foreground text-xs">
                    {j.categoria ? CATEGORIA_LABEL[j.categoria] : '—'}
                    {j.posicion ? ` · ${POSICION_LABEL[j.posicion]}` : ''}
                  </td>

                  {/* Estado */}
                  <td className="px-3.5 py-3 text-xs">
                    {j.activo ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                        Activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                        Inactivo
                      </span>
                    )}
                  </td>

                  {/* Acciones */}
                  <td className="px-3.5 py-3">
                    <div className="flex justify-end gap-1">
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(j)}
                          aria-label={`Editar ${j.nombre}`}
                          className="h-7 w-7 p-0"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {isAdmin && canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(j)}
                          aria-label={`Eliminar ${j.nombre}`}
                          className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tarjetas (Mobile) */}
      <div className="md:hidden space-y-3">
        {jugadores.map((j, idx) => {
          const rankPos = j.ranking || idx + 1;

          return (
            <div
              key={j.id}
              className={cn(
                'rounded-xl border border-border bg-card p-4 shadow-sm space-y-3 transition-colors',
                !j.activo && 'bg-muted/20 opacity-75',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-muted-foreground tabular-nums">
                    #{rankPos}
                  </span>
                  <div>
                    <h3 className="font-semibold text-sm text-foreground">
                      {j.nombre}
                    </h3>
                    <span className="text-xs text-muted-foreground block">
                      {j.telefono ?? j.email ?? 'Sin contacto'}
                    </span>
                  </div>
                </div>

                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    j.activo
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {j.activo ? 'Activo' : 'Inactivo'}
                </span>
              </div>

              {/* Métricas en Grid de 3 columnas */}
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5 text-center text-xs">
                <div>
                  <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                    Visitas
                  </span>
                  <span className="font-bold text-foreground tabular-nums">
                    {j.visitas}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                    Turnos
                  </span>
                  <span className="font-bold text-foreground tabular-nums">
                    {fmtMoney(j.gasto_turnos || 0)}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
                    Buffet
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {fmtMoney(j.gasto_buffet || 0)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-muted-foreground">
                  Gasto Total:{' '}
                  <span className="font-bold text-foreground tabular-nums">
                    {fmtMoney(j.gasto_total || 0)}
                  </span>
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {j.categoria ? CATEGORIA_LABEL[j.categoria] : ''}
                </span>
              </div>

              {/* Acciones */}
              <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-2.5">
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(j)}
                    className="h-7 text-xs"
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Editar
                  </Button>
                )}
                {isAdmin && canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(j)}
                    className="h-7 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Eliminar
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
