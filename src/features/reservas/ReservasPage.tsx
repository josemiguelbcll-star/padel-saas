import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, LayoutGrid } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '@/features/auth';
import { getPermiso } from '@/lib/permisos';
import type {
  Cancha,
  ClaseCobro,
  EstadoOperativo,
  FranjaTurno,
  ReservaOperativa,
} from '@/types/database';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import {
  useClases,
  type ClaseConProfesor,
} from '@/features/configuracion/hooks/useClases';
import { useFranjasTurno } from '@/features/configuracion/hooks/useFranjasTurno';
import { useHorariosClub } from '@/features/configuracion/hooks/useHorariosClub';
import { DetalleClaseDialog } from './DetalleClaseDialog';
import { DetalleReservaDialog } from './DetalleReservaDialog';
import { GrillaDia } from './GrillaDia';
import { NavegacionFecha } from './NavegacionFecha';
import {
  NuevaReservaDialog,
  type NuevoReservaSlot,
} from './NuevaReservaDialog';
import { useCobrosDelDia } from './hooks/useCobrosDelDia';
import {
  useReservasDelDia,
  type ReservaConTitular,
} from './hooks/useReservasDelDia';
import { useActividadDelDia } from './hooks/useActividadDelDia';
import { useTurnosAbiertosViejos } from './hooks/useTurnosAbiertosViejos';
import {
  derivarEstadoOperativo,
  ESTADO_OPERATIVO_LABEL,
  estadoOperativoColorVar,
  type InfoReservaVisual,
} from './utils/derivarEstadoOperativo';
import {
  diaSemanaDe,
  fechaHoy,
  formatearFechaAmigable,
} from './utils/fechaUtils';
import { formatearHora, normalizarHora } from './utils/horaUtils';

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function fechaDesdeUrl(raw: string | null): string {
  if (raw && FECHA_REGEX.test(raw)) return raw;
  return fechaHoy();
}

/**
 * Pantalla principal del módulo Reservas: grilla del día con navegación
 * de fecha. Sólo vista del día (semana/mes vienen más adelante).
 *
 * La fecha vive en query params (`?fecha=YYYY-MM-DD`) para permitir
 * deep-linking y que el botón "atrás" del browser navegue entre días.
 *
 * Estados que cubre:
 *   - Club sin horarios configurados → banner con link a Configuración.
 *   - Club sin canchas activas → banner con link a Configuración.
 *   - Cargando → skeleton.
 *   - Todo OK → GrillaDia.
 */
export function ReservasPage() {
  const { user: yo } = useSession();
  const canEdit = getPermiso(yo, 'reservas', 'editar');

  const [searchParams, setSearchParams] = useSearchParams();
  const fecha = fechaDesdeUrl(searchParams.get('fecha'));

  function handleFechaChange(nuevaFecha: string): void {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('fecha', nuevaFecha);
        return next;
      },
      { replace: true },
    );
  }

  const horariosQuery = useHorariosClub();
  const canchasQuery = useCanchas();
  const reservasQuery = useReservasDelDia(fecha);
  const clasesQuery = useClases();
  const cobrosQuery = useCobrosDelDia(fecha);
  // Franjas de duración. Si falla/está vacío, la grilla cae al fallback
  // (duracion_turno_default) — no bloqueamos el render por ellas.
  const franjasQuery = useFranjasTurno();
  // Actividad del día (qué reservas tienen consumo / pago) para derivar el
  // estado operativo sin N+1. Alarma cross-día de turnos viejos sin cerrar.
  const actividadQuery = useActividadDelDia(fecha);
  const turnosViejosQuery = useTurnosAbiertosViejos();

  const canchasActivas = useMemo(
    () => (canchasQuery.data ?? []).filter((c) => c.activa),
    [canchasQuery.data],
  );

  // Filtramos clases activas que aplican al día de la fecha mostrada.
  // Esto es el equivalente del "filter by weekday" de la grilla — lo
  // hacemos acá para que GrillaDia reciba ya el set listo para render.
  const clasesDelDia = useMemo(() => {
    const weekday = diaSemanaDe(fecha);
    return (clasesQuery.data ?? []).filter(
      (c) => c.activa && c.dias_semana.includes(weekday),
    );
  }, [clasesQuery.data, fecha]);

  // Indexamos los cobros por clase_id. La fecha es implícita (= la del
  // día mostrado, que es el filtro de la query). Una ocurrencia puede
  // tener 0/1/N pagos (desde la 0008), así que cada entrada es una lista.
  // Para el bloque de la grilla alcanza con `list.length > 0`; el dialog
  // recibe la lista completa para mostrar el historial.
  const cobrosPorClase = useMemo(() => {
    const m = new Map<number, ClaseCobro[]>();
    for (const c of cobrosQuery.data ?? []) {
      const list = m.get(c.clase_id);
      if (list) list.push(c);
      else m.set(c.clase_id, [c]);
    }
    return m;
  }, [cobrosQuery.data]);

  // Info visual por reserva del día (estado operativo + flags de actividad).
  // Espejo de v_reservas_operativas; se recalcula con `now` en cada render.
  const infoReservas = useMemo(() => {
    const now = new Date();
    const idsConsumo = actividadQuery.data?.idsConConsumo ?? new Set<number>();
    const idsPago = actividadQuery.data?.idsConPago ?? new Set<number>();
    const m = new Map<number, InfoReservaVisual>();
    for (const r of reservasQuery.data ?? []) {
      const tieneConsumo = idsConsumo.has(r.id);
      const tienePago = idsPago.has(r.id);
      const estado = derivarEstadoOperativo(
        {
          estado: r.estado,
          cerrado_en: r.cerrado_en,
          fecha: r.fecha,
          hora_inicio: r.hora_inicio,
          tieneConsumo,
          tienePago,
        },
        now,
      );
      m.set(r.id, { estado, tieneConsumo, tienePago });
    }
    return m;
  }, [reservasQuery.data, actividadQuery.data]);

  // Conteo del día por estado operativo (header).
  const conteo = useMemo(() => {
    const c = { reservado: 0, abierto: 0, cerrado: 0, cancelado: 0 };
    for (const info of infoReservas.values()) c[info.estado] += 1;
    return c;
  }, [infoReservas]);

  // Estado del modal de nueva reserva.
  const [nuevoSlot, setNuevoSlot] = useState<NuevoReservaSlot | null>(null);

  // Estado del modal de detalle: guarda reserva + cancha porque el dialog
  // necesita el nombre de la cancha en el header y la cancha no viene en
  // el join de useReservasDelDia (que sólo joinea jugador titular).
  const [selectedDetalle, setSelectedDetalle] = useState<{
    reserva: ReservaConTitular;
    cancha: Cancha;
  } | null>(null);

  // Estado del modal de detalle de clase: guarda clase + cancha + fecha +
  // lista de pagos iniciales (snapshot del momento del click). El dialog
  // tiene state local propio para reflejar agregar/borrar pagos sin
  // esperar a que cierre y se reabra.
  const [selectedClase, setSelectedClase] = useState<{
    clase: ClaseConProfesor;
    cancha: Cancha;
    fecha: string;
    pagosIniciales: ClaseCobro[];
  } | null>(null);

  function handleSlotClick(
    canchaId: number,
    hora: string,
    duracionesPermitidas: number[],
  ): void {
    if (!canEdit) {
      alert('No tenés permisos para registrar reservas.');
      return;
    }
    const cancha = canchasActivas.find((c) => c.id === canchaId);
    if (!cancha) return;
    setNuevoSlot({
      cancha,
      fecha,
      hora: normalizarHora(hora),
      duracionesPermitidas,
    });
  }

  function handleReservaClick(reserva: ReservaConTitular): void {
    const cancha = canchasActivas.find((c) => c.id === reserva.cancha_id);
    if (!cancha) return;
    setSelectedDetalle({ reserva, cancha });
  }

  function handleClaseClick(clase: ClaseConProfesor): void {
    const cancha = canchasActivas.find((c) => c.id === clase.cancha_id);
    if (!cancha) return;
    const pagosIniciales = cobrosPorClase.get(clase.id) ?? [];
    setSelectedClase({ clase, cancha, fecha, pagosIniciales });
  }

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Reservas
          </h1>
          <p className="text-sm text-muted-foreground">
            Grilla del día por cancha. Cada bloque representa una reserva.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <NavegacionFecha fecha={fecha} onChange={handleFechaChange} />
          <ContadorDiaOperativo conteo={conteo} />
        </div>
      </header>

      {(turnosViejosQuery.data?.length ?? 0) > 0 && (
        <AlarmaTurnosViejos
          turnos={turnosViejosQuery.data ?? []}
          onIrAFecha={handleFechaChange}
        />
      )}

      <ReservasBody
        loadingHorarios={horariosQuery.isLoading}
        loadingCanchas={canchasQuery.isLoading}
        loadingReservas={reservasQuery.isLoading}
        errorHorarios={horariosQuery.error?.message ?? null}
        errorCanchas={canchasQuery.error?.message ?? null}
        errorReservas={reservasQuery.error?.message ?? null}
        horaApertura={horariosQuery.data?.hora_apertura ?? null}
        horaCierre={horariosQuery.data?.hora_cierre ?? null}
        duracionDefault={horariosQuery.data?.duracion_turno_default ?? 90}
        franjas={franjasQuery.data ?? []}
        infoReservas={infoReservas}
        canchasActivas={canchasActivas}
        reservas={reservasQuery.data ?? []}
        clases={clasesDelDia}
        cobrosPorClase={cobrosPorClase}
        fecha={fecha}
        onSlotClick={handleSlotClick}
        onReservaClick={handleReservaClick}
        onClaseClick={handleClaseClick}
      />

      <NuevaReservaDialog
        open={nuevoSlot !== null}
        onOpenChange={(open) => {
          if (!open) setNuevoSlot(null);
        }}
        slot={nuevoSlot}
      />

      <DetalleReservaDialog
        open={selectedDetalle !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDetalle(null);
        }}
        reserva={selectedDetalle?.reserva ?? null}
        cancha={selectedDetalle?.cancha ?? null}
        readOnly={!canEdit}
      />

      <DetalleClaseDialog
        open={selectedClase !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedClase(null);
        }}
        clase={selectedClase?.clase ?? null}
        cancha={selectedClase?.cancha ?? null}
        fecha={selectedClase?.fecha ?? null}
        pagosIniciales={selectedClase?.pagosIniciales ?? []}
        readOnly={!canEdit}
      />
    </div>
  );
}

interface ReservasBodyProps {
  loadingHorarios: boolean;
  loadingCanchas: boolean;
  loadingReservas: boolean;
  errorHorarios: string | null;
  errorCanchas: string | null;
  errorReservas: string | null;
  horaApertura: string | null;
  horaCierre: string | null;
  duracionDefault: number;
  franjas: FranjaTurno[];
  infoReservas: Map<number, InfoReservaVisual>;
  canchasActivas: Cancha[];
  reservas: ReservaConTitular[];
  clases: ClaseConProfesor[];
  cobrosPorClase: Map<number, ClaseCobro[]>;
  fecha: string;
  onSlotClick: (canchaId: number, hora: string, duracionesPermitidas: number[]) => void;
  onReservaClick: (reserva: ReservaConTitular) => void;
  onClaseClick: (clase: ClaseConProfesor) => void;
}

function ReservasBody({
  loadingHorarios,
  loadingCanchas,
  loadingReservas,
  errorHorarios,
  errorCanchas,
  errorReservas,
  horaApertura,
  horaCierre,
  duracionDefault,
  franjas,
  infoReservas,
  canchasActivas,
  reservas,
  clases,
  cobrosPorClase,
  fecha,
  onSlotClick,
  onReservaClick,
  onClaseClick,
}: ReservasBodyProps) {
  // Loading inicial (horarios y canchas) — sin ellos no podemos siquiera
  // dibujar el armazón de la grilla. Reservas puede cargar después.
  if (loadingHorarios || loadingCanchas) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (errorHorarios || errorCanchas) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {errorHorarios ?? errorCanchas}
      </div>
    );
  }

  if (!horaApertura || !horaCierre) {
    return <ConfigurarHorariosBanner />;
  }

  if (canchasActivas.length === 0) {
    return <SinCanchasActivasBanner />;
  }

  if (errorReservas) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        {errorReservas}
      </div>
    );
  }

  return (
    <GrillaDia
      canchas={canchasActivas}
      reservas={reservas}
      clases={clases}
      cobrosPorClase={cobrosPorClase}
      horaApertura={horaApertura}
      horaCierre={horaCierre}
      fecha={fecha}
      franjas={franjas}
      duracionDefault={duracionDefault}
      infoReservas={infoReservas}
      loading={loadingReservas}
      onSlotClick={onSlotClick}
      onReservaClick={onReservaClick}
      onClaseClick={onClaseClick}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Contador del día por estado operativo (sub-bloque 3)
// ─────────────────────────────────────────────────────────────────────

function ContadorDiaOperativo({
  conteo,
}: {
  conteo: {
    reservado: number;
    abierto: number;
    cerrado: number;
    cancelado: number;
  };
}) {
  const items: Array<{ estado: EstadoOperativo; n: number }> = [
    { estado: 'reservado', n: conteo.reservado },
    { estado: 'abierto', n: conteo.abierto },
    { estado: 'cerrado', n: conteo.cerrado },
  ];
  // Cancelado se omite del contador (estado negativo, no operativo del día).
  if (conteo.reservado + conteo.abierto + conteo.cerrado === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map(({ estado, n }) => (
        <span
          key={estado}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: estadoOperativoColorVar(estado) }}
          />
          <span className="font-semibold tabular-nums text-foreground">{n}</span>
          <span className="text-muted-foreground">
            {ESTADO_OPERATIVO_LABEL[estado].toLowerCase()}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Alarma de turnos viejos sin cerrar (sub-bloque 4)
// ─────────────────────────────────────────────────────────────────────

function AlarmaTurnosViejos({
  turnos,
  onIrAFecha,
}: {
  turnos: ReservaOperativa[];
  onIrAFecha: (fecha: string) => void;
}) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border p-3 text-sm"
      style={{
        borderColor: 'hsl(var(--estado-senada) / 0.4)',
        backgroundColor: 'hsl(var(--estado-senada) / 0.1)',
      }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: 'hsl(var(--estado-senada))' }}
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            {turnos.length === 1
              ? 'Hay 1 turno de un día anterior sin cerrar.'
              : `Hay ${turnos.length} turnos de días anteriores sin cerrar.`}
          </p>
          <p className="text-xs text-muted-foreground">
            Tuvieron consumo o pago y nunca se cerraron. Revisalos y cerralos
            si ya terminaron.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {turnos.slice(0, 8).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onIrAFecha(t.fecha)}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {formatearFechaAmigable(t.fecha)} · {formatearHora(t.hora_inicio)}
          </button>
        ))}
        {turnos.length > 8 && (
          <span className="self-center text-xs text-muted-foreground">
            +{turnos.length - 8} más
          </span>
        )}
      </div>
    </div>
  );
}

function ConfigurarHorariosBanner() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
      <Clock
        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="font-medium text-foreground">
          Configurá los horarios del club primero.
        </p>
        <p className="text-muted-foreground">
          La grilla de reservas necesita saber a qué hora abre y cierra el
          club para poder dibujar los slots.
        </p>
        <Link
          to="/configuracion/horarios"
          className="inline-block text-primary underline-offset-4 hover:underline"
        >
          Ir a Configuración → Horarios →
        </Link>
      </div>
    </div>
  );
}

function SinCanchasActivasBanner() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
      <LayoutGrid
        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="font-medium text-foreground">
          No hay canchas activas.
        </p>
        <p className="text-muted-foreground">
          Agregá al menos una cancha (o activá las que tengas desactivadas)
          para poder armar la grilla del día.
        </p>
        <Link
          to="/configuracion/canchas"
          className="inline-block text-primary underline-offset-4 hover:underline"
        >
          Ir a Configuración → Canchas →
        </Link>
      </div>
    </div>
  );
}
