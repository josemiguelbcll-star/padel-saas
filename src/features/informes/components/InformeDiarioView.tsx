import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InformeDiarioData } from '../hooks/useInformeDia';
import { MEDIO_LABEL } from '../utils/informeTurno';
import {
  generarAlertas,
  type CeldaOcupacion,
} from '../utils/informeDiario';
import { useProductosParaReponer } from '@/features/dashboard/hooks/useProductosParaReponer';
import { useResumenFinanciero } from '@/features/finanzas/hooks/useResumenFinanciero';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const fmtMoney = (n: number) => currencyFmt.format(Math.round(n));

const CELDA_STYLE: Record<CeldaOcupacion, string> = {
  fijo: 'bg-sky-500',
  variable: 'bg-emerald-500',
  clase: 'bg-violet-500',
  libre: 'bg-muted',
};
const CELDA_LABEL: Record<CeldaOcupacion, string> = {
  fijo: 'Turno fijo',
  variable: 'Turno variable',
  clase: 'Clase',
  libre: 'Libre',
};

/**
 * Informe diario del dueño — layout denso a 2 columnas replicando el
 * PDF modelo: header con badge de alertas, fila de KPIs grandes,
 * secciones numeradas (1 Actividad · 2 Caja · 3 Unidades · 4 Mapa ·
 * 5 Fugas · 6 Buffet · 7 Mes · 8 Hoy · 9 Alertas).
 */
export function InformeDiarioView({
  informe,
  nombreClub,
}: {
  informe: InformeDiarioData;
  nombreClub: string;
}) {
  const reponer = useProductosParaReponer();
  // Acumulado del mes por unidad (EERR) para la columna "Acum. mes".
  const mesInicio = `${informe.fecha.slice(0, 7)}-01`;
  const resumenMes = useResumenFinanciero({ desde: mesInicio, hasta: informe.fecha });
  const acumMesPorUnidad = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of resumenMes.data?.ingresos_por_unidad ?? []) {
      map.set(u.unidad.toLowerCase(), Number(u.monto));
    }
    return map;
  }, [resumenMes.data]);

  const alertas = useMemo(
    () =>
      generarAlertas({
        fugas: informe.fugas,
        jornadasAbiertas: informe.jornadas.filter((j) => !j.turno.cerrada_en)
          .length,
        productosStockBajo: reponer.productos?.length ?? 0,
        pendientesCobroCount: informe.pendientesCobroCount,
      }),
    [informe, reponer.productos],
  );

  const variacion =
    informe.facturacionAnterior > 0
      ? ((informe.facturacion - informe.facturacionAnterior) /
          informe.facturacionAnterior) *
        100
      : null;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      {/* ── Header estilo informe ── */}
      <header className="border-b-2 border-foreground/80 bg-foreground px-5 py-4 text-background">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-background/60">
              Informe diario del dueño{nombreClub ? ` · ${nombreClub.toUpperCase()}` : ''}
            </p>
            <h2 className="mt-1 text-xl font-bold capitalize">
              {informe.jornada.titulo}
            </h2>
            <p className="mt-1 text-[11px] text-background/60">
              {informe.jornada.lineas.join(' · ')}
            </p>
          </div>
          {alertas.length > 0 && (
            <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-300">
              Día con {alertas.length} punto{alertas.length === 1 ? '' : 's'} para revisar
            </span>
          )}
        </div>
      </header>

      <div className="space-y-6 p-5">
        <KpiStrip
          informe={informe}
          variacion={variacion}
        />

        {/* Grid de secciones a 2 columnas como el PDF */}
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <SeccionActividad informe={informe} />
            <SeccionClasesProfesor informe={informe} />
            <SeccionMapa informe={informe} />
          </div>
          <div className="space-y-6">
            <SeccionCaja informe={informe} />
            <SeccionUnidades informe={informe} acumMes={acumMesPorUnidad} />
            <SeccionFugas informe={informe} />
            <SeccionBuffet informe={informe} reponerCount={reponer.productos?.length ?? 0} />
            <SeccionMes informe={informe} />
            <SeccionManana informe={informe} />
            <SeccionAlertas alertas={alertas} />
          </div>
        </div>
      </div>
    </article>
  );
}

// ── KPIs grandes (fila superior del informe) ────────────────────────

function KpiStrip({
  informe,
  variacion,
}: {
  informe: InformeDiarioData;
  variacion: number | null;
}) {
  const fechaAntLabel = useMemo(() => {
    const d = new Date(`${informe.fecha}T12:00:00`);
    d.setDate(d.getDate() - 7);
    return d.toLocaleDateString('es-AR', {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
    });
  }, [informe.fecha]);

  const items: Array<{
    label: string;
    valor: string;
    sub: React.ReactNode;
    grande?: boolean;
  }> = [
    {
      label: 'Facturación del día',
      valor: fmtMoney(informe.facturacion),
      grande: true,
      sub:
        variacion !== null ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 font-semibold',
              variacion >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400',
            )}
          >
            {variacion >= 0 ? (
              <TrendingUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-3 w-3" aria-hidden="true" />
            )}
            {variacion >= 0 ? '▲' : '▼'} {Math.abs(Math.round(variacion * 10) / 10)}% vs {fechaAntLabel} ({fmtMoney(informe.facturacionAnterior)})
          </span>
        ) : (
          <span className="text-muted-foreground">Sin semana anterior</span>
        ),
    },
    {
      label: 'Ocupación de canchas',
      valor:
        informe.ocupacion.porcentaje === null
          ? '—'
          : `${Math.round(informe.ocupacion.porcentaje)}%`,
      sub: informe.mapa
        ? `${Math.round(informe.ocupacion.minutosOcupados / 60)} h ocupadas · ${Math.round(informe.ocupacion.minutosDisponibles / 60)} h disponibles`
        : 'Sin horario configurado',
    },
    {
      label: 'Ingreso por hora disponible',
      valor:
        informe.ingresoHoraDisponible === null
          ? '—'
          : fmtMoney(informe.ingresoHoraDisponible),
      sub:
        informe.ingresoHoraOcupada !== null
          ? `Por hora ocupada: ${fmtMoney(informe.ingresoHoraOcupada)}`
          : 'Canchas + clases ÷ horas disponibles',
    },
    {
      label: 'Pendiente de cobro',
      valor: fmtMoney(informe.pendienteCobro.total),
      sub: `${informe.pendienteCobro.count} turno(s) con saldo`,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((k) => (
        <div
          key={k.label}
          className={cn(
            'rounded-lg border border-border bg-muted/20 p-4',
            k.grande && 'border-foreground/20 bg-foreground/[0.03]',
          )}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {k.label}
          </p>
          <p
            className={cn(
              'mt-1 font-bold tabular-nums leading-none text-foreground',
              k.grande ? 'text-3xl' : 'text-2xl',
            )}
          >
            {k.valor}
          </p>
          <div className="mt-2 text-[11px]">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Primitivas de sección ───────────────────────────────────────────

function TituloSeccion({
  n,
  titulo,
  right,
  children,
}: {
  n: number;
  titulo: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-foreground">
          <span className="mr-1.5 text-muted-foreground">{n}·</span>
          {titulo}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border/70 bg-muted/10 p-3', className)}>
      {children}
    </div>
  );
}

function MiniStat({
  label,
  valor,
  sub,
}: {
  label: string;
  valor: string;
  sub?: string;
}) {
  return (
    <Card>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums leading-none text-foreground">
        {valor}
      </p>
      {sub && <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function TablaSimple({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {head.map((h, i) => (
              <th
                key={h}
                className={cn(
                  'px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground',
                  i === 0 ? 'text-left' : 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">{children}</tbody>
      </table>
    </div>
  );
}

// ── 1 · Actividad del día ───────────────────────────────────────────

function SeccionActividad({ informe }: { informe: InformeDiarioData }) {
  const a = informe.actividad;
  const cards = [
    {
      label: 'Turnos fijos',
      count: a.turnosFijos.count,
      horas: a.turnosFijos.horas,
      monto: a.turnosFijos.monto,
    },
    {
      label: 'Turnos variables',
      count: a.variables.count,
      horas: a.variables.horas,
      monto: a.variables.monto,
    },
    {
      label: 'Clases con profe',
      count: a.clases.count,
      horas: a.clases.horas,
      monto: a.clases.monto,
      extra: `${a.clases.alumnos} alumnos`,
    },
    {
      label: 'Insumos facturados',
      count: a.insumos.unidades,
      horas: null,
      monto: a.insumos.monto,
      extra: 'u. · Buffet + shop',
    },
  ];
  return (
    <TituloSeccion n={1} titulo="Actividad del día">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <Card key={c.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {c.label}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
              {c.count}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {c.horas !== null ? `${c.horas} h · ` : ''}
              {fmtMoney(c.monto)}
              {c.extra ? ` · ${c.extra}` : ''}
            </p>
          </Card>
        ))}
      </div>
      <Card>
        <p className="text-[11px] text-foreground">
          <span className="font-semibold">Mix de horas ocupadas:</span>{' '}
          {(() => {
            const total = a.turnosFijos.horas + a.variables.horas + a.clases.horas;
            if (total <= 0) return '—';
            const pct = (h: number) => Math.round((h / total) * 100);
            return `${pct(a.turnosFijos.horas)}% fijos · ${pct(a.variables.horas)}% variables · ${pct(a.clases.horas)}% clases.`;
          })()}{' '}
          <span className="text-muted-foreground">
            Los fijos dan base estable; los variables y las clases son donde está el crecimiento.
          </span>
        </p>
      </Card>
    </TituloSeccion>
  );
}

// ── Clases por profesor (sub-bloque sin número, como el PDF) ─────────

function SeccionClasesProfesor({ informe }: { informe: InformeDiarioData }) {
  const { filas, total } = informe.clasesProfesor;
  return (
    <section className="space-y-2">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-foreground">
        Clases por profesor
      </h3>
      {filas.length === 0 ? (
        <Card>
          <p className="text-[11px] text-muted-foreground">
            Sin clases dictadas ni inscriptos en el período.
          </p>
        </Card>
      ) : (
        <TablaSimple
          head={[
            'Profesor',
            'Clases hoy',
            'Alumnos',
            'Ingresos hoy',
            'Clases mes',
            'Ingresos mes',
            '% escuela',
          ]}
        >
          {[...filas, total].map((f, i) => (
            <tr key={f.profesor} className={cn(i === filas.length && 'bg-muted/40 font-bold')}>
              <td className="px-2 py-1.5 text-foreground">{f.profesor}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f.clasesHoy}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f.alumnosHoy}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(f.ingresosHoy)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{f.clasesMes}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(f.ingresosMes)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{Math.round(f.pctEscuela)}%</td>
            </tr>
          ))}
        </TablaSimple>
      )}
    </section>
  );
}

// ── 2 · Caja y medios de cobro ──────────────────────────────────────

function SeccionCaja({ informe }: { informe: InformeDiarioData }) {
  const efectivoEsperado = informe.jornadas.reduce(
    (a, j) => a + j.arqueo.esperado,
    0,
  );
  const efectivoContado = informe.jornadas.reduce(
    (a, j) => a + (j.arqueo.contado ?? 0),
    0,
  );
  const hayContado = informe.jornadas.some((j) => j.arqueo.contado !== null);
  return (
    <TituloSeccion n={2} titulo="Caja y medios de cobro">
      <div className="grid gap-2 sm:grid-cols-2">
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Efectivo total acumulado en caja
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
            {fmtMoney(efectivoEsperado)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {hayContado
              ? `Contado en arqueos: ${fmtMoney(efectivoContado)}`
              : 'Esperado según cobros en efectivo'}
          </p>
        </Card>
        <Card>
          <ul className="space-y-1">
            {informe.porMedio.items.map((m) => {
              const pct =
                informe.porMedio.total !== 0
                  ? Math.round((m.monto / Math.abs(informe.porMedio.total)) * 100)
                  : 0;
              return (
                <li key={m.medio} className="flex items-baseline justify-between text-[11px]">
                  <span className="text-foreground">{MEDIO_LABEL[m.medio]}</span>
                  <span className="tabular-nums text-foreground">
                    {fmtMoney(m.monto)} · {pct}%
                  </span>
                </li>
              );
            })}
            <li className="flex items-baseline justify-between border-t border-border/60 pt-1 text-[11px] font-bold">
              <span className="text-foreground">Total cobrado</span>
              <span className="tabular-nums text-foreground">
                {fmtMoney(informe.porMedio.total)}
              </span>
            </li>
          </ul>
        </Card>
      </div>
      {informe.jornadas.length > 0 && (
        <div className="space-y-1">
          {informe.jornadas.map((j) => (
            <div
              key={j.turno.id}
              className="flex flex-wrap items-baseline justify-between gap-1 rounded-md border border-border/60 bg-muted/10 px-2.5 py-1.5 text-[11px]"
            >
              <span className="font-medium text-foreground">
                Jornada #{j.turno.id}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {j.turno.cerrada_en ? 'Cerrada' : 'Abierta'}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                Esperado {fmtMoney(j.arqueo.esperado)}
                {j.arqueo.diferencia !== null && j.arqueo.diferencia !== 0 && (
                  <span
                    className={cn(
                      'ml-1.5 font-semibold',
                      j.arqueo.diferencia < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    Dif. {fmtMoney(j.arqueo.diferencia)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </TituloSeccion>
  );
}

// ── 3 · Ingresos por unidad + facturación 7 días ────────────────────

function SeccionUnidades({
  informe,
  acumMes,
}: {
  informe: InformeDiarioData;
  acumMes: Map<string, number>;
}) {
  const u = informe.unidades;
  const filas: Array<{ key: string; label: string; hoy: number }> = [
    { key: 'canchas', label: 'Canchas', hoy: u.canchas },
    { key: 'clases', label: 'Escuela / clases', hoy: u.clases },
    { key: 'buffet', label: 'Buffet', hoy: u.buffet },
    { key: 'shop', label: 'Shop', hoy: u.shop },
  ];
  const totalMes = filas.reduce((a, f) => a + (acumMes.get(f.key) ?? 0), 0);
  return (
    <TituloSeccion n={3} titulo="Ingresos por unidad de negocio">
      <TablaSimple head={['Unidad', 'Hoy', 'Acum. mes', '% del mes']}>
        {filas.map((f) => {
          const mes = acumMes.get(f.key) ?? 0;
          const pctMes = totalMes > 0 ? (mes / totalMes) * 100 : 0;
          return (
            <tr key={f.key}>
              <td className="px-2 py-1.5 text-foreground">{f.label}</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-foreground">
                {fmtMoney(f.hoy)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                {fmtMoney(mes)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                {Math.round(pctMes)}%
              </td>
            </tr>
          );
        })}
        <tr className="bg-muted/40 font-bold">
          <td className="px-2 py-1.5 text-foreground">Total facturado</td>
          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
            {fmtMoney(u.total)}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
            {fmtMoney(totalMes)}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
            100%
          </td>
        </tr>
      </TablaSimple>
      <Facturacion7Dias dias={informe.facturacion7dias} />
    </TituloSeccion>
  );
}

function Facturacion7Dias({
  dias,
}: {
  dias: InformeDiarioData['facturacion7dias'];
}) {
  if (dias.length === 0) return null;
  const maxV = Math.max(...dias.map((d) => d.ingresos), 1);
  const fmtDia = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  return (
    <Card>
      <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        Facturación últimos 7 días
      </p>
      <div className="flex h-24 items-end gap-1">
        {dias.map((d) => (
          <div key={d.fecha} className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-[8px] tabular-nums text-muted-foreground">
              {d.ingresos >= 1000
                ? `${Math.round(d.ingresos / 1000)}k`
                : String(Math.round(d.ingresos))}
            </span>
            <div
              className="w-full rounded-t-sm bg-primary/80"
              style={{ height: `${Math.max(3, (d.ingresos / maxV) * 64)}px` }}
              title={fmtMoney(d.ingresos)}
            />
            <span className="text-[8px] capitalize text-muted-foreground">
              {fmtDia.format(new Date(`${d.fecha}T12:00:00`)).replace('.', '')}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── 4 · Mapa de ocupación ───────────────────────────────────────────

function SeccionMapa({ informe }: { informe: InformeDiarioData }) {
  const mapa = informe.mapa;
  if (!mapa || mapa.horas.length === 0) return null;
  return (
    <TituloSeccion n={4} titulo="Mapa de ocupación por cancha y hora">
      <div className="overflow-x-auto rounded-lg border border-border/70">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="px-1.5 py-1 text-left text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Cancha
              </th>
              {mapa.horas.map((h) => (
                <th
                  key={h}
                  className="px-0.5 py-1 text-[8px] font-medium tabular-nums text-muted-foreground"
                >
                  {String(h).padStart(2, '0')}
                </th>
              ))}
              <th className="px-1.5 py-1 text-right text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Ocup.
              </th>
            </tr>
          </thead>
          <tbody>
            {mapa.canchas.map((c) => (
              <tr key={c.cancha_id}>
                <td className="whitespace-nowrap px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                  {c.nombre}
                </td>
                {c.celdas.map((celda, i) => (
                  <td
                    key={i}
                    title={CELDA_LABEL[celda]}
                    className={cn('h-5 w-5 border border-border/50', CELDA_STYLE[celda])}
                  />
                ))}
                <td className="px-1.5 py-0.5 text-right text-[10px] tabular-nums text-foreground">
                  {Math.round(c.ocupacionPct)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 text-[9px] text-muted-foreground">
        {(Object.keys(CELDA_LABEL) as CeldaOcupacion[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-sm', CELDA_STYLE[k])} />
            {CELDA_LABEL[k]}
          </span>
        ))}
      </div>
    </TituloSeccion>
  );
}

// ── 5 · Fugas de plata ──────────────────────────────────────────────

function SeccionFugas({ informe }: { informe: InformeDiarioData }) {
  const f = informe.fugas;
  const filas: Array<{ label: string; detalle: string; monto: number }> = [
    {
      label: 'Cobros divididos incompletos',
      detalle: `${f.pendienteCobro.count} jugador(es) · ${f.pendienteCobro.count} turno(s)`,
      monto: f.pendienteCobro.total,
    },
    {
      label: 'Cancelaciones tardías',
      detalle: `${f.cancelaciones.count} cancelada(s)`,
      monto: f.cancelaciones.monto,
    },
    {
      label: 'Diferencias de arqueo',
      detalle: `${f.diferenciasArqueo.count} jornada(s)`,
      monto: Math.abs(f.diferenciasArqueo.total),
    },
  ].filter((x) => x.monto !== 0);
  if (filas.length === 0) return null;
  return (
    <TituloSeccion n={5} titulo="Fugas de plata">
      <Card className="p-0">
        {filas.map((x) => (
          <div
            key={x.label}
            className="flex items-baseline justify-between border-b border-border/50 px-3 py-2 text-[11px] last:border-0"
          >
            <span className="text-foreground">
              {x.label}
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                {x.detalle}
              </span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {fmtMoney(x.monto)}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between bg-muted/40 px-3 py-2 text-[11px] font-bold">
          <span className="text-foreground">Total en riesgo o perdido</span>
          <span className="tabular-nums text-foreground">{fmtMoney(f.total)}</span>
        </div>
      </Card>
    </TituloSeccion>
  );
}

// ── 6 · Buffet y shop ───────────────────────────────────────────────

function SeccionBuffet({
  informe,
  reponerCount,
}: {
  informe: InformeDiarioData;
  reponerCount: number;
}) {
  const b = informe.buffetShop;
  if (b.ventas === 0 && b.topProductos.length === 0) return null;
  return (
    <TituloSeccion n={6} titulo="Buffet y shop">
      <div className="grid gap-2 sm:grid-cols-2">
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ventas POS
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">
            {fmtMoney(b.ventas)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Margen bruto: {b.margenPct === null ? '—' : `${Math.round(b.margenPct)}%`}
          </p>
        </Card>
        <Card>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Más vendidos · Reponer hoy
          </p>
          {b.topProductos.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">Sin ventas.</p>
          ) : (
            <ul className="space-y-0.5">
              {b.topProductos.slice(0, 4).map((p) => (
                <li
                  key={p.nombre}
                  className="flex items-baseline justify-between text-[10px]"
                >
                  <span className="text-foreground">
                    {p.nombre}
                    <span className="ml-1 text-muted-foreground">{p.cantidad} u.</span>
                  </span>
                  <span className="tabular-nums text-foreground">{fmtMoney(p.total)}</span>
                </li>
              ))}
            </ul>
          )}
          {reponerCount > 0 && (
            <p className="mt-1.5 border-t border-border/50 pt-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {reponerCount} producto(s) para reponer stock hoy.
            </p>
          )}
        </Card>
      </div>
    </TituloSeccion>
  );
}

// ── 7 · Cómo viene el mes ───────────────────────────────────────────

function SeccionMes({ informe }: { informe: InformeDiarioData }) {
  const m = informe.mes;
  const filas: Array<{ label: string; valor: string; sub?: string; tone?: 'pos' | 'neg' }> = [
    {
      label: `Facturado al ${new Date(`${informe.fecha}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })}`,
      valor: fmtMoney(m.facturadoMes),
    },
    {
      label: 'Mismo período mes anterior',
      valor: fmtMoney(m.facturadoMesAntMismoPeriodo),
      sub:
        m.variacionPct !== null
          ? `${m.variacionPct >= 0 ? '+' : ''}${Math.round(m.variacionPct * 10) / 10}%`
          : undefined,
      tone: m.variacionPct === null ? undefined : m.variacionPct >= 0 ? 'pos' : 'neg',
    },
    {
      label: 'Proyección de cierre al ritmo actual',
      valor: m.proyeccionCierre === null ? '—' : fmtMoney(m.proyeccionCierre),
      sub: 'ritmo actual',
    },
    {
      label: 'Ocupación promedio del mes',
      valor: m.ocupacionMesPct === null ? '—' : `${Math.round(m.ocupacionMesPct)}%`,
    },
  ];
  return (
    <TituloSeccion n={7} titulo="Cómo viene el mes">
      <Card className="p-0">
        {filas.map((f, i) => (
          <div
            key={f.label}
            className={cn(
              'flex items-baseline justify-between px-3 py-2 text-[11px]',
              i > 0 && 'border-t border-border/50',
            )}
          >
            <span className="text-foreground">{f.label}</span>
            <span
              className={cn(
                'font-bold tabular-nums',
                f.tone === 'pos' && 'text-emerald-600 dark:text-emerald-400',
                f.tone === 'neg' && 'text-red-600 dark:text-red-400',
                !f.tone && 'text-foreground',
              )}
            >
              {f.valor}
              {f.sub && (
                <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">
                  {f.sub}
                </span>
              )}
            </span>
          </div>
        ))}
      </Card>
    </TituloSeccion>
  );
}

// ── 8 · Hoy (día siguiente) ─────────────────────────────────────────

function SeccionManana({ informe }: { informe: InformeDiarioData }) {
  const mananaFecha = useMemo(() => {
    const d = new Date(`${informe.fecha}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }, [informe.fecha]);
  const m = informe.manana;
  if (!m) return null;
  const sugerencia =
    m.horasLibresPico > 2
      ? `Acción sugerida: publicar un partido abierto en las horas pico (${m.horasLibresPico} h libres 18–24 h) y avisar por WhatsApp.`
      : null;
  return (
    <TituloSeccion
      n={8}
      titulo={`Hoy · ${mananaFecha}`}
    >
      <div className="grid grid-cols-3 gap-2">
        <MiniStat
          label="Ya reservado"
          valor={m.pctReservado === null ? '—' : `${Math.round(m.pctReservado)}%`}
          sub={`${m.reservasCount} reservas`}
        />
        <MiniStat
          label="Horas libres en pico"
          valor={`${m.horasLibresPico} h`}
          sub="18–24 h"
        />
        <MiniStat
          label="Minutos reservados"
          valor={`${Math.round(m.minutosReservados / 60)}h`}
          sub={`de ${Math.round(m.minutosDisponibles / 60)}h`}
        />
      </div>
      {sugerencia && (
        <Card>
          <p className="text-[11px] text-foreground">{sugerencia}</p>
        </Card>
      )}
    </TituloSeccion>
  );
}

// ── 9 · Alertas ─────────────────────────────────────────────────────

function SeccionAlertas({
  alertas,
}: {
  alertas: ReturnType<typeof generarAlertas>;
}) {
  return (
    <TituloSeccion n={9} titulo="Alertas para resolver">
      {alertas.length === 0 ? (
        <Card>
          <p className="flex items-center gap-2 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Sin alertas — todo en orden.
          </p>
        </Card>
      ) : (
        <ul className="space-y-1">
          {alertas.map((a, i) => (
            <li
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px]',
                a.severidad === 'rojo'
                  ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
              )}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {a.texto}
            </li>
          ))}
        </ul>
      )}
    </TituloSeccion>
  );
}
