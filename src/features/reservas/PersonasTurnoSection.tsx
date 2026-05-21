import { useMemo, useState } from 'react';
import { Link2, Plus, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  JugadorAutocomplete,
  type JugadorSeleccionado,
} from './JugadorAutocomplete';
import {
  useActualizarPersonaTurno,
  useAgregarPersonaTurno,
  useQuitarPersonaTurno,
  useReservaJugadores,
  type ReservaJugadorConNombre,
} from './hooks/useReservaJugadores';

interface PersonasTurnoSectionProps {
  reservaId: number;
}

/**
 * Sección "Personas del turno" del DetalleReservaDialog (paso 1b del
 * módulo cuenta del turno). Reemplaza al `JugadoresList` display-only
 * anterior.
 *
 * Dos sub-secciones:
 *
 *   - Jugadores: titular (read-only, ★), después el resto en orden de
 *     inserción. Cada fila no-titular puede ser anónima ("Jugador N"),
 *     nombre_libre ("Pedro (sin ficha)"), o con ficha. Acciones: ×
 *     (quitar), y "Vincular" (autocomplete inline) si la fila es anónima
 *     o nombre_libre. Botones "+ Agregar con nombre" / "+ Agregar
 *     anónimo" para sumar más.
 *
 *   - Invitados: contador `[-] N [+]` global. [+] inserta una fila
 *     tipo='invitado' (anónima por el CHECK del 0012). [-] borra el de
 *     id máximo (último agregado). Lista textual de referencia
 *     "Invitado 1, Invitado 2…" debajo.
 *
 * Toda mutación pasa por los 3 hooks del bloque 2; los IDs en DB son
 * estables (los pagos del paso 4 atan por id, no por la numeración
 * visual).
 */
export function PersonasTurnoSection({
  reservaId,
}: PersonasTurnoSectionProps) {
  const query = useReservaJugadores(reservaId);
  const agregar = useAgregarPersonaTurno();
  const actualizar = useActualizarPersonaTurno();
  const quitar = useQuitarPersonaTurno();

  // Un solo banner de error para toda la sección (la última mutation
  // que falló). Suficiente: las acciones son cortas e independientes,
  // no se solapan visualmente con info crítica.
  const [error, setError] = useState<string | null>(null);

  // Toggle del autocomplete inline para "+ Agregar con nombre".
  const [showAgregar, setShowAgregar] = useState(false);
  // Cada vez que agregamos via autocomplete, incrementamos esto: el
  // autocomplete se remount y arranca vacío para sumar el siguiente.
  const [reloadKeyAgregar, setReloadKeyAgregar] = useState(0);

  // Fila actualmente en modo "vincular ficha" (autocomplete inline).
  // null = nadie.
  const [vinculandoId, setVinculandoId] = useState<number | null>(null);

  const anyPending =
    agregar.isPending || actualizar.isPending || quitar.isPending;

  // Particionar la data por tipo. La query ya viene ordenada por
  // (es_titular DESC, id ASC), así que los jugadores tienen el titular
  // primero y el resto en orden de inserción; los invitados también.
  const personas = useMemo<ReservaJugadorConNombre[]>(
    () => query.data ?? [],
    [query.data],
  );
  const jugadores = useMemo(
    () => personas.filter((p) => p.tipo === 'jugador'),
    [personas],
  );
  const invitados = useMemo(
    () => personas.filter((p) => p.tipo === 'invitado'),
    [personas],
  );

  async function handleAgregarPorAutocomplete(
    value: JugadorSeleccionado | null,
  ): Promise<void> {
    if (!value) return;
    setError(null);
    try {
      if (value.kind === 'jugador') {
        await agregar.mutateAsync({
          reserva_id: reservaId,
          tipo: 'jugador',
          jugador_id: value.jugadorId,
        });
      } else {
        await agregar.mutateAsync({
          reserva_id: reservaId,
          tipo: 'jugador',
          nombre_libre: value.nombre,
        });
      }
      // El autocomplete queda visible para sumar el siguiente; lo
      // remount con un nuevo key para que arranque limpio.
      setReloadKeyAgregar((k) => k + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos agregar al jugador.',
      );
    }
  }

  async function handleAgregarAnonimo(): Promise<void> {
    setError(null);
    try {
      await agregar.mutateAsync({
        reserva_id: reservaId,
        tipo: 'jugador',
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos agregar al jugador anónimo.',
      );
    }
  }

  async function handleVincular(
    rowId: number,
    value: JugadorSeleccionado | null,
  ): Promise<void> {
    if (!value || value.kind !== 'jugador') return;
    setError(null);
    try {
      await actualizar.mutateAsync({
        id: rowId,
        reserva_id: reservaId,
        changes: { jugador_id: value.jugadorId, nombre_libre: null },
      });
      setVinculandoId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos vincular la ficha.',
      );
    }
  }

  async function handleQuitar(rowId: number): Promise<void> {
    setError(null);
    try {
      await quitar.mutateAsync({ id: rowId, reserva_id: reservaId });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos quitar a la persona.',
      );
    }
  }

  async function handleAgregarInvitado(): Promise<void> {
    setError(null);
    try {
      await agregar.mutateAsync({
        reserva_id: reservaId,
        tipo: 'invitado',
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos agregar al invitado.',
      );
    }
  }

  async function handleQuitarUltimoInvitado(): Promise<void> {
    // El último agregado es el de id máximo. La lista viene ordenada
    // por id ASC, así que el último del array es el último agregado.
    const ultimo = invitados[invitados.length - 1];
    if (!ultimo) return;
    setError(null);
    try {
      await quitar.mutateAsync({ id: ultimo.id, reserva_id: reservaId });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos quitar al invitado.',
      );
    }
  }

  if (query.isLoading) {
    return (
      <section className="space-y-2">
        <Label>Personas del turno</Label>
        <div className="h-20 animate-pulse rounded-md border border-border bg-muted/40" />
      </section>
    );
  }

  if (query.error) {
    return (
      <section className="space-y-2">
        <Label>Personas del turno</Label>
        <p className="text-xs text-destructive" role="alert">
          {query.error.message}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <Label>Personas del turno</Label>

      {/* ── Jugadores ─────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Jugadores ({jugadores.length})
        </h4>

        {jugadores.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin jugadores cargados.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {jugadores.map((j, idx) => (
              <JugadorRow
                key={j.id}
                persona={j}
                /* Si es titular, idx=0 → "Jugador 1" implícito por la ★
                   (no se muestra el número). Para los demás, el numero
                   ordinal arranca en 2 y crece por orden de aparición. */
                numero={idx + 1}
                vinculandoActivo={vinculandoId === j.id}
                onPedirVincular={() => {
                  setError(null);
                  setVinculandoId(j.id);
                }}
                onCancelarVincular={() => setVinculandoId(null)}
                onVincular={(v) => handleVincular(j.id, v)}
                onQuitar={() => handleQuitar(j.id)}
                disabled={anyPending}
              />
            ))}
          </ul>
        )}

        {/* Agregar jugador */}
        {showAgregar ? (
          <div className="space-y-2 rounded-md border border-primary/30 bg-background p-2">
            <Label
              htmlFor={`agregar-jugador-${reservaId}`}
              className="text-xs"
            >
              Buscar ficha o tipear un nombre
            </Label>
            <JugadorAutocomplete
              key={`agregar-${reloadKeyAgregar}`}
              id={`agregar-jugador-${reservaId}`}
              value={null}
              onChange={(v) => {
                void handleAgregarPorAutocomplete(v);
              }}
              permitirNombreLibre
              autoFocus
              disabled={agregar.isPending}
              placeholder="Pedro, María… o elegí ficha"
              aria-label="Agregar jugador con nombre o ficha"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAgregar(false)}
                disabled={agregar.isPending}
              >
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setShowAgregar(true);
              }}
              disabled={anyPending}
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar con nombre
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleAgregarAnonimo();
              }}
              disabled={anyPending}
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar anónimo
            </Button>
          </div>
        )}
      </div>

      {/* ── Invitados ─────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Invitados ({invitados.length})
          </h4>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                void handleQuitarUltimoInvitado();
              }}
              disabled={anyPending || invitados.length === 0}
              aria-label="Quitar último invitado"
              className="h-7 w-7"
            >
              <span className="text-base leading-none">−</span>
            </Button>
            <span className="w-6 text-center text-sm font-medium tabular-nums">
              {invitados.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => {
                void handleAgregarInvitado();
              }}
              disabled={anyPending}
              aria-label="Agregar invitado"
              className="h-7 w-7"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {invitados.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin invitados. Sumá los que solo consumen sin jugar.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {invitados.map((_, i) => `Invitado ${i + 1}`).join(', ')}
          </p>
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
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// JugadorRow
// ─────────────────────────────────────────────────────────────────────

interface JugadorRowProps {
  persona: ReservaJugadorConNombre;
  /** Ordinal de 1 en adelante (1 = titular, 2 = segundo jugador, …). */
  numero: number;
  vinculandoActivo: boolean;
  onPedirVincular: () => void;
  onCancelarVincular: () => void;
  onVincular: (value: JugadorSeleccionado | null) => Promise<void>;
  onQuitar: () => void;
  disabled: boolean;
}

function JugadorRow({
  persona,
  numero,
  vinculandoActivo,
  onPedirVincular,
  onCancelarVincular,
  onVincular,
  onQuitar,
  disabled,
}: JugadorRowProps) {
  const esTitular = persona.es_titular;
  const tieneFicha = persona.jugador_id !== null && persona.jugador?.nombre;
  const tieneNombreLibre =
    persona.jugador_id === null && persona.nombre_libre !== null;

  // Etiqueta visible:
  //   - Con ficha: nombre del jugador joineado.
  //   - Con nombre libre: el nombre tipeado.
  //   - Anónimo: "Jugador N".
  const label = tieneFicha
    ? (persona.jugador?.nombre ?? '—')
    : tieneNombreLibre
      ? (persona.nombre_libre ?? '—')
      : `Jugador ${numero}`;

  // "Vincular" tiene sentido solo si la fila NO tiene ficha (anónima o
  // sólo nombre libre). Las filas con ficha ya están vinculadas.
  const puedeVincular = !esTitular && persona.jugador_id === null;

  return (
    <li className="space-y-1.5">
      <div className="flex items-center gap-2">
        {esTitular ? (
          <Star
            className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
            aria-label="Titular"
          />
        ) : (
          <span
            className="inline-block h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
        )}
        <span
          className={cn(
            'flex-1 truncate text-foreground',
            !tieneFicha && !tieneNombreLibre && 'italic text-muted-foreground',
          )}
        >
          {label}
        </span>
        {tieneNombreLibre && (
          <span className="shrink-0 text-xs text-muted-foreground">
            (sin ficha)
          </span>
        )}
        {puedeVincular && !vinculandoActivo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPedirVincular}
            disabled={disabled}
            className="h-7 px-2 text-xs"
            aria-label={`Vincular ficha a ${label}`}
          >
            <Link2 className="h-3 w-3" />
            Vincular
          </Button>
        )}
        {!esTitular && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onQuitar}
            disabled={disabled}
            aria-label={`Quitar a ${label}`}
            className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {vinculandoActivo && (
        <div className="ml-5 space-y-2 rounded-md border border-primary/30 bg-background p-2">
          <Label
            htmlFor={`vincular-${persona.id}`}
            className="text-xs"
          >
            Buscar ficha existente
          </Label>
          <JugadorAutocomplete
            id={`vincular-${persona.id}`}
            value={null}
            onChange={(v) => {
              void onVincular(v);
            }}
            // No permitimos crear ficha desde acá ni nombre libre: el
            // sentido de "Vincular" es promover una fila anónima a una
            // ficha existente del catálogo. Si la persona no tiene ficha
            // todavía, el vendedor la crea desde Jugadores o desde el
            // autocomplete de "Agregar con nombre" (que sí permite libre).
            permitirNombreLibre={false}
            autoFocus
            disabled={disabled}
            placeholder="Empezá a escribir…"
            aria-label="Buscar ficha para vincular"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelarVincular}
              disabled={disabled}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
