import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { InformeDiarioData } from '../hooks/useInformeDia';
import {
  generarAlertas,
  type CeldaOcupacion,
} from '../utils/informeDiario';
import { useProductosParaReponer } from '@/features/dashboard/hooks/useProductosParaReponer';
import { useResumenFinanciero } from '@/features/finanzas/hooks/useResumenFinanciero';

const fmtNum = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$ ${fmtNum.format(Math.abs(Math.round(n)))}`;
}

const CELDA_STYLE: Record<CeldaOcupacion, string> = {
  fijo: 'bg-[hsl(var(--inf-green-fijo))]',
  variable: 'bg-[hsl(var(--inf-green-var))]',
  clase: 'bg-[hsl(var(--inf-blue))]',
  libre: 'bg-[hsl(var(--inf-line))]',
};
const CELDA_LABEL: Record<CeldaOcupacion, string> = {
  fijo: 'Turno fijo',
  variable: 'Turno variable',
  clase: 'Clase',
  libre: 'Libre',
};

const AR_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Informe diario del dueño — layout del PDF modelo: fondo crema,
 * header tipográfico, KPIs, secciones numeradas 1–9.
 */
export function InformeDiarioView({
  informe,
  nombreClub,
}: {
  informe: InformeDiarioData;
  nombreClub: string;
}) {
  const reponer = useProductosParaReponer();
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

  return (
    <article
      id="informe-diario-pdf"
      className="informe-dueno text-foreground"
    >
      <HeaderInforme
        informe={informe}
        nombreClub={nombreClub}
        alertasCount={alertas.length}
      />

      <div className="mt-6 space-y-5">
        <KpiStrip informe={informe} />
        <SeccionActividad informe={informe} />
        <SeccionClasesProfesor informe={informe} />

        <div className="grid gap-4 xl:grid-cols-2">
          <SeccionCaja informe={informe} />
          <SeccionUnidades informe={informe} acumMes={acumMesPorUnidad} />
        </div>

        <SeccionMapa informe={informe} />

        <div className="grid gap-4 xl:grid-cols-2">
          <SeccionFugas informe={informe} />
          <SeccionBuffet
            informe={informe}
            reponer={reponer.productos ?? []}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <SeccionMes informe={informe} />
          <SeccionManana informe={informe} />
        </div>

        <SeccionAlertas alertas={alertas} />
      </div>
    </article>
  );
}

function HeaderInforme({
  informe,
  nombreClub,
  alertasCount,
}: {
  informe: InformeDiarioData;
  nombreClub: string;
  alertasCount: number;
}) {
  const fecha = new Date(`${informe.fecha}T12:00:00`);
  const titulo = `Cierre del ${fecha.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: AR_TZ,
  })}`;
  const semanaAnt = new Date(fecha);
  semanaAnt.setDate(semanaAnt.getDate() - 7);
  const generado = new Date();
  const ctx = informe.contexto;
  const apertura = ctx.horaApertura?.slice(0, 5) ?? '—';
  const cierre = ctx.horaCierre?.slice(0, 5) ?? '—';

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'hsl(var(--inf-muted))' }}
        >
          Informe diario del dueño
          {nombreClub ? ` · ${nombreClub}` : ''}
        </p>
        <h2 className="mt-1 text-[1.65rem] font-extrabold capitalize leading-tight tracking-tight sm:text-3xl">
          {titulo}
        </h2>
        <p className="mt-1.5 text-[11px]" style={{ color: 'hsl(var(--inf-muted))' }}>
          Generado {generado.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: AR_TZ })}
          {' · '}
          {generado.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: AR_TZ })} h
          {' · '}
          {ctx.canchasActivas} canchas
          {' · '}
          horario {apertura}–{cierre} h
          {' · '}
          Comparación: mismo día de la semana anterior (
          {semanaAnt.toLocaleDateString('es-AR', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            timeZone: AR_TZ,
          })}
          )
        </p>
      </div>
      {alertasCount > 0 && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
          style={{
            background: 'hsl(var(--inf-peach))',
            color: 'hsl(var(--inf-peach-ink))',
            border: '1px solid hsl(var(--inf-peach-border))',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: 'hsl(var(--inf-warn))' }}
          />
          Día con {alertasCount} punto{alertasCount === 1 ? '' : 's'} para revisar
        </span>
      )}
    </header>
  );
}

function Card({
  children,
  className,
  peach,
}: {
  children: React.ReactNode;
  className?: string;
  peach?: boolean;
}) {
  return (
    <div
      className={cn('rounded-2xl border bg-card p-4', className)}
      style={
        peach
          ? {
              background: 'hsl(var(--inf-peach))',
              borderColor: 'hsl(var(--inf-peach-border))',
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

function KpiStrip({ informe }: { informe: InformeDiarioData }) {
  const ocupHoras = Math.round(informe.ocupacion.minutosOcupados / 60);
  const dispHoras = Math.round(informe.ocupacion.minutosDisponibles / 60);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
          Facturación del día
        </p>
        <p className="mt-2 text-[1.7rem] font-extrabold tabular-nums leading-none">
          {fmtMoney(informe.facturacion)}
        </p>
        <p className="mt-2 text-[11px]" style={{ color: 'hsl(var(--inf-muted))' }}>
          Todos los medios de cobro
        </p>
      </Card>

      <Card>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
          Ocupación de canchas
        </p>
        <p className="mt-2 text-[1.7rem] font-extrabold tabular-nums leading-none">
          {informe.ocupacion.porcentaje === null
            ? '—'
            : `${Math.round(informe.ocupacion.porcentaje)}%`}
        </p>
        <p className="mt-2 text-[11px]" style={{ color: 'hsl(var(--inf-muted))' }}>
          {informe.ocupacion.pico
            ? `Pico ${informe.ocupacion.pico.etiqueta}: ${Math.round(informe.ocupacion.pico.pct)}%`
            : `${ocupHoras} h ocupadas`}
          {informe.ocupacion.valle
            ? ` · Valle: ${Math.round(informe.ocupacion.valle.pct)}%`
            : ''}
          {dispHoras > 0 ? ` · ${ocupHoras} de ${dispHoras} h` : ''}
        </p>
      </Card>

      <Card>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
          Ingreso por hora disponible
        </p>
        <p className="mt-2 text-[1.7rem] font-extrabold tabular-nums leading-none">
          {informe.ingresoHoraDisponible === null
            ? '—'
            : fmtMoney(informe.ingresoHoraDisponible)}
        </p>
        <p className="mt-2 text-[11px]" style={{ color: 'hsl(var(--inf-muted))' }}>
          {informe.ingresoHoraOcupada !== null
            ? `Canchas + clases ÷ ${dispHoras} h · por hora ocupada: ${fmtMoney(informe.ingresoHoraOcupada)}`
            : 'Canchas + clases ÷ horas disponibles'}
        </p>
      </Card>

      <Card peach>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-peach-ink))' }}>
          Pendiente de cobro
        </p>
        <p
          className="mt-2 text-[1.7rem] font-extrabold tabular-nums leading-none"
          style={{ color: 'hsl(var(--inf-peach-ink))' }}
        >
          {fmtMoney(informe.pendienteCobro.total)}
        </p>
        <p className="mt-2 text-[11px]" style={{ color: 'hsl(var(--inf-peach-ink))' }}>
          {informe.pendienteCobro.count} turno{informe.pendienteCobro.count === 1 ? '' : 's'} con cobro incompleto
        </p>
      </Card>
    </div>
  );
}

function Titulo({ n, titulo, right }: { n: number; titulo: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h3 className="text-[13px] font-bold tracking-tight">
        {n} · {titulo}
      </h3>
      {right}
    </div>
  );
}

function SeccionActividad({ informe }: { informe: InformeDiarioData }) {
  const a = informe.actividad;
  const cards = [
    {
      label: 'Turnos fijos',
      count: String(a.turnosFijos.count),
      sub: `${a.turnosFijos.horas} h · ${fmtMoney(a.turnosFijos.monto)}`,
    },
    {
      label: 'Turnos variables',
      count: String(a.variables.count),
      sub: `${a.variables.horas} h · ${fmtMoney(a.variables.monto)}`,
    },
    {
      label: 'Clases con profe',
      count: String(a.clases.count),
      sub: `${a.clases.horas} h · ${fmtMoney(a.clases.monto)} · ${a.clases.alumnos} alumnos`,
    },
    {
      label: 'Insumos facturados',
      count: `${a.insumos.unidades} u.`,
      sub: `Buffet + shop · ${fmtMoney(a.insumos.monto)}`,
    },
  ];
  const totalH = a.turnosFijos.horas + a.variables.horas + a.clases.horas;
  const pct = (h: number) => (totalH > 0 ? Math.round((h / totalH) * 100) : 0);

  return (
    <section>
      <Titulo
        n={1}
        titulo="Actividad del día"
        right={
          <span className="text-[10px]" style={{ color: 'hsl(var(--inf-muted))' }}>
            Cada número con su comparación contra la semana anterior
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
              {c.label}
            </p>
            <p className="mt-1.5 text-2xl font-extrabold tabular-nums leading-none">{c.count}</p>
            <p className="mt-1.5 text-[10px]" style={{ color: 'hsl(var(--inf-muted))' }}>
              {c.sub}
            </p>
          </Card>
        ))}
      </div>
      <p className="mt-3 text-[11px]" style={{ color: 'hsl(var(--inf-muted))' }}>
        Mix de horas ocupadas:{' '}
        <span style={{ color: 'hsl(var(--inf-ink))' }}>
          {pct(a.turnosFijos.horas)}% fijos · {pct(a.variables.horas)}% variables · {pct(a.clases.horas)}% clases.
        </span>{' '}
        Los fijos dan base estable; los variables y las clases son donde está el crecimiento.
      </p>
    </section>
  );
}

function SeccionClasesProfesor({ informe }: { informe: InformeDiarioData }) {
  const { filas, total } = informe.clasesProfesor;
  return (
    <section>
      <p
        className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ color: 'hsl(var(--inf-muted))' }}
      >
        Clases por profesor
      </p>
      {filas.length === 0 ? (
        <Card>
          <p className="text-[11px]" style={{ color: 'hsl(var(--inf-muted))' }}>
            Sin clases dictadas ni inscriptos en el período.
          </p>
        </Card>
      ) : (
        <div
          className="overflow-x-auto rounded-2xl"
          style={{ border: '1px solid hsl(var(--inf-line))', background: 'hsl(var(--inf-card))' }}
        >
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: '1px solid hsl(var(--inf-line))' }}>
                {['Profesor', 'Clases hoy', 'Alumnos', 'Ingresos hoy', 'Clases mes', 'Ingresos mes', '% escuela'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'px-3 py-2 text-[9px] font-bold uppercase tracking-wider',
                        i === 0 ? 'text-left' : 'text-right',
                      )}
                      style={{ color: 'hsl(var(--inf-muted))' }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {[...filas, total].map((f, i) => {
                const esTotal = i === filas.length;
                return (
                  <tr
                    key={f.profesor}
                    style={{
                      borderTop: esTotal ? '1px solid hsl(var(--inf-line))' : undefined,
                      fontWeight: esTotal ? 700 : 400,
                    }}
                  >
                    <td className="px-3 py-2">{f.profesor}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.clasesHoy}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.alumnosHoy}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(f.ingresosHoy)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.clasesMes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(f.ingresosMes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round(f.pctEscuela)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SeccionCaja({ informe }: { informe: InformeDiarioData }) {
  const efectivoApertura = informe.jornadas.reduce(
    (total, jornada) => total + Number(jornada.turno.monto_apertura),
    0,
  );
  const efectivoEsperado = informe.jornadas.reduce(
    (total, jornada) => total + jornada.arqueo.esperado,
    0,
  );
  const jornadasArqueadas = informe.jornadas.filter((j) => j.arqueo.contado !== null);
  const efectivoContado = jornadasArqueadas.reduce(
    (total, jornada) => total + (jornada.arqueo.contado ?? 0),
    0,
  );
  const diferencia = jornadasArqueadas.reduce(
    (total, jornada) => total + (jornada.arqueo.diferencia ?? 0),
    0,
  );
  const hayContado = jornadasArqueadas.length > 0;
  const cobrosEfectivo =
    informe.porMedio.items.find((m) => m.medio === 'efectivo')?.monto ?? 0;
  const maxAbs = Math.max(...informe.porMedio.items.map((m) => Math.abs(m.monto)), 1);

  return (
    <Card className="p-5">
      <Titulo n={2} titulo="Caja y medios de cobro" />
      <ul className="space-y-2">
        {informe.porMedio.items.map((m) => {
          const pct =
            informe.porMedio.total !== 0
              ? Math.round((m.monto / Math.abs(informe.porMedio.total)) * 100)
              : 0;
          const bar = Math.max(4, (Math.abs(m.monto) / maxAbs) * 100);
          return (
            <li key={m.clave} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2 text-[11px]">
              <span>{m.etiqueta}</span>
              <span className="h-1.5 overflow-hidden rounded-full" style={{ background: 'hsl(var(--inf-line))' }}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${bar}%`, background: 'hsl(var(--inf-green-bar))' }}
                />
              </span>
              <span className="tabular-nums">
                {fmtMoney(m.monto)}{' '}
                <span style={{ color: 'hsl(var(--inf-muted))' }}>{pct}%</span>
              </span>
            </li>
          );
        })}
        <li
          className="flex items-baseline justify-between border-t pt-2 text-[12px] font-bold"
          style={{ borderColor: 'hsl(var(--inf-line))' }}
        >
          <span>Total cobrado</span>
          <span className="tabular-nums">{fmtMoney(informe.porMedio.total)}</span>
        </li>
      </ul>

      <div className="mt-4 rounded-xl bg-muted p-3 text-[11px]">
        <p
          className="mb-2 text-[9px] font-bold uppercase tracking-wider"
          style={{ color: 'hsl(var(--inf-muted))' }}
        >
          Efectivo total acumulado en caja
        </p>
        <FilaCaja label="Saldo inicial (apertura)" valor={efectivoApertura} />
        <FilaCaja label="+ Cobros en efectivo del día" valor={cobrosEfectivo} />
        <FilaCaja label="= Efectivo esperado" valor={efectivoEsperado} bold />
        <FilaCaja
          label="Efectivo contado en arqueo"
          valor={hayContado ? efectivoContado : null}
        />
        {hayContado && (
          <FilaCaja
            label="Diferencia"
            valor={diferencia}
            warn={diferencia !== 0}
          />
        )}
      </div>
    </Card>
  );
}

function FilaCaja({
  label,
  valor,
  bold,
  warn,
}: {
  label: string;
  valor: number | null;
  bold?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between py-0.5', bold && 'font-bold')}>
      <span style={{ color: warn ? 'hsl(var(--inf-warn))' : undefined }}>{label}</span>
      <span
        className="tabular-nums"
        style={{ color: warn ? 'hsl(var(--inf-warn))' : undefined }}
      >
        {valor === null ? '—' : fmtMoney(valor)}
      </span>
    </div>
  );
}

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
    <Card className="p-5">
      <Titulo n={3} titulo="Ingresos por unidad de negocio" />
      <table className="w-full text-[11px]">
        <thead>
          <tr>
            {['Unidad', 'Hoy', 'Acum. mes', '% del mes'].map((h, i) => (
              <th
                key={h}
                className={cn(
                  'pb-2 text-[9px] font-bold uppercase tracking-wider',
                  i === 0 ? 'text-left' : 'text-right',
                )}
                style={{ color: 'hsl(var(--inf-muted))' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const mes = acumMes.get(f.key) ?? 0;
            const pctMes = totalMes > 0 ? (mes / totalMes) * 100 : 0;
            return (
              <tr key={f.key} style={{ borderTop: '1px solid hsl(var(--inf-line))' }}>
                <td className="py-1.5">{f.label}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">{fmtMoney(f.hoy)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtMoney(mes)}</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: 'hsl(var(--inf-muted))' }}>
                  {Math.round(pctMes)}%
                </td>
              </tr>
            );
          })}
          <tr className="font-bold" style={{ borderTop: '1px solid hsl(var(--inf-line))' }}>
            <td className="py-2">Total facturado</td>
            <td className="py-2 text-right tabular-nums">{fmtMoney(u.total)}</td>
            <td className="py-2 text-right tabular-nums">{fmtMoney(totalMes)}</td>
            <td className="py-2 text-right tabular-nums">100%</td>
          </tr>
        </tbody>
      </table>
      <Facturacion7Dias dias={informe.facturacion7dias} />
    </Card>
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
    timeZone: AR_TZ,
  });
  return (
    <div className="mt-4">
      <p
        className="mb-2 text-[9px] font-bold uppercase tracking-wider"
        style={{ color: 'hsl(var(--inf-muted))' }}
      >
        Facturación últimos 7 días
      </p>
      <div className="flex h-28 items-end gap-1.5">
        {dias.map((d, i) => {
          const ultimo = i === dias.length - 1;
          return (
            <div key={d.fecha} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[8px] tabular-nums" style={{ color: 'hsl(var(--inf-muted))' }}>
                {d.ingresos >= 1000
                  ? `$${Math.round(d.ingresos / 1000)}k`
                  : fmtMoney(d.ingresos)}
              </span>
              <div
                className="w-full rounded-t-md"
                style={{
                  height: `${Math.max(6, (d.ingresos / maxV) * 72)}px`,
                  background: ultimo
                    ? 'hsl(var(--inf-green-fijo))'
                    : 'hsl(var(--inf-green-soft))',
                }}
                title={fmtMoney(d.ingresos)}
              />
              <span className="text-[8px] capitalize" style={{ color: 'hsl(var(--inf-muted))' }}>
                {fmtDia.format(new Date(`${d.fecha}T12:00:00`)).replace('.', '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeccionMapa({ informe }: { informe: InformeDiarioData }) {
  const mapa = informe.mapa;
  if (!mapa || mapa.horas.length === 0) return null;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold tracking-tight">4 · Mapa de ocupación por cancha y hora</h3>
        <div className="flex flex-wrap gap-3 text-[9px]" style={{ color: 'hsl(var(--inf-muted))' }}>
          {(Object.keys(CELDA_LABEL) as CeldaOcupacion[]).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className={cn('inline-block h-2.5 w-2.5 rounded-[3px]', CELDA_STYLE[k])} />
              {CELDA_LABEL[k]}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5">
          <thead>
            <tr>
              <th className="px-1 pb-1 text-left text-[9px] font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
                {' '}
              </th>
              {mapa.horas.map((h) => (
                <th
                  key={h}
                  className="px-0 pb-1 text-center text-[9px] font-medium tabular-nums"
                  style={{ color: 'hsl(var(--inf-muted))' }}
                >
                  {h}
                </th>
              ))}
              <th className="px-1 pb-1 text-right text-[9px] font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
                Ocup.
              </th>
            </tr>
          </thead>
          <tbody>
            {mapa.canchas.map((c) => (
              <tr key={c.cancha_id}>
                <td className="whitespace-nowrap pr-2 text-[10px] font-medium">{c.nombre}</td>
                {c.celdas.map((celda, i) => (
                  <td key={i} title={CELDA_LABEL[celda]}>
                    <span
                      className={cn('block h-5 w-5 rounded-[4px] sm:w-6', CELDA_STYLE[celda])}
                    />
                  </td>
                ))}
                <td className="pl-2 text-right text-[10px] tabular-nums">
                  {Math.round(c.ocupacionPct)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SeccionFugas({ informe }: { informe: InformeDiarioData }) {
  const f = informe.fugas;
  const filas: Array<{ label: string; detalle: string; monto: number }> = [
    {
      label: 'Cobros divididos incompletos',
      detalle: `${f.pendienteCobro.count} turno${f.pendienteCobro.count === 1 ? '' : 's'}`,
      monto: f.pendienteCobro.total,
    },
    {
      label: 'Cancelaciones',
      detalle: `${f.cancelaciones.count} cancelada${f.cancelaciones.count === 1 ? '' : 's'}`,
      monto: f.cancelaciones.monto,
    },
    {
      label: 'Diferencias de arqueo',
      detalle: `${f.diferenciasArqueo.count} jornada${f.diferenciasArqueo.count === 1 ? '' : 's'}`,
      monto: f.diferenciasArqueo.total,
    },
  ];
  return (
    <Card className="p-5">
      <Titulo n={5} titulo="Fugas de plata" />
      <div>
        {filas.map((x, i) => (
          <div
            key={x.label}
            className="flex items-baseline justify-between py-2 text-[11px]"
            style={{ borderTop: i === 0 ? undefined : '1px solid hsl(var(--inf-line))' }}
          >
            <span>
              {x.label}
              <span className="ml-2" style={{ color: 'hsl(var(--inf-muted))' }}>
                {x.detalle}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{fmtMoney(x.monto)}</span>
          </div>
        ))}
        <div
          className="flex items-baseline justify-between pt-2 text-[12px] font-bold"
          style={{ borderTop: '1px solid hsl(var(--inf-line))' }}
        >
          <span>Total en riesgo o perdido</span>
          <span className="tabular-nums" style={{ color: 'hsl(var(--inf-warn))' }}>
            {fmtMoney(f.total)}
          </span>
        </div>
      </div>
    </Card>
  );
}

function SeccionBuffet({
  informe,
  reponer,
}: {
  informe: InformeDiarioData;
  reponer: Array<{ producto_nombre: string; stock_actual: number }>;
}) {
  const b = informe.buffetShop;
  return (
    <Card className="p-5">
      <Titulo n={6} titulo="Buffet y shop" />
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
            Ventas
          </p>
          <p className="mt-1 text-xl font-extrabold tabular-nums">{fmtMoney(b.ventas)}</p>
        </div>
        <div className="rounded-xl bg-muted p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
            Margen bruto
          </p>
          <p className="mt-1 text-xl font-extrabold tabular-nums">
            {b.margenPct === null ? '—' : `${Math.round(b.margenPct)}%`}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'hsl(var(--inf-muted))' }}>
            Más vendidos
          </p>
          {b.topProductos.length === 0 ? (
            <p style={{ color: 'hsl(var(--inf-muted))' }}>Sin ventas.</p>
          ) : (
            <ul className="space-y-0.5">
              {b.topProductos.slice(0, 4).map((p) => (
                <li key={p.nombre}>
                  {p.nombre}{' '}
                  <span style={{ color: 'hsl(var(--inf-muted))' }}>· {p.cantidad} u.</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p
            className="mb-1 text-[9px] font-bold uppercase tracking-wider"
            style={{ color: 'hsl(var(--inf-warn))' }}
          >
            Reponer hoy
          </p>
          {reponer.length === 0 ? (
            <p style={{ color: 'hsl(var(--inf-muted))' }}>Sin faltantes.</p>
          ) : (
            <ul className="space-y-0.5">
              {reponer.slice(0, 4).map((p) => (
                <li key={p.producto_nombre}>
                  {p.producto_nombre}{' '}
                  <span style={{ color: 'hsl(var(--inf-muted))' }}>
                    · quedan {p.stock_actual}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function SeccionMes({ informe }: { informe: InformeDiarioData }) {
  const m = informe.mes;
  const dia = new Date(`${informe.fecha}T12:00:00`).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'numeric',
    timeZone: AR_TZ,
  });
  const filas: Array<{ label: string; valor: string; extra?: string; tone?: 'pos' | 'neg' }> = [
    { label: `Facturado al ${dia}`, valor: fmtMoney(m.facturadoMes) },
    {
      label: 'Mismo período mes anterior',
      valor: fmtMoney(m.facturadoMesAntMismoPeriodo),
      extra:
        m.variacionPct !== null
          ? `${m.variacionPct >= 0 ? '+' : ''}${m.variacionPct.toFixed(1).replace('.', ',')}%`
          : undefined,
      tone: m.variacionPct === null ? undefined : m.variacionPct >= 0 ? 'pos' : 'neg',
    },
    {
      label: 'Proyección de cierre al ritmo actual',
      valor: m.proyeccionCierre === null ? '—' : fmtMoney(m.proyeccionCierre),
    },
    {
      label: 'Ocupación promedio del mes',
      valor: m.ocupacionMesPct === null ? '—' : `${Math.round(m.ocupacionMesPct)}%`,
    },
  ];
  return (
    <Card className="p-5">
      <Titulo n={7} titulo="Cómo viene el mes" />
      {filas.map((f, i) => (
        <div
          key={f.label}
          className="flex items-baseline justify-between py-2 text-[11px]"
          style={{ borderTop: i === 0 ? undefined : '1px solid hsl(var(--inf-line))' }}
        >
          <span>{f.label}</span>
          <span className="font-bold tabular-nums">
            {f.valor}
            {f.extra && (
              <span
                className="ml-2 text-[10px] font-semibold"
                style={{
                  color:
                    f.tone === 'pos'
                      ? 'hsl(var(--inf-green))'
                      : f.tone === 'neg'
                        ? 'hsl(var(--inf-warn))'
                        : undefined,
                }}
              >
                {f.extra}
              </span>
            )}
          </span>
        </div>
      ))}
    </Card>
  );
}

function SeccionManana({ informe }: { informe: InformeDiarioData }) {
  const m = informe.manana;
  const manana = useMemo(() => {
    const d = new Date(`${informe.fecha}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d;
  }, [informe.fecha]);
  const titulo = `Hoy, ${manana.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    timeZone: AR_TZ,
  })}`;
  if (!m) return null;
  const horasDisp = Math.round(m.minutosDisponibles / 60);
  const horasOcc = Math.round(m.minutosReservados / 60);
  const sugerencia =
    m.horasLibresPico > 2
      ? `Acción sugerida: publicar un partido abierto en las ${m.horasLibresPico} h libres de pico (18–24 h) y avisar por WhatsApp.`
      : null;

  return (
    <div
      className="rounded-2xl p-5 text-white"
      style={{ background: 'hsl(var(--inf-dark))' }}
    >
      <h3 className="mb-4 text-[13px] font-bold capitalize tracking-tight">
        8 · {titulo}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Ya reservado
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">
            {m.pctReservado === null ? '—' : `${Math.round(m.pctReservado)}%`}
          </p>
          <p className="mt-1 text-[10px] text-white/50">
            {horasOcc} de {horasDisp} h
          </p>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Huecos en pico
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{m.horasLibresPico} h</p>
          <p className="mt-1 text-[10px] text-white/50">18–24 h</p>
        </div>
      </div>
      {sugerencia && (
        <p
          className="mt-4 rounded-xl px-3 py-2.5 text-[11px] font-medium"
          style={{ background: 'hsl(var(--inf-action))' }}
        >
          {sugerencia}
        </p>
      )}
    </div>
  );
}

function SeccionAlertas({
  alertas,
}: {
  alertas: ReturnType<typeof generarAlertas>;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'hsl(var(--inf-peach))',
        border: '1px solid hsl(var(--inf-peach-border))',
      }}
    >
      <h3
        className="mb-2 text-[13px] font-bold tracking-tight"
        style={{ color: 'hsl(var(--inf-peach-ink))' }}
      >
        9 · Alertas para resolver
      </h3>
      {alertas.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'hsl(var(--inf-peach-ink))' }}>
          Sin alertas — todo en orden.
        </p>
      ) : (
        <ol className="list-decimal space-y-1 pl-4 text-[12px]" style={{ color: 'hsl(var(--inf-peach-ink))' }}>
          {alertas.map((a, i) => (
            <li key={i}>{a.texto}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
