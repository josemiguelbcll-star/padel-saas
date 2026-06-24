import { useMemo, useState } from 'react';
import {
  Clock,
  List,
  MapPin,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  Repeat,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { useClases } from '@/features/configuracion/hooks/useClases';
import { useFranjasTurno } from '@/features/configuracion/hooks/useFranjasTurno';
import { useHorariosClub } from '@/features/configuracion/hooks/useHorariosClub';
import { useJugadores } from '@/features/reservas/hooks/useJugadores';
import { useTurnosFijos } from './hooks/useTurnosFijos';
import { CalendarioSemanalTurnosFijos } from './CalendarioSemanalTurnosFijos';
import { NuevoTurnoFijoDialog, type TurnoFijoPrefill } from './NuevoTurnoFijoDialog';
import { EditarTurnoFijoDialog } from './EditarTurnoFijoDialog';
import { CancelarTurnoFijoDialog } from './CancelarTurnoFijoDialog';
import { EliminarTurnoFijoDialog } from './EliminarTurnoFijoDialog';
import type { TurnoFijo } from '@/types/database';

const DIAS_PLURAL: Record<number, string> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábados',
  7: 'domingos',
};

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmtFecha(iso: string): string {
  return fechaFmt.format(new Date(iso + 'T00:00:00'));
}

function fmtHora(time: string): string {
  return time.slice(0, 5);
}

/**
 * Pantalla principal del módulo de Turnos Fijos. Lista de activos +
 * alta/edición/cancelación de turnos fijos.
 *
 * La proyección financiera (KPI) se agrega en la Parte 3 (hook
 * useProyeccionTurnosFijos). Por ahora KPI simple = cantidad de activos.
 */
export function TurnosFijosPage() {
  const { user } = useSession();
  const canEdit = getPermiso(user, 'reservas', 'editar');

  const turnosQuery = useTurnosFijos();
  const canchasQuery = useCanchas();
  const jugadoresQuery = useJugadores();
  const horariosQuery = useHorariosClub();
  const franjasQuery = useFranjasTurno();
  const clasesQuery = useClases();

  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [editarOpen, setEditarOpen] = useState(false);
  const [cancelarOpen, setCancelarOpen] = useState(false);
  const [eliminarOpen, setEliminarOpen] = useState(false);
  const [seleccionado, setSeleccionado] = useState<TurnoFijo | null>(null);

  // Vista del módulo + precarga del alta desde el calendario.
  const [vista, setVista] = useState<'calendario' | 'lista'>('calendario');
  const [prefillNuevo, setPrefillNuevo] = useState<TurnoFijoPrefill | null>(null);

  const canchasById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of canchasQuery.data ?? []) m.set(c.id, c.nombre);
    return m;
  }, [canchasQuery.data]);

  const jugadoresById = useMemo(() => {
    const m = new Map<number, string>();
    for (const j of jugadoresQuery.data ?? []) m.set(j.id, j.nombre);
    return m;
  }, [jugadoresQuery.data]);

  function openEditar(t: TurnoFijo): void {
    setSeleccionado(t);
    setEditarOpen(true);
  }

  function openCancelar(t: TurnoFijo): void {
    setSeleccionado(t);
    setCancelarOpen(true);
  }

  function openEliminar(t: TurnoFijo): void {
    setSeleccionado(t);
    setEliminarOpen(true);
  }

  function nombreTitularDe(t: TurnoFijo): string {
    if (t.jugador_id !== null) {
      return jugadoresById.get(t.jugador_id) ?? `Jugador #${t.jugador_id}`;
    }
    return t.nombre_libre ?? '(sin titular)';
  }

  const turnos = turnosQuery.data ?? [];

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Repeat className="h-5 w-5 text-primary" aria-hidden="true" />
            Turnos fijos
          </h2>
          <p className="text-sm text-muted-foreground">
            Reservas recurrentes con clientes habituales en la grilla de reservas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-input p-0.5 bg-muted/50">
            <Button
              type="button"
              variant={vista === 'calendario' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setVista('calendario')}
              className="h-7 px-2.5 text-xs font-medium"
            >
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Calendario
            </Button>
            <Button
              type="button"
              variant={vista === 'lista' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setVista('lista')}
              className="h-7 px-2.5 text-xs font-medium"
            >
              <List className="mr-1.5 h-3.5 w-3.5" />
              Listado ({turnos.length})
            </Button>
          </div>
          {canEdit && (
            <Button
              type="button"
              onClick={() => {
                setPrefillNuevo(null);
                setNuevoOpen(true);
              }}
              className="shrink-0"
            >
              <Plus className="h-4 w-4" />
              Nuevo turno fijo
            </Button>
          )}
        </div>
      </header>

      {/* KPI simple */}
      <div className="max-w-xs">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Turnos fijos activos
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {turnosQuery.isLoading ? '…' : turnos.length}
          </p>
        </div>
      </div>

      {/* Lista */}
      {turnosQuery.isLoading && (
        <div className="space-y-2" aria-busy="true">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-20 w-full animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {turnosQuery.isError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          No se pudieron cargar los turnos fijos. Refrescá la página.
        </div>
      )}

      {!turnosQuery.isLoading && !turnosQuery.isError && vista === 'calendario' && (
        <CalendarioSemanalTurnosFijos
          turnos={turnos}
          canchas={canchasQuery.data ?? []}
          resolverTitular={nombreTitularDe}
          horaApertura={horariosQuery.data?.hora_apertura ?? null}
          horaCierre={horariosQuery.data?.hora_cierre ?? null}
          franjas={franjasQuery.data ?? []}
          duracionDefault={horariosQuery.data?.duracion_turno_default ?? 90}
          clases={clasesQuery.data ?? []}
          onCrearEnSlot={(prefill) => {
            if (!canEdit) return;
            setPrefillNuevo(prefill);
            setNuevoOpen(true);
          }}
          onEditarTurno={openEditar}
        />
      )}

      {!turnosQuery.isLoading && !turnosQuery.isError && vista === 'lista' && turnos.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Repeat className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">No hay turnos fijos registrados.</p>
        </div>
      )}

      {!turnosQuery.isLoading && !turnosQuery.isError && vista === 'lista' && turnos.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {turnos.map((t) => {
            const canchaNombre = canchasById.get(t.cancha_id) ?? `Cancha #${t.cancha_id}`;
            const titular = nombreTitularDe(t);
            return (
              <li key={t.id} className="p-4 transition-colors hover:bg-muted/30">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">{titular}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Repeat className="h-3.5 w-3.5 text-primary" />
                        Cada {DIAS_PLURAL[t.dia_semana]} a las {fmtHora(t.hora_inicio)} ({t.duracion_min} min)
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {canchaNombre}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        Desde {fmtFecha(t.fecha_desde)}
                        {t.fecha_hasta && ` hasta ${fmtFecha(t.fecha_hasta)}`}
                      </span>
                    </div>
                    {t.observaciones && (
                      <p className="text-xs italic text-muted-foreground/80 mt-1">
                        &ldquo;{t.observaciones}&rdquo;
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openCancelar(t)}
                      >
                        <Power className="h-3.5 w-3.5" />
                        Desactivar
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEditar(t)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => openEliminar(t)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NuevoTurnoFijoDialog
        open={nuevoOpen}
        onOpenChange={setNuevoOpen}
        prefill={prefillNuevo}
      />
      <EditarTurnoFijoDialog
        open={editarOpen}
        onOpenChange={setEditarOpen}
        turno={seleccionado}
      />
      <CancelarTurnoFijoDialog
        open={cancelarOpen}
        onOpenChange={setCancelarOpen}
        turno={seleccionado}
      />
      <EliminarTurnoFijoDialog
        open={eliminarOpen}
        onOpenChange={setEditarOpen}
        turno={seleccionado}
        titularNombre={seleccionado ? nombreTitularDe(seleccionado) : undefined}
      />
    </section>
  );
}
