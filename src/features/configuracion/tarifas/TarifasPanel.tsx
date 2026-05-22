import { useMemo, useState } from 'react';
import {
  CalendarClock,
  Clock4,
  HelpCircle,
  History,
  Pencil,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { CambiarPrecioDialog } from './CambiarPrecioDialog';
import { EditarMetadataDialog } from './EditarMetadataDialog';
import { HistorialPrecioDialog } from './HistorialPrecioDialog';
import { NuevaFranjaDialog } from './NuevaFranjaDialog';
import { agruparPorLinaje, type TarifaLinaje } from './tarifaLineage';
import type { TarifasModuleConfig } from './tarifasModuleConfig';

const DIAS_ABBR: Record<number, string> = {
  1: 'LUN',
  2: 'MAR',
  3: 'MIE',
  4: 'JUE',
  5: 'VIE',
  6: 'SAB',
  7: 'DOM',
};

const PRIORIDAD_TOOLTIP =
  'Cuando dos franjas aplican al mismo horario, gana la de mayor número.';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fechaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function fmtFecha(iso: string): string {
  return fechaFmt.format(new Date(iso + 'T00:00:00'));
}

function formatHora(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

function formatDias(dias: number[] | null): string {
  if (!dias || dias.length === 0) return '';
  return dias.map((d) => DIAS_ABBR[d] ?? '').filter(Boolean).join(' ');
}

function describeAplicacion(l: TarifaLinaje): string {
  const partes: string[] = [];
  const dias = formatDias(l.dias_semana);
  if (dias) partes.push(dias);

  const desde = formatHora(l.desde_hora);
  const hasta = formatHora(l.hasta_hora);
  if (desde && hasta) partes.push(`${desde}–${hasta}`);

  return partes.length === 0 ? 'Todo horario, todos los días' : partes.join(' · ');
}

interface TarifasPanelProps {
  config: TarifasModuleConfig;
}

/**
 * Panel reutilizable de tarifas (turnos o clases). Recibe un `config`
 * que define qué hooks usar (useList / useCrear / useCambiarPrecio /
 * useActualizarMetadata) — el JSX y la UX son idénticos para los dos
 * módulos.
 *
 * Vista organizada por LINAJE (franja a lo largo del tiempo). Cada
 * card muestra el precio VIGENTE HOY + un aviso si hay aumento
 * programado a futuro. 4 acciones por linaje:
 *   - Cambiar precio (versiona: cierra actual + crea nueva).
 *   - Editar franja (metadata in-place, afecta todas las versiones).
 *   - Ver historial (timeline de precios).
 *   - Nueva franja (alta de un linaje nuevo).
 *
 * Sin "borrar": el flow es desactivar (toggle dentro de "Editar franja").
 * El histórico de reservas no se ve afectado por nada de esto — cada
 * reserva tiene su `monto_total` snapshot al momento de crearse.
 */
export function TarifasPanel({ config }: TarifasPanelProps) {
  const { user } = useSession();
  const isAdmin = user?.rol === 'admin';

  const query = config.useList();

  const linajes = useMemo<TarifaLinaje[]>(
    () => agruparPorLinaje(query.data ?? []),
    [query.data],
  );

  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [cambiarPrecioOpen, setCambiarPrecioOpen] = useState(false);
  const [editarMetadataOpen, setEditarMetadataOpen] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);
  const [seleccionado, setSeleccionado] = useState<TarifaLinaje | null>(null);

  function openCambiarPrecio(l: TarifaLinaje): void {
    setSeleccionado(l);
    setCambiarPrecioOpen(true);
  }

  function openEditarMetadata(l: TarifaLinaje): void {
    setSeleccionado(l);
    setEditarMetadataOpen(true);
  }

  function openHistorial(l: TarifaLinaje): void {
    setSeleccionado(l);
    setHistorialOpen(true);
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Tarifas
          </h2>
          <p className="text-sm text-muted-foreground">
            Cada franja muestra su precio vigente hoy. Cambiar el precio
            cierra la versión actual y crea una nueva — el historial queda
            guardado y las reservas cobradas no se alteran.
          </p>
        </div>
        {isAdmin && (
          <Button type="button" onClick={() => setNuevaOpen(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            Nueva franja
          </Button>
        )}
      </header>

      {query.isLoading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {query.error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {query.error.message}
        </div>
      )}

      {query.data && linajes.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? 'Todavía no tenés franjas configuradas. Agregá la primera — podés tener una única que aplique a todo, o varias por horario.'
              : 'El administrador todavía no configuró tarifas para el club.'}
          </p>
        </div>
      )}

      {linajes.length > 0 && (
        <div className="space-y-3">
          {linajes.map((l) => (
            <LinajeCard
              key={l.lineage_id}
              linaje={l}
              isAdmin={isAdmin}
              onCambiarPrecio={() => openCambiarPrecio(l)}
              onEditarMetadata={() => openEditarMetadata(l)}
              onHistorial={() => openHistorial(l)}
            />
          ))}
        </div>
      )}

      <NuevaFranjaDialog
        open={nuevaOpen}
        onOpenChange={setNuevaOpen}
        useCrear={config.useCrear}
      />
      <CambiarPrecioDialog
        open={cambiarPrecioOpen}
        onOpenChange={setCambiarPrecioOpen}
        linaje={seleccionado}
        useCambiarPrecio={config.useCambiarPrecio}
      />
      <EditarMetadataDialog
        open={editarMetadataOpen}
        onOpenChange={setEditarMetadataOpen}
        linaje={seleccionado}
        useActualizarMetadata={config.useActualizarMetadata}
      />
      <HistorialPrecioDialog
        open={historialOpen}
        onOpenChange={setHistorialOpen}
        linaje={seleccionado}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LinajeCard
// ─────────────────────────────────────────────────────────────────────

interface LinajeCardProps {
  linaje: TarifaLinaje;
  isAdmin: boolean;
  onCambiarPrecio: () => void;
  onEditarMetadata: () => void;
  onHistorial: () => void;
}

function LinajeCard({
  linaje,
  isAdmin,
  onCambiarPrecio,
  onEditarMetadata,
  onHistorial,
}: LinajeCardProps) {
  const aplicacion = describeAplicacion(linaje);
  const cantVersiones = linaje.versiones.length;

  return (
    <article
      className={cn(
        'rounded-lg border bg-card transition-colors',
        !linaje.activa && 'opacity-60',
        linaje.activa ? 'border-border' : 'border-dashed border-border',
      )}
    >
      <div className="space-y-3 p-4">
        {/* Header: nombre + estado + precio vigente */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">
                {linaje.nombre}
              </h3>
              {!linaje.activa && (
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Inactiva
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {aplicacion} ·{' '}
              <span
                className="inline-flex items-center gap-0.5"
                title={PRIORIDAD_TOOLTIP}
              >
                prio {linaje.prioridad}
                <HelpCircle className="h-3 w-3" aria-hidden="true" />
              </span>
            </p>
          </div>

          {/* Precio vigente */}
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Vigente hoy
            </p>
            {linaje.vigenteHoy ? (
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {currencyFmt.format(linaje.vigenteHoy.monto)}
              </p>
            ) : (
              <p className="text-sm font-medium text-muted-foreground">
                Sin precio vigente
              </p>
            )}
          </div>
        </div>

        {/* Aviso de aumento programado */}
        {linaje.proximoAumento && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
            <CalendarClock
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p>
              Cambio programado:{' '}
              <strong className="font-semibold tabular-nums text-foreground">
                {currencyFmt.format(linaje.proximoAumento.monto)}
              </strong>{' '}
              desde el{' '}
              <strong className="font-semibold">
                {fmtFecha(linaje.proximoAumento.vigente_desde)}
              </strong>
              .
            </p>
          </div>
        )}

        {/* Acciones */}
        {isAdmin && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onCambiarPrecio}
              disabled={!linaje.vigenteHoy}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Cambiar precio
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onEditarMetadata}>
              <Pencil className="h-3.5 w-3.5" />
              Editar franja
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onHistorial}>
              <History className="h-3.5 w-3.5" />
              Ver historial ({cantVersiones})
            </Button>
          </div>
        )}
      </div>

      {/* Footer minimalista con metadata de vigencia actual */}
      {linaje.vigenteHoy && (
        <div className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <Clock4 className="h-3 w-3" aria-hidden="true" />
          Vigente desde {fmtFecha(linaje.vigenteHoy.vigente_desde)}
        </div>
      )}
    </article>
  );
}
