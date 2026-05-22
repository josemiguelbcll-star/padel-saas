import { useMemo, useState } from 'react';
import {
  CalendarPlus,
  Clock,
  MapPin,
  Pencil,
  Plus,
  Power,
  Repeat,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { useJugadores } from '@/features/reservas/hooks/useJugadores';
import { useMaterializarTurnosFijos, useTurnosFijos } from './hooks/useTurnosFijos';
import { NuevoTurnoFijoDialog } from './NuevoTurnoFijoDialog';
import { EditarTurnoFijoDialog } from './EditarTurnoFijoDialog';
import { CancelarTurnoFijoDialog } from './CancelarTurnoFijoDialog';
import { ResultadoMaterializacionDialog } from './ResultadoMaterializacionDialog';
import type { ResultadoMaterializacion, TurnoFijo } from '@/types/database';

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

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Pantalla principal del módulo de Turnos Fijos. Lista de activos +
 * botón "Generar próximas 4 semanas" + alta/edición/cancelación de
 * turnos fijos.
 *
 * La proyección financiera (KPI) se agrega en la Parte 3 (hook
 * useProyeccionTurnosFijos). Por ahora KPI simple = cantidad de activos.
 */
export function TurnosFijosPage() {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const turnosQuery = useTurnosFijos();
  const canchasQuery = useCanchas();
  const jugadoresQuery = useJugadores();
  const materializar = useMaterializarTurnosFijos();

  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [editarOpen, setEditarOpen] = useState(false);
  const [cancelarOpen, setCancelarOpen] = useState(false);
  const [seleccionado, setSeleccionado] = useState<TurnoFijo | null>(null);

  const [resultadoMat, setResultadoMat] = useState<ResultadoMaterializacion | null>(
    null,
  );
  const [rangoMatLabel, setRangoMatLabel] = useState('');
  const [resultadoOpen, setResultadoOpen] = useState(false);

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

  async function handleMaterializar(): Promise<void> {
    const desde = todayISO();
    const hasta = addDaysISO(desde, 28); // 4 semanas
    try {
      const r = await materializar.mutateAsync({
        fecha_desde: desde,
        fecha_hasta: hasta,
      });
      setResultadoMat(r);
      setRangoMatLabel(`${fmtFecha(desde)} a ${fmtFecha(hasta)}`);
      setResultadoOpen(true);
    } catch (err) {
      // Errores ya mapeados a castellano por el hook. Los mostramos en alert.
      alert(err instanceof Error ? err.message : 'No pudimos materializar.');
    }
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
            Reservas recurrentes con clientes habituales. Materializá las
            próximas semanas para que aparezcan en la grilla de reservas.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={() => setNuevoOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            Nuevo turno fijo
          </Button>
        )}
      </header>

      {/* KPI simple — la proyección $ se suma en Parte 3 */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Turnos fijos activos
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {turnosQuery.isLoading ? '…' : turnos.length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Generación de reservas
          </p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Crea las reservas concretas a partir de los turnos fijos
              activos. Idempotente — re-ejecutar no duplica.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleMaterializar}
              disabled={materializar.isPending || turnos.length === 0}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              {materializar.isPending ? 'Generando…' : 'Próximas 4 semanas'}
            </Button>
          </div>
        </div>
      </div>

      {/* Lista */}
      {turnosQuery.isLoading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {turnosQuery.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {turnosQuery.error.message}
        </div>
      )}

      {turnosQuery.data && turnos.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <Repeat className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">
            {isAdmin
              ? 'Todavía no cargaste turnos fijos. Agregá el primero — son la base de la ocupación recurrente del club.'
              : 'El administrador todavía no configuró turnos fijos.'}
          </p>
        </div>
      )}

      {turnos.length > 0 && (
        <ul className="space-y-2">
          {turnos.map((t) => {
            const nombreTitular =
              t.jugador_id !== null
                ? jugadoresById.get(t.jugador_id) ?? `Jugador #${t.jugador_id}`
                : t.nombre_libre ?? '(sin titular)';
            const canchaNombre = canchasById.get(t.cancha_id) ?? `Cancha #${t.cancha_id}`;

            return (
              <li
                key={t.id}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" aria-hidden="true" />
                      <span className="text-base font-semibold text-foreground">
                        {nombreTitular}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        Todos los <strong className="font-medium text-foreground">{DIAS_PLURAL[t.dia_semana]}</strong>{' '}
                        a las <strong className="font-medium text-foreground">{fmtHora(t.hora_inicio)}</strong>
                        {' · '}{t.duracion_min} min
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" aria-hidden="true" />
                        {canchaNombre}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Vigente desde {fmtFecha(t.fecha_desde)}
                      {t.fecha_hasta ? ` · hasta ${fmtFecha(t.fecha_hasta)}` : ' · indefinido'}
                    </p>
                    {t.observaciones && (
                      <p className="text-[11px] italic text-muted-foreground">
                        {t.observaciones}
                      </p>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openEditar(t)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => openCancelar(t)}
                      >
                        <Power className="h-3.5 w-3.5" />
                        Desactivar
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NuevoTurnoFijoDialog open={nuevoOpen} onOpenChange={setNuevoOpen} />
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
      <ResultadoMaterializacionDialog
        open={resultadoOpen}
        onOpenChange={setResultadoOpen}
        resultado={resultadoMat}
        rangoLabel={rangoMatLabel}
      />
    </section>
  );
}
