import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { useTurnosCajaHistorial } from '@/features/caja/hooks/useTurnosCajaHistorial';
import { useInformeTurno } from './hooks/useInformeTurno';
import { useInformeDia } from './hooks/useInformeDia';
import {
  MEDIO_LABEL,
  type ArqueoCalculado,
  type CobroTurno,
  type IngresoPorMedioInforme,
  type ProductoVendido,
  type TotalesUnidad,
} from './utils/informeTurno';
import type { JornadaArqueo } from './hooks/useInformeDia';
import { exportarInformePdf } from './utils/exportarInformePdf';
import { InformeDiarioView } from './components/InformeDiarioView';
import { useReservasDelDia } from '@/features/reservas/hooks/useReservasDelDia';
import { useClases } from '@/features/configuracion/hooks/useClases';
import { useCanchas } from '@/features/configuracion/hooks/useCanchas';
import { useHorariosClub } from '@/features/configuracion/hooks/useHorariosClub';
import {
  diaSemanaDe,
  fechaHoy,
} from '@/features/reservas/utils/fechaUtils';
import { calcularOcupacion } from '@/features/dashboard/utils/kpisHoy';
import { Input } from '@/components/ui/input';

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return currencyFmt.format(Math.round(n));
}

const AR_TZ = 'America/Argentina/Buenos_Aires';

const fechaLargaFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: AR_TZ,
});


const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: AR_TZ,
});

const horaFmt = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: AR_TZ,
});

function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  return `${fechaCortaFmt.format(d)} ${horaFmt.format(d)}`;
}

function fmtFechaJornada(fecha: string): string {
  return fechaLargaFmt.format(new Date(`${fecha}T12:00:00`));
}

const ORIGEN_LABEL: Record<CobroTurno['origen'], string> = {
  reserva: 'Reserva',
  clase: 'Clase',
  venta: 'Venta',
  otro_ingreso: 'Otro ingreso',
};

// ─────────────────────────────────────────────────────────────────────
// Página — modo jornada (arqueo) | día completo
// ─────────────────────────────────────────────────────────────────────

type ModoInforme = 'turno' | 'dia';

/**
 * Informe de caja. Dos alcances:
 *   - "Jornada": una `turnos_caja` puntual — cobros del responsable del
 *     turno + arqueo de su caja.
 *   - "Día completo": todos los cobros del club en el día calendario +
 *     arqueo de cada jornada abierta ese día.
 *
 * Acceso temporal restringido al rol administrador.
 */
export function InformeTurnoPage() {
  const { club } = useSession();
  const [modo, setModo] = useState<ModoInforme>('turno');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Informe de caja
          </h1>
          <p className="text-sm text-muted-foreground">
            {club?.nombre ? `${club.nombre} · ` : ''}
            Por jornada de caja o día completo
          </p>
        </div>
      </header>

      {/* Tabs de alcance */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
        {(
          [
            { key: 'turno', label: 'Por jornada' },
            { key: 'dia', label: 'Día completo' },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setModo(m.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              modo === m.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {modo === 'turno' ? <ModoJornada /> : <ModoDiaCompleto />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modo jornada — una turnos_caja puntual
// ─────────────────────────────────────────────────────────────────────

function ModoJornada() {
  const { club } = useSession();
  const turnosQuery = useTurnosCajaHistorial();
  const turnos = turnosQuery.data ?? [];

  const [turnoId, setTurnoId] = useState<number | null>(null);
  const [fechaJornada, setFechaJornada] = useState('');
  const turnoSelId = turnos.some((turno) => turno.id === turnoId)
    ? turnoId
    : (turnos.find((turno) => turno.fecha_jornada === fechaJornada)?.id ?? turnos[0]?.id ?? null);

  const informeQuery = useInformeTurno(turnoSelId);
  const informe = informeQuery.data ?? null;
  const contexto = useContextoClubDia(informe?.turno.fecha_jornada ?? null);

  const generado = useMemo(() => new Date(), []);

  const viewData: InformeViewProps | null = informe
    ? {
        titulo: 'INFORME DE JORNADA',
        nombreClub: club?.nombre ?? '',
        fechaLabel: fmtFechaJornada(informe.turno.fecha_jornada),
        generado,
        lineasEncabezado: [
          `Responsable: ${informe.responsableNombre}`,
          `Apertura ${horaFmt.format(new Date(informe.turno.abierta_en))} · ${
            informe.turno.cerrada_en
              ? `Cierre ${horaFmt.format(new Date(informe.turno.cerrada_en))}`
              : 'Caja abierta'
          }`,
        ],
        kpis: [
          {
            label: 'Cobrado en la jornada',
            valor: informe.porMedio.total,
            nota: `${informe.cobros.length} cobros · todos los medios`,
          },
          {
            label: 'Efectivo esperado',
            valor: informe.arqueo.esperado,
            nota: 'Apertura + cobros efectivo − salidas',
          },
          {
            label: 'Efectivo contado',
            valor: informe.arqueo.contado,
            nota:
              informe.arqueo.diferencia !== null
                ? `Diferencia ${fmtMoney(informe.arqueo.diferencia)}`
                : 'Sin arqueo todavía',
          },
          {
            label: 'Ocupación del club',
            valor:
              contexto.ocupacionPct === null
                ? null
                : `${Math.round(contexto.ocupacionPct)}%`,
            nota: 'Cancha-hora del día',
          },
        ],
        porMedio: informe.porMedio,
        arqueo: informe.arqueo,
        unidades: informe.unidades,
        topProductos: informe.topProductos,
        cobros: informe.cobros,
        contexto,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SelectorJornada
          turnos={turnos}
          loading={turnosQuery.isLoading}
          turnoSelId={turnoSelId}
          onChange={setTurnoId}
          onFechaChange={(fecha) => {
            setFechaJornada(fecha);
            setTurnoId(null);
          }}
        />
        <BotonExportar datos={viewData} />
      </div>

      {informeQuery.isLoading && <SkeletonInforme />}
      {informeQuery.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {informeQuery.error.message}
        </p>
      )}

      {viewData && !informeQuery.isLoading && <InformeView {...viewData} />}
    </div>
  );
}

function SelectorJornada({
  turnos,
  loading,
  turnoSelId,
  onChange,
  onFechaChange,
}: {
  turnos: Array<{
    id: number;
    fecha_jornada: string;
    abierta_en: string;
    cerrada_en: string | null;
    vendedorNombre: string | null;
  }>;
  loading: boolean;
  turnoSelId: number | null;
  onChange: (id: number) => void;
  onFechaChange: (fecha: string) => void;
}) {
  const fechas = [...new Set(turnos.map((turno) => turno.fecha_jornada))];
  const turnoSeleccionado = turnos.find((turno) => turno.id === turnoSelId) ?? turnos[0] ?? null;
  const [fechaSeleccionada, setFechaSeleccionada] = useState(turnoSeleccionado?.fecha_jornada ?? '');
  const fechaActiva = fechas.includes(fechaSeleccionada)
    ? fechaSeleccionada
    : (turnoSeleccionado?.fecha_jornada ?? fechas[0] ?? '');
  const jornadasDelDia = turnos.filter((turno) => turno.fecha_jornada === fechaActiva);

  if (loading) {
    return <div className="h-9 w-full max-w-md animate-pulse rounded bg-muted/50" />;
  }
  if (turnos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No hay jornadas de caja para mostrar.
      </p>
    );
  }
  return (
    <section className="w-full space-y-3" aria-label="Seleccionar jornada">
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="selector-fecha-jornada"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Día de caja
        </label>
        <Input
          id="selector-fecha-jornada"
          type="date"
          value={fechaActiva}
          onChange={(event) => {
            const nextFecha = event.target.value;
            setFechaSeleccionada(nextFecha);
            onFechaChange(nextFecha);
          }}
          className="h-9 w-auto"
          aria-label="Elegir día de caja"
        />
        <span className="text-xs text-muted-foreground">
          {jornadasDelDia.length} {jornadasDelDia.length === 1 ? 'jornada' : 'jornadas'}
        </span>
      </div>
      {jornadasDelDia.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {jornadasDelDia.map((turno) => {
            const seleccionada = turno.id === turnoSelId;
            const apertura = horaFmt.format(new Date(turno.abierta_en));
            const cierre = turno.cerrada_en
              ? horaFmt.format(new Date(turno.cerrada_en))
              : null;
            return (
              <button
                key={turno.id}
                type="button"
                onClick={() => onChange(turno.id)}
                aria-pressed={seleccionada}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  seleccionada
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/40',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {apertura}{cierre ? `–${cierre}` : ' · Abierta'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">#{turno.id}</span>
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {turno.vendedorNombre ?? 'Responsable sin nombre'}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No hay jornadas de caja para ese día. Elegí otra fecha.
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modo día completo — todos los cobros del club en la fecha
// ─────────────────────────────────────────────────────────────────────

function ModoDiaCompleto() {
  const { club } = useSession();
  const [fecha, setFecha] = useState(fechaHoy());

  const informeQuery = useInformeDia(fecha);
  const informe = informeQuery.data ?? null;
  const generado = useMemo(() => new Date(), []);

  const totalEfectivoEsperado = informe
    ? informe.jornadas.reduce((acc, j) => acc + j.arqueo.esperado, 0)
    : 0;
  const totalDiferencia = informe
    ? informe.jornadas.reduce(
        (acc, j) => acc + (j.arqueo.diferencia ?? 0),
        0,
      )
    : 0;

  const viewData: InformeViewProps | null = informe
    ? {
        titulo: 'INFORME DIARIO',
        nombreClub: club?.nombre ?? '',
        fechaLabel: fmtFechaJornada(fecha),
        generado,
        lineasEncabezado: informe.jornada.lineas,
        kpis: [
          {
            label: 'Facturación del día',
            valor: informe.facturacion,
            nota: `${informe.cobros.length} cobros · todos los medios`,
          },
          {
            label: 'Efectivo esperado',
            valor: totalEfectivoEsperado,
            nota: 'Suma de jornadas de caja',
          },
          {
            label: 'Diferencia de arqueos',
            valor: informe.jornadas.some((j) => j.arqueo.diferencia !== null)
              ? totalDiferencia
              : null,
            nota: 'Suma de diferencias del día',
          },
          {
            label: 'Ocupación del club',
            valor:
              informe.ocupacion.porcentaje === null
                ? null
                : `${Math.round(informe.ocupacion.porcentaje)}%`,
            nota: 'Cancha-hora del día',
          },
        ],
        porMedio: informe.porMedio,
        jornadas: informe.jornadas,
        unidades: informe.unidades,
        topProductos: informe.buffetShop.topProductos,
        cobros: informe.cobros,
        contexto: {
          ocupacionPct: informe.ocupacion.porcentaje,
          minutosOcupados: informe.ocupacion.minutosOcupados,
          minutosDisponibles: informe.ocupacion.minutosDisponibles,
          turnosTotales: informe.contexto.turnosTotales,
          reservasCount: informe.contexto.reservasCount,
          isLoading: false,
        },
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="selector-fecha-dia"
            className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Fecha
          </label>
          <Input
            id="selector-fecha-dia"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="h-9 w-auto"
          />
        </div>
        <BotonExportar datos={viewData} />
      </div>

      {informeQuery.isLoading && <SkeletonInforme />}
      {informeQuery.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {informeQuery.error.message}
        </p>
      )}

      {informe && !informeQuery.isLoading && (
        <InformeDiarioView informe={informe} nombreClub={club?.nombre ?? ''} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Contexto del club para una fecha (ocupación + reservas)
// ─────────────────────────────────────────────────────────────────────

interface ContextoClub {
  ocupacionPct: number | null;
  minutosOcupados: number;
  minutosDisponibles: number;
  turnosTotales: number;
  reservasCount: number;
  isLoading: boolean;
}

function useContextoClubDia(fecha: string | null): ContextoClub {
  const reservasQ = useReservasDelDia(fecha ?? '');
  const clasesQ = useClases();
  const canchasQ = useCanchas();
  const horariosQ = useHorariosClub();

  const ocupacion = useMemo(() => {
    if (
      !fecha ||
      !reservasQ.data ||
      !clasesQ.data ||
      !canchasQ.data ||
      !horariosQ.data
    ) {
      return null;
    }
    const canchasActivas = canchasQ.data.filter((c) => c.activa).length;
    const clasesFiltradas = clasesQ.data.filter((c) => {
      if (!c.activa) return false;
      if (c.es_recurrente === false) return c.fecha_clase === fecha;
      return true;
    });
    return calcularOcupacion({
      reservas: reservasQ.data,
      clases: clasesFiltradas,
      diaSemana: diaSemanaDe(fecha),
      horaApertura: horariosQ.data.hora_apertura,
      horaCierre: horariosQ.data.hora_cierre,
      canchasActivas,
    });
  }, [fecha, reservasQ.data, clasesQ.data, canchasQ.data, horariosQ.data]);

  return {
    ocupacionPct: ocupacion?.porcentaje ?? null,
    minutosOcupados: ocupacion?.minutosOcupados ?? 0,
    minutosDisponibles: ocupacion?.minutosDisponibles ?? 0,
    turnosTotales: ocupacion?.turnosTotalesHoy ?? 0,
    reservasCount: reservasQ.data?.length ?? 0,
    isLoading:
      reservasQ.isLoading ||
      clasesQ.isLoading ||
      canchasQ.isLoading ||
      horariosQ.isLoading,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Vista del informe (compartida por ambos modos) — secciones numeradas
// estilo del informe modelo
// ─────────────────────────────────────────────────────────────────────

interface InformeViewProps {
  titulo: string;
  nombreClub: string;
  fechaLabel: string;
  generado: Date;
  lineasEncabezado: string[];
  kpis: Array<{ label: string; valor: number | string | null; nota: string }>;
  porMedio: { items: IngresoPorMedioInforme[]; total: number };
  /** Solo modo jornada: arqueo de la caja. */
  arqueo?: ArqueoCalculado;
  /** Solo modo día: arqueo por cada jornada. */
  jornadas?: JornadaArqueo[];
  unidades: TotalesUnidad;
  topProductos: ProductoVendido[];
  cobros: CobroTurno[];
  contexto: ContextoClub;
}

function InformeView(props: InformeViewProps) {
  const { titulo, nombreClub, fechaLabel, generado, lineasEncabezado } = props;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Encabezado estilo informe */}
      <header className="border-b border-border bg-muted/30 px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {titulo}
          {nombreClub ? ` · ${nombreClub}` : ''}
        </p>
        <h2 className="mt-1 text-lg font-semibold capitalize text-foreground">
          {fechaLabel}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Generado {generado.toLocaleString('es-AR', { timeZone: AR_TZ })}
        </p>
        {lineasEncabezado.map((l) => (
          <p key={l} className="mt-0.5 text-xs text-muted-foreground">
            {l}
          </p>
        ))}
      </header>

      <div className="space-y-6 p-5">
        {/* KPIs grandes */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {props.kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-lg border border-border bg-muted/20 p-4"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {k.label}
              </p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums leading-none text-foreground">
                {typeof k.valor === 'number' ? fmtMoney(k.valor) : (k.valor ?? '—')}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">{k.nota}</p>
            </div>
          ))}
        </div>

        <SeccionMedios porMedio={props.porMedio} />
        {props.arqueo && <SeccionArqueo arqueo={props.arqueo} />}
        {props.jornadas && <SeccionJornadas jornadas={props.jornadas} />}
        <SeccionUnidades unidades={props.unidades} topProductos={props.topProductos} />
        <SeccionCobros cobros={props.cobros} />
        <SeccionContexto contexto={props.contexto} />
      </div>
    </article>
  );
}

function Seccion({
  numero,
  titulo,
  subtitulo,
  children,
}: {
  numero: number;
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header>
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
          <span className="text-muted-foreground">{numero}.</span> {titulo}
        </h3>
        {subtitulo && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>
        )}
      </header>
      {children}
    </section>
  );
}

// 1 · Cobros por medio de pago
function SeccionMedios({
  porMedio,
}: {
  porMedio: { items: IngresoPorMedioInforme[]; total: number };
}) {
  return (
    <Seccion numero={1} titulo="Cobros por medio de pago">
      {porMedio.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Sin cobros en el período
        </p>
      ) : (
        <ul className="space-y-2.5">
          {porMedio.items.map((m) => {
            const pct =
              porMedio.total !== 0
                ? Math.round((m.monto / Math.abs(porMedio.total)) * 100)
                : 0;
            return (
              <li key={m.clave} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-foreground">
                    {m.etiqueta}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {m.count} {m.count === 1 ? 'cobro' : 'cobros'} · {pct}%
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {fmtMoney(m.monto)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.min(100, Math.abs(pct))}%` }}
                  />
                </div>
              </li>
            );
          })}
          <li className="flex items-baseline justify-between border-t border-border pt-2 text-sm font-semibold">
            <span className="text-foreground">Total cobrado</span>
            <span className="tabular-nums text-foreground">
              {fmtMoney(porMedio.total)}
            </span>
          </li>
        </ul>
      )}
    </Seccion>
  );
}

// 2a · Arqueo de la jornada (modo turno)
function SeccionArqueo({ arqueo }: { arqueo: ArqueoCalculado }) {
  const filas: Array<{ label: string; valor: number | null; fuerte?: boolean }> = [
    { label: 'Saldo inicial', valor: arqueo.apertura },
    { label: '+ Cobros de reservas', valor: arqueo.cobrosReservas },
    { label: '+ Cobros de ventas', valor: arqueo.cobrosVentas },
    { label: '+ Cobros de clases', valor: arqueo.cobrosClases },
    { label: '+ Ajustes positivos', valor: arqueo.ajustesPositivos },
    { label: '− Salidas y pagos', valor: -arqueo.salidas },
    { label: '= Efectivo esperado', valor: arqueo.esperado, fuerte: true },
    { label: 'Efectivo contado', valor: arqueo.contado, fuerte: true },
    { label: 'Diferencia', valor: arqueo.diferencia, fuerte: true },
  ];
  return (
    <Seccion numero={2} titulo="Caja de la jornada" subtitulo="Solo efectivo físico">
      <div className="grid gap-x-8 gap-y-1 rounded-lg border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
        {filas.map((f) => (
          <div
            key={f.label}
            className="flex items-baseline justify-between gap-3 py-1 text-sm"
          >
            <span
              className={cn(
                'text-muted-foreground',
                f.fuerte && 'font-medium text-foreground',
              )}
            >
              {f.label}
            </span>
            <span
              className={cn(
                'tabular-nums',
                f.fuerte ? 'font-semibold text-foreground' : 'text-foreground',
                f.label === 'Diferencia' &&
                  (f.valor ?? 0) !== 0 &&
                  (f.valor ?? 0) < 0 &&
                  'text-red-600 dark:text-red-500',
              )}
            >
              {f.valor === null ? '—' : fmtMoney(f.valor)}
            </span>
          </div>
        ))}
      </div>
    </Seccion>
  );
}

// 2b · Jornadas del día (modo día completo)
function SeccionJornadas({ jornadas }: { jornadas: JornadaArqueo[] }) {
  return (
    <Seccion
      numero={2}
      titulo="Jornadas de caja"
      subtitulo="Arqueo de cada turno abierto ese día"
    >
      {jornadas.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Sin jornadas de caja ese día
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Jornada</th>
                <th className="px-3 py-2">Apertura</th>
                <th className="px-3 py-2">Cierre</th>
                <th className="px-3 py-2 text-right">Esperado</th>
                <th className="px-3 py-2 text-right">Contado</th>
                <th className="px-3 py-2 text-right">Diferencia</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {jornadas.map((j) => (
                <tr key={j.turno.id}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    #{j.turno.id}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {horaFmt.format(new Date(j.turno.abierta_en))}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {j.turno.cerrada_en
                      ? horaFmt.format(new Date(j.turno.cerrada_en))
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {fmtMoney(j.arqueo.esperado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {j.arqueo.contado === null ? '—' : fmtMoney(j.arqueo.contado)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      j.arqueo.diferencia !== null &&
                        j.arqueo.diferencia !== 0 &&
                        (j.arqueo.diferencia < 0
                          ? 'text-red-600 dark:text-red-500'
                          : 'text-emerald-600 dark:text-emerald-500'),
                      (j.arqueo.diferencia === null ||
                        j.arqueo.diferencia === 0) &&
                        'text-muted-foreground',
                    )}
                  >
                    {j.arqueo.diferencia === null
                      ? '—'
                      : fmtMoney(j.arqueo.diferencia)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        j.turno.cerrada_en
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                      )}
                    >
                      {j.turno.cerrada_en ? 'Cerrada' : 'Abierta'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}

// 3 · Ingresos por unidad de negocio + más vendidos
function SeccionUnidades({
  unidades,
  topProductos,
}: {
  unidades: TotalesUnidad;
  topProductos: ProductoVendido[];
}) {
  const filas: Array<{ label: string; valor: number }> = [
    { label: 'Canchas (alquiler)', valor: unidades.canchas },
    { label: 'Clases', valor: unidades.clases },
    { label: 'Buffet (turno + mostrador)', valor: unidades.buffet },
    { label: 'Shop (turno + mostrador)', valor: unidades.shop },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Seccion numero={3} titulo="Ingresos por unidad de negocio">
        <div className="overflow-hidden rounded-lg border border-border/60">
          <table className="w-full text-sm">
            <tbody>
              {filas.map((f) => {
                const pct =
                  unidades.total > 0
                    ? Math.round((f.valor / unidades.total) * 100)
                    : 0;
                return (
                  <tr
                    key={f.label}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-3 py-2 text-muted-foreground">{f.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {fmtMoney(f.valor)}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {pct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-muted/30 font-semibold">
                <td className="px-3 py-2 text-foreground">Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {fmtMoney(unidades.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Seccion>

      <Seccion
        numero={4}
        titulo="Más vendidos"
        subtitulo="Consumos del turno y ventas de mostrador"
      >
        {topProductos.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Sin ventas de productos
          </p>
        ) : (
          <ol className="space-y-2">
            {topProductos.map((p, i) => (
              <li
                key={p.nombre}
                className="flex items-baseline justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm"
              >
                <span className="flex items-baseline gap-2 text-foreground">
                  <span className="w-4 text-[11px] tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  {p.nombre}
                  <span className="text-[11px] text-muted-foreground">
                    {p.cantidad} u.
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {fmtMoney(p.total)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Seccion>
    </div>
  );
}

// 5 · Detalle de cobros
function SeccionCobros({ cobros }: { cobros: CobroTurno[] }) {
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const visibles = mostrarTodos ? cobros : cobros.slice(-40);

  return (
    <Seccion
      numero={5}
      titulo="Detalle de cobros"
      subtitulo={`${cobros.length} cobros en el período`}
    >
      {cobros.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Sin cobros
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Fecha/hora</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Detalle</th>
                  <th className="px-3 py-2">Medio</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {[...visibles].reverse().map((c) => (
                  <tr key={c.clave}>
                    <td className="whitespace-nowrap px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
                      {fmtFechaHora(c.fecha_hora)}
                    </td>
                    <td className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {ORIGEN_LABEL[c.origen]}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-foreground">
                      {c.descripcion}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {c.cuenta_nombre ?? MEDIO_LABEL[c.medio_pago]}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2 text-right font-semibold tabular-nums',
                        c.monto < 0
                          ? 'text-red-600 dark:text-red-500'
                          : 'text-emerald-600 dark:text-emerald-500',
                      )}
                    >
                      {c.monto < 0 ? '−' : '+'} {fmtMoney(Math.abs(c.monto))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cobros.length > 40 && (
            <button
              type="button"
              onClick={() => setMostrarTodos((v) => !v)}
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              {mostrarTodos
                ? 'Mostrar solo los últimos 40'
                : `Ver los ${cobros.length} cobros`}
            </button>
          )}
        </>
      )}
    </Seccion>
  );
}

// 6 · Contexto del club
function SeccionContexto({ contexto }: { contexto: ContextoClub }) {
  const items: Array<{ label: string; valor: string; nota: string }> = [
    {
      label: 'Turnos totales',
      valor: String(contexto.turnosTotales),
      nota: 'Reservas + clases del día',
    },
    {
      label: 'Reservas',
      valor: String(contexto.reservasCount),
      nota: 'Turnos reservados',
    },
    {
      label: 'Minutos ocupados',
      valor: `${Math.round(contexto.minutosOcupados / 60)}h`,
      nota:
        contexto.minutosDisponibles > 0
          ? `de ${Math.round(contexto.minutosDisponibles / 60)}h disponibles`
          : 'sin horario configurado',
    },
  ];

  return (
    <Seccion
      numero={6}
      titulo="Contexto del club"
      subtitulo="Actividad del día completa"
    >
      {contexto.isLoading ? (
        <div className="h-20 animate-pulse rounded bg-muted/40" aria-busy="true" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {items.map((it) => (
            <div
              key={it.label}
              className="rounded-md border border-border/60 bg-muted/20 p-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {it.label}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
                {it.valor}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{it.nota}</p>
            </div>
          ))}
        </div>
      )}
    </Seccion>
  );
}

function SkeletonInforme() {
  return (
    <div className="space-y-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-48 animate-pulse rounded-xl bg-muted/40" />
      ))}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────
// Botón de exportar — la generación del PDF vive en utils/exportarInformePdf
// ─────────────────────────────────────────────────────────────────────

function BotonExportar({ datos }: { datos: InformeViewProps | null }) {
  const [exportando, setExportando] = useState(false);

  async function handleClick() {
    if (!datos || exportando) return;
    setExportando(true);
    try {
      await exportarInformePdf(datos);
    } finally {
      setExportando(false);
    }
  }

  return (
    <button
      type="button"
      disabled={!datos || exportando}
      onClick={() => void handleClick()}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {exportando ? 'Generando…' : 'Exportar PDF'}
    </button>
  );
}
