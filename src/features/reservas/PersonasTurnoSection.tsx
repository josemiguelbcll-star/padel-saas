import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Info,
  Plus,
  Star,
  User,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useReservaConsumos } from './hooks/useReservaConsumos';
import { useReservaPagos } from './hooks/useReservaPagos';
import { useCobrarPersonaTurno } from './hooks/useCobrarPersonaTurno';
import {
  calcularDesgloseCuenta,
  calcularSaldosPersonas,
  type DesgloseCuenta,
  type SaldoPersona,
} from './utils/cuentaTurno';
import type { EstadoReserva, MedioPago } from '@/types/database';

// ─────────────────────────────────────────────────────────────────────
// Constantes y helpers
// ─────────────────────────────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(n);
}

const MEDIOS_PAGO_LIST: readonly MedioPago[] = [
  'efectivo',
  'transferencia',
  'mp',
  'tarjeta',
  'otro',
] as const;

const MEDIO_PAGO_LABEL: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

/**
 * Inicial visible del nombre para el avatar. Solo el primer carácter en
 * mayúscula. Si la persona es anónima (sin label de nombre), retorna
 * null y el avatar renderiza un ícono User.
 */
function getInicial(label: string | null): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (trimmed === '') return null;
  return trimmed.charAt(0).toUpperCase();
}

// Tokens de color reutilizados. Los del codebase
// (--estado-pagada, --estado-senada) cumplen el rol de success/warning.
// Para variantes con opacidad, usamos inline style con hsl(var(...) / X)
// (mismo patrón validado para evitar el bug de cache de Tailwind con
// utilidades dinámicas).
const COLOR_OK = 'hsl(var(--estado-pagada))';
const COLOR_OK_BG = 'hsl(var(--estado-pagada) / 0.08)';
const COLOR_OK_BG_AVATAR = 'hsl(var(--estado-pagada) / 0.15)';
const COLOR_WARN = 'hsl(var(--estado-senada))';
const COLOR_WARN_BG = 'hsl(var(--estado-senada) / 0.08)';
const COLOR_WARN_BG_AVATAR = 'hsl(var(--estado-senada) / 0.15)';

// ─────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────

interface PersonasTurnoSectionProps {
  reservaId: number;
  montoAlquiler: number;
  fecha: string;
  estadoReserva: EstadoReserva;
}

/**
 * Sección "Personas del turno" del DetalleReservaDialog. Combina:
 *   - Paso 1b: gestión de personas (agregar/quitar/vincular ficha).
 *   - Paso 3: cálculo de la división.
 *   - Paso 4: cobro por persona con desglose alquiler/buffet.
 *
 * Lenguaje visual: cada persona es una tarjeta-fila con borde izquierdo
 * de color que comunica el estado de un vistazo:
 *   - ámbar = debe (incluido el caso pago_parcial, porque la acción
 *             pendiente es cobrar — la nota verde discreta "ya pagó $X"
 *             aclara que ya entregó algo).
 *   - verde = saldada (pagó todo).
 *
 * Una barra de progreso arriba reemplaza el texto "Cobrado X de Y";
 * el hint con el cálculo (alquiler ÷ N) está oculto detrás de un
 * toggle "¿Cómo se calcula?".
 *
 * Lógica intacta del paso 4: cobro server-side con monto_esperado,
 * detección de reserva legacy pagada, GREATEST(0, ...) para "pagó de
 * más" sin crédito.
 */
export function PersonasTurnoSection({
  reservaId,
  montoAlquiler,
  fecha,
  estadoReserva,
}: PersonasTurnoSectionProps) {
  const jugadoresQuery = useReservaJugadores(reservaId);
  const consumosQuery = useReservaConsumos(reservaId);
  const pagosQuery = useReservaPagos(reservaId);
  const agregar = useAgregarPersonaTurno();
  const actualizar = useActualizarPersonaTurno();
  const quitar = useQuitarPersonaTurno();
  const cobrar = useCobrarPersonaTurno();

  const [error, setError] = useState<string | null>(null);
  const [showAgregar, setShowAgregar] = useState(false);
  const [reloadKeyAgregar, setReloadKeyAgregar] = useState(0);
  const [vinculandoId, setVinculandoId] = useState<number | null>(null);
  const [cobrandoId, setCobrandoId] = useState<number | null>(null);
  const [showDesglose, setShowDesglose] = useState(false);

  const anyPending =
    agregar.isPending ||
    actualizar.isPending ||
    quitar.isPending ||
    cobrar.isPending;

  const personas = useMemo<ReservaJugadorConNombre[]>(
    () => jugadoresQuery.data ?? [],
    [jugadoresQuery.data],
  );
  const jugadores = useMemo(
    () => personas.filter((p) => p.tipo === 'jugador'),
    [personas],
  );
  const invitados = useMemo(
    () => personas.filter((p) => p.tipo === 'invitado'),
    [personas],
  );

  const totalConsumos = useMemo(
    () =>
      (consumosQuery.data ?? []).reduce((sum, c) => sum + c.subtotal, 0),
    [consumosQuery.data],
  );

  const desglose = useMemo<DesgloseCuenta>(
    () =>
      calcularDesgloseCuenta({
        montoAlquiler,
        cantidadJugadores: jugadores.length,
        totalConsumos,
        cantidadPersonas: personas.length,
      }),
    [montoAlquiler, jugadores.length, totalConsumos, personas.length],
  );

  const pagos = useMemo(() => pagosQuery.data ?? [], [pagosQuery.data]);

  const saldosPorPersona = useMemo<Map<number, SaldoPersona>>(() => {
    const saldos = calcularSaldosPersonas({
      personas: personas.map((p) => ({ id: p.id, tipo: p.tipo })),
      pagos: pagos.map((p) => ({
        reserva_jugador_id: p.reserva_jugador_id,
        monto_alquiler: p.monto_alquiler,
        monto_consumo: p.monto_consumo,
      })),
      desglose,
    });
    const map = new Map<number, SaldoPersona>();
    for (const s of saldos) map.set(s.reservaJugadorId, s);
    return map;
  }, [personas, pagos, desglose]);

  const totalACobrar = useMemo(() => {
    let sum = 0;
    for (const s of saldosPorPersona.values()) sum += s.parteTotal;
    return sum;
  }, [saldosPorPersona]);

  const totalCobrado = useMemo(() => {
    let sum = 0;
    for (const s of saldosPorPersona.values()) sum += s.yaPagadoTotal;
    return sum;
  }, [saldosPorPersona]);

  const personasQueDeben = useMemo(() => {
    let count = 0;
    for (const s of saldosPorPersona.values()) {
      if (s.saldo > 0) count++;
    }
    return count;
  }, [saldosPorPersona]);

  const personasQuePagaron = useMemo(() => {
    let count = 0;
    for (const s of saldosPorPersona.values()) {
      if (s.parteTotal > 0 && s.saldo === 0) count++;
    }
    return count;
  }, [saldosPorPersona]);

  const esLegacyPagada = useMemo<boolean>(() => {
    if (estadoReserva !== 'pagada') return false;
    const titular = personas.find((p) => p.es_titular);
    if (!titular) return false;
    const algunPagoNoEsDelTitular = pagos.some(
      (p) =>
        p.reserva_jugador_id !== null &&
        p.reserva_jugador_id !== titular.id,
    );
    return !algunPagoNoEsDelTitular;
  }, [estadoReserva, personas, pagos]);

  const cobrosBloqueados = estadoReserva === 'cancelada' || esLegacyPagada;

  // ─────────────────────────────────────────────────────────────────
  // Handlers — INTACTOS, sólo cambia la presentación
  // ─────────────────────────────────────────────────────────────────

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
      await agregar.mutateAsync({ reserva_id: reservaId, tipo: 'jugador' });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos agregar al jugador anónimo.',
      );
    }
  }

  async function handleAgregarInvitado(): Promise<void> {
    setError(null);
    try {
      await agregar.mutateAsync({ reserva_id: reservaId, tipo: 'invitado' });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos agregar al invitado.',
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
        err instanceof Error
          ? err.message
          : 'No pudimos quitar a la persona.',
      );
    }
  }

  async function handleConfirmarCobro(
    saldo: SaldoPersona,
    medio: MedioPago,
    obs: string | null,
  ): Promise<void> {
    setError(null);
    try {
      await cobrar.mutateAsync({
        reserva_jugador_id: saldo.reservaJugadorId,
        reserva_id: reservaId,
        fecha,
        medio_pago: medio,
        observaciones: obs,
        monto_esperado: saldo.saldo,
      });
      setCobrandoId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No pudimos registrar el cobro.',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  if (jugadoresQuery.isLoading) {
    return (
      <section className="space-y-2">
        <Label>Personas del turno</Label>
        <div className="h-20 animate-pulse rounded-md border border-border bg-muted/40" />
      </section>
    );
  }

  if (jugadoresQuery.error) {
    return (
      <section className="space-y-2">
        <Label>Personas del turno</Label>
        <p className="text-xs text-destructive" role="alert">
          {jugadoresQuery.error.message}
        </p>
      </section>
    );
  }

  const turnoSaldado =
    totalACobrar > 0 && personasQueDeben === 0 && !esLegacyPagada;

  const muestraToggleCalculo =
    !esLegacyPagada &&
    (desglose.parteAlquilerPorJugador > 0 ||
      desglose.parteConsumoPorPersona > 0);

  return (
    <section className="space-y-3">
      {/* Header + toggle del cálculo */}
      <div className="flex items-center justify-between">
        <Label>Personas del turno</Label>
        {muestraToggleCalculo && (
          <button
            type="button"
            onClick={() => setShowDesglose((v) => !v)}
            className="inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-expanded={showDesglose}
          >
            <Info className="h-3 w-3" aria-hidden="true" />
            {showDesglose ? 'Ocultar cálculo' : '¿Cómo se calcula?'}
          </button>
        )}
      </div>

      {/* Hint del cálculo (colapsable) */}
      {showDesglose && !esLegacyPagada && <DesgloseHint desglose={desglose} />}

      {/* Banner legacy */}
      {esLegacyPagada && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
          style={{ backgroundColor: 'hsl(var(--muted) / 0.4)' }}
        >
          <AlertCircle
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            Turno pagado en modelo anterior — sin desglose por persona. La
            gestión de personas (agregar/quitar/vincular) sigue disponible.
          </span>
        </div>
      )}

      {/* Barra de progreso del cobro */}
      {!esLegacyPagada && totalACobrar > 0 && (
        <BarraProgreso
          totalACobrar={totalACobrar}
          totalCobrado={totalCobrado}
          personasQuePagaron={personasQuePagaron}
          personasQueDeben={personasQueDeben}
          turnoSaldado={turnoSaldado}
        />
      )}

      {/* ── Jugadores ─────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Jugadores ({jugadores.length})
        </h4>

        {jugadores.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin jugadores cargados.</p>
        ) : (
          <ul className="space-y-2">
            {jugadores.map((j, idx) => {
              const saldo = saldosPorPersona.get(j.id);
              return (
                <JugadorCard
                  key={j.id}
                  persona={j}
                  numero={idx + 1}
                  saldo={saldo}
                  cobrosBloqueados={cobrosBloqueados}
                  vinculandoActivo={vinculandoId === j.id}
                  cobrandoActivo={cobrandoId === j.id}
                  onPedirVincular={() => {
                    setError(null);
                    setVinculandoId(j.id);
                    setCobrandoId(null);
                  }}
                  onCancelarVincular={() => setVinculandoId(null)}
                  onVincular={(v) => handleVincular(j.id, v)}
                  onPedirCobrar={() => {
                    setError(null);
                    setCobrandoId(j.id);
                    setVinculandoId(null);
                  }}
                  onCancelarCobrar={() => setCobrandoId(null)}
                  onConfirmarCobro={handleConfirmarCobro}
                  onQuitar={() => handleQuitar(j.id)}
                  disabled={anyPending}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Invitados (sólo si hay) ────────────────────────────────── */}
      {invitados.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Invitados ({invitados.length})
          </h4>
          <ul className="space-y-1.5">
            {invitados.map((inv, idx) => {
              const saldo = saldosPorPersona.get(inv.id);
              return (
                <InvitadoCard
                  key={inv.id}
                  numero={idx + 1}
                  saldo={saldo}
                  cobrosBloqueados={cobrosBloqueados}
                  cobrandoActivo={cobrandoId === inv.id}
                  onPedirCobrar={() => {
                    setError(null);
                    setCobrandoId(inv.id);
                    setVinculandoId(null);
                  }}
                  onCancelarCobrar={() => setCobrandoId(null)}
                  onConfirmarCobro={handleConfirmarCobro}
                  onQuitar={() => handleQuitar(inv.id)}
                  disabled={anyPending}
                />
              );
            })}
          </ul>
        </div>
      )}

      {/* Acciones de agregar — agrupadas y discretas */}
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
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setShowAgregar(false);
                void handleAgregarAnonimo();
              }}
              disabled={agregar.isPending}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            >
              o agregar anónimo
            </button>
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
        <div className="flex flex-wrap gap-2 rounded-md border border-dashed border-border/70 p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              setShowAgregar(true);
            }}
            disabled={anyPending}
            className="text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Jugador
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void handleAgregarInvitado();
            }}
            disabled={anyPending}
            className="text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Invitado
          </Button>
        </div>
      )}

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
// BarraProgreso — visualización del cobro del turno
// ─────────────────────────────────────────────────────────────────────

function BarraProgreso({
  totalACobrar,
  totalCobrado,
  personasQuePagaron,
  personasQueDeben,
  turnoSaldado,
}: {
  totalACobrar: number;
  totalCobrado: number;
  personasQuePagaron: number;
  personasQueDeben: number;
  turnoSaldado: boolean;
}) {
  // Clamp 0..100 — defensivo, no debería pasar de 100.
  const pct =
    totalACobrar > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((totalCobrado / totalACobrar) * 100)),
        )
      : 0;

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-card p-2.5">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Cobrado ${pct}% del turno`}
      >
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: COLOR_OK }}
        />
      </div>

      {turnoSaldado ? (
        <div
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: COLOR_OK }}
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Turno saldado —{' '}
          <span className="tabular-nums">{fmtMoney(totalCobrado)}</span>{' '}
          cobrado.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          <span className="text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">
              {fmtMoney(totalCobrado)}
            </span>{' '}
            de{' '}
            <span className="tabular-nums">{fmtMoney(totalACobrar)}</span>
          </span>
          {personasQuePagaron > 0 && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: COLOR_OK }}
            >
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              {personasQuePagaron} pagaron
            </span>
          )}
          {personasQueDeben > 0 && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: COLOR_WARN }}
            >
              <Clock className="h-3 w-3" aria-hidden="true" />
              {personasQueDeben} deben
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DesgloseHint — cálculo de las partes (sólo cuando el toggle lo abre)
// ─────────────────────────────────────────────────────────────────────

function DesgloseHint({ desglose }: { desglose: DesgloseCuenta }) {
  const muestraAlquiler = desglose.parteAlquilerPorJugador > 0;
  const muestraConsumos = desglose.parteConsumoPorPersona > 0;
  if (!muestraAlquiler && !muestraConsumos) return null;

  return (
    <div className="space-y-0.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
      {muestraAlquiler && (
        <p>
          Alquiler{' '}
          <span className="tabular-nums">
            {fmtMoney(desglose.montoAlquiler)}
          </span>{' '}
          ÷ {desglose.cantidadJugadores} ={' '}
          <span className="font-medium tabular-nums text-foreground">
            {fmtMoney(desglose.parteAlquilerPorJugador)}
          </span>{' '}
          por jugador
        </p>
      )}
      {muestraConsumos && (
        <p>
          Consumos{' '}
          <span className="tabular-nums">
            {fmtMoney(desglose.totalConsumos)}
          </span>{' '}
          ÷ {desglose.cantidadPersonas} ={' '}
          <span className="font-medium tabular-nums text-foreground">
            {fmtMoney(desglose.parteConsumoPorPersona)}
          </span>{' '}
          por persona
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PersonaAvatar — circular con inicial / tilde / ícono User
// ─────────────────────────────────────────────────────────────────────

/**
 * Avatar circular. El color refleja el estado de cobro:
 *   - saldada       → verde con ✓
 *   - debe/parcial  → ámbar con inicial (o ícono User si anónimo)
 *   - sin estado    → muted con inicial / ícono User
 */
function PersonaAvatar({
  inicial,
  estado,
  compacta,
}: {
  inicial: string | null;
  estado: 'debe' | 'pago_parcial' | 'saldada' | null;
  compacta?: boolean;
}) {
  const sizeClasses = compacta ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-sm';
  const iconClasses = compacta ? 'h-3.5 w-3.5' : 'h-4 w-4';

  if (estado === 'saldada') {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full font-semibold',
          sizeClasses,
        )}
        style={{ backgroundColor: COLOR_OK_BG_AVATAR, color: COLOR_OK }}
        aria-hidden="true"
      >
        <Check className={iconClasses} />
      </div>
    );
  }

  if (estado === 'debe' || estado === 'pago_parcial') {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full font-semibold',
          sizeClasses,
        )}
        style={{ backgroundColor: COLOR_WARN_BG_AVATAR, color: COLOR_WARN }}
        aria-hidden="true"
      >
        {inicial ?? <User className={iconClasses} />}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground',
        sizeClasses,
      )}
      aria-hidden="true"
    >
      {inicial ?? <User className={iconClasses} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// JugadorCard
// ─────────────────────────────────────────────────────────────────────

interface JugadorCardProps {
  persona: ReservaJugadorConNombre;
  numero: number;
  saldo: SaldoPersona | undefined;
  cobrosBloqueados: boolean;
  vinculandoActivo: boolean;
  cobrandoActivo: boolean;
  onPedirVincular: () => void;
  onCancelarVincular: () => void;
  onVincular: (value: JugadorSeleccionado | null) => Promise<void>;
  onPedirCobrar: () => void;
  onCancelarCobrar: () => void;
  onConfirmarCobro: (
    saldo: SaldoPersona,
    medio: MedioPago,
    obs: string | null,
  ) => Promise<void>;
  onQuitar: () => void;
  disabled: boolean;
}

function JugadorCard({
  persona,
  numero,
  saldo,
  cobrosBloqueados,
  vinculandoActivo,
  cobrandoActivo,
  onPedirVincular,
  onCancelarVincular,
  onVincular,
  onPedirCobrar,
  onCancelarCobrar,
  onConfirmarCobro,
  onQuitar,
  disabled,
}: JugadorCardProps) {
  const esTitular = persona.es_titular;
  const tieneFicha = persona.jugador_id !== null && persona.jugador?.nombre;
  const tieneNombreLibre =
    persona.jugador_id === null && persona.nombre_libre !== null;
  const label = tieneFicha
    ? (persona.jugador?.nombre ?? '—')
    : tieneNombreLibre
      ? (persona.nombre_libre ?? '—')
      : `Jugador ${numero}`;
  const esAnonimo = !tieneFicha && !tieneNombreLibre;
  const inicial = esAnonimo ? null : getInicial(label);
  const puedeAsignarNombre = !esTitular && persona.jugador_id === null;

  const estado = saldo && saldo.parteTotal > 0 ? saldo.estado : null;
  const cardStyle = computarCardStyle(estado);

  return (
    <li
      className="space-y-2 rounded-md border border-border bg-card p-2.5"
      style={cardStyle}
    >
      <div className="flex items-center gap-2.5">
        <PersonaAvatar inicial={inicial} estado={estado} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            {esTitular && (
              <Star
                className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                aria-label="Titular"
              />
            )}
            <span
              className={cn(
                'truncate text-sm font-medium text-foreground',
                esAnonimo && 'italic text-muted-foreground',
              )}
            >
              {label}
            </span>
          </div>

          <ContextoLinea
            saldo={saldo}
            puedeAsignarNombre={puedeAsignarNombre}
            asignandoActivo={vinculandoActivo}
            onPedirAsignar={onPedirVincular}
            disabled={disabled}
          />
        </div>

        <MontoEstado saldo={saldo} />

        <AccionCobrar
          saldo={saldo}
          cobrosBloqueados={cobrosBloqueados}
          cobrandoActivo={cobrandoActivo}
          disabled={disabled}
          onPedirCobrar={onPedirCobrar}
        />

        {!esTitular && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onQuitar}
            disabled={disabled}
            aria-label={`Quitar a ${label}`}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Mini-form: asignar/vincular ficha */}
      {vinculandoActivo && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-background p-2">
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

      {/* Mini-form: cobrar persona */}
      {cobrandoActivo && saldo && saldo.saldo > 0 && (
        <CobrarPersonaInline
          nombre={label}
          saldo={saldo}
          onCancelar={onCancelarCobrar}
          onConfirmar={onConfirmarCobro}
          disabled={disabled}
        />
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// InvitadoCard — más compacta (sólo pagan consumos)
// ─────────────────────────────────────────────────────────────────────

interface InvitadoCardProps {
  numero: number;
  saldo: SaldoPersona | undefined;
  cobrosBloqueados: boolean;
  cobrandoActivo: boolean;
  onPedirCobrar: () => void;
  onCancelarCobrar: () => void;
  onConfirmarCobro: (
    saldo: SaldoPersona,
    medio: MedioPago,
    obs: string | null,
  ) => Promise<void>;
  onQuitar: () => void;
  disabled: boolean;
}

function InvitadoCard({
  numero,
  saldo,
  cobrosBloqueados,
  cobrandoActivo,
  onPedirCobrar,
  onCancelarCobrar,
  onConfirmarCobro,
  onQuitar,
  disabled,
}: InvitadoCardProps) {
  const label = `Invitado ${numero}`;
  const estado = saldo && saldo.parteTotal > 0 ? saldo.estado : null;
  const cardStyle = computarCardStyle(estado);

  return (
    <li
      className="space-y-1.5 rounded-md border border-border bg-card p-2"
      style={cardStyle}
    >
      <div className="flex items-center gap-2">
        <PersonaAvatar inicial={null} estado={estado} compacta />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs italic text-muted-foreground">
            {label}
          </span>
          {saldo && saldo.estado === 'pago_parcial' && (
            <span
              className="truncate text-[10px]"
              style={{ color: COLOR_OK }}
            >
              ya pagó {fmtMoney(saldo.yaPagadoTotal)}
            </span>
          )}
        </div>

        <MontoEstado saldo={saldo} compacta />

        <AccionCobrar
          saldo={saldo}
          cobrosBloqueados={cobrosBloqueados}
          cobrandoActivo={cobrandoActivo}
          disabled={disabled}
          onPedirCobrar={onPedirCobrar}
          compacta
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onQuitar}
          disabled={disabled}
          aria-label={`Quitar ${label}`}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {cobrandoActivo && saldo && saldo.saldo > 0 && (
        <CobrarPersonaInline
          nombre={label}
          saldo={saldo}
          onCancelar={onCancelarCobrar}
          onConfirmar={onConfirmarCobro}
          disabled={disabled}
        />
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-componentes compartidos
// ─────────────────────────────────────────────────────────────────────

function computarCardStyle(
  estado: 'debe' | 'pago_parcial' | 'saldada' | null,
): React.CSSProperties {
  if (estado === 'saldada') {
    return {
      borderLeftWidth: '3px',
      borderLeftColor: COLOR_OK,
      backgroundColor: COLOR_OK_BG,
    };
  }
  if (estado === 'debe' || estado === 'pago_parcial') {
    return {
      borderLeftWidth: '3px',
      borderLeftColor: COLOR_WARN,
      backgroundColor: COLOR_WARN_BG,
    };
  }
  return {};
}

/**
 * Línea de contexto debajo del nombre del jugador. Dos casos
 * mutuamente exclusivos:
 *   - Si pago_parcial (pagó algo, debe más): "ya pagó $X" en verde
 *     discreto. UX clara — nunca parece que no pagó nada.
 *   - Si puede asignar nombre (anónimo sin ficha): link "asignar
 *     nombre" (reemplaza el botón "Vincular" anterior).
 */
function ContextoLinea({
  saldo,
  puedeAsignarNombre,
  asignandoActivo,
  onPedirAsignar,
  disabled,
}: {
  saldo: SaldoPersona | undefined;
  puedeAsignarNombre: boolean;
  asignandoActivo: boolean;
  onPedirAsignar: () => void;
  disabled: boolean;
}) {
  const yaPago = saldo?.estado === 'pago_parcial' && saldo.yaPagadoTotal > 0;

  if (yaPago && saldo) {
    return (
      <span className="text-[11px]" style={{ color: COLOR_OK }}>
        ya pagó {fmtMoney(saldo.yaPagadoTotal)}
      </span>
    );
  }

  if (puedeAsignarNombre && !asignandoActivo) {
    return (
      <button
        type="button"
        onClick={onPedirAsignar}
        disabled={disabled}
        className="self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
      >
        asignar nombre
      </button>
    );
  }

  return null;
}

/**
 * Etiqueta "debe"/"pagó" + monto grande a la derecha. 17px para
 * jugadores (legible de un vistazo), 14px para invitados (más
 * compactos porque sólo pagan consumos).
 */
function MontoEstado({
  saldo,
  compacta,
}: {
  saldo: SaldoPersona | undefined;
  compacta?: boolean;
}) {
  if (!saldo || saldo.parteTotal === 0) return null;

  const esPagado = saldo.estado === 'saldada';
  const montoVisible = esPagado ? saldo.yaPagadoTotal : saldo.saldo;
  const color = esPagado ? COLOR_OK : COLOR_WARN;
  const label = esPagado ? 'pagó' : 'debe';

  return (
    <div className="flex shrink-0 flex-col items-end leading-tight">
      <span
        className="text-[10px] font-medium uppercase tracking-wide"
        style={{ color }}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-semibold tabular-nums',
          compacta ? 'text-sm' : 'text-[17px]',
        )}
        style={{ color }}
      >
        {fmtMoney(montoVisible)}
      </span>
    </div>
  );
}

/**
 * Acción única por fila: botón "Cobrar" verde si debe; ícono tilde
 * verde si pagó. Si cobrosBloqueados (legacy o reserva cancelada),
 * tampoco se muestra el botón.
 */
function AccionCobrar({
  saldo,
  cobrosBloqueados,
  cobrandoActivo,
  disabled,
  onPedirCobrar,
  compacta,
}: {
  saldo: SaldoPersona | undefined;
  cobrosBloqueados: boolean;
  cobrandoActivo: boolean;
  disabled: boolean;
  onPedirCobrar: () => void;
  compacta?: boolean;
}) {
  if (!saldo || saldo.parteTotal === 0) return null;

  if (saldo.estado === 'saldada') {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center',
          compacta ? 'h-7 w-7' : 'h-8 w-8',
        )}
        style={{ color: COLOR_OK }}
        aria-label="Pagado"
      >
        <CheckCircle2 className="h-5 w-5" />
      </div>
    );
  }

  if (cobrosBloqueados || cobrandoActivo) return null;

  return (
    <Button
      type="button"
      size="sm"
      onClick={onPedirCobrar}
      disabled={disabled}
      className={cn(
        'shrink-0 font-medium transition-opacity hover:opacity-90',
        compacta ? 'h-7 px-2 text-[11px]' : 'h-8 px-3 text-xs',
      )}
      style={{
        backgroundColor: COLOR_OK,
        color: 'hsl(var(--estado-pagada-foreground))',
      }}
    >
      Cobrar
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CobrarPersonaInline — mini-form de cobro
// ─────────────────────────────────────────────────────────────────────

function CobrarPersonaInline({
  nombre,
  saldo,
  onCancelar,
  onConfirmar,
  disabled,
}: {
  nombre: string;
  saldo: SaldoPersona;
  onCancelar: () => void;
  onConfirmar: (
    saldo: SaldoPersona,
    medio: MedioPago,
    obs: string | null,
  ) => Promise<void>;
  disabled: boolean;
}) {
  const [medio, setMedio] = useState<MedioPago | null>('efectivo');
  const [obs, setObs] = useState('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorLocal(null);
    if (!medio) {
      setErrorLocal('Elegí un medio de pago.');
      return;
    }
    await onConfirmar(saldo, medio, obs.trim() === '' ? null : obs.trim());
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-md border border-primary/30 bg-background p-2"
      noValidate
    >
      <h5 className="text-xs font-semibold text-foreground">
        Cobrar {fmtMoney(saldo.saldo)} a {nombre}
      </h5>

      <div className="space-y-1">
        <Label className="text-xs">Medio de pago</Label>
        <div className="flex flex-wrap gap-1">
          {MEDIOS_PAGO_LIST.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMedio(m)}
              disabled={disabled}
              aria-pressed={medio === m}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                medio === m
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {MEDIO_PAGO_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Observación (opcional)</Label>
        <Input
          type="text"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          disabled={disabled}
          maxLength={500}
          placeholder="Notas internas…"
          className="h-7 text-xs"
        />
      </div>

      {errorLocal && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-1.5 text-[11px] text-destructive"
        >
          {errorLocal}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancelar}
          disabled={disabled}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={disabled}
          className="font-medium transition-opacity hover:opacity-90"
          style={{
            backgroundColor: COLOR_OK,
            color: 'hsl(var(--estado-pagada-foreground))',
          }}
        >
          Confirmar cobro
        </Button>
      </div>
    </form>
  );
}
