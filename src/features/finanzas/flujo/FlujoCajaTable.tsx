import { cn } from '@/lib/utils';
import type { Granularidad } from '../utils/clavePeriodo';
import type { FilaFlujo, FlujoCombinado } from '../utils/combinarFlujo';

// ── Formato ────────────────────────────────────────────────────────────
const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
function fmtMoney(n: number): string {
  return money.format(Math.round(n));
}
/** Neto/variación con signo explícito (− unicode). 0 → "—". */
function fmtSigned(n: number): string {
  if (Math.round(n) === 0) return '—';
  return `${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`;
}

const mesFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' });
const diaFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const diaCortoFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit' });

function parseLocal(iso: string): Date {
  const p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function formatPeriodo(iso: string, gran: Granularidad): string {
  const d = parseLocal(iso);
  if (gran === 'month') return cap(mesFmt.format(d));
  if (gran === 'week') return `Sem. ${diaCortoFmt.format(d)}`;
  return cap(diaFmt.format(d));
}

// ── Badges ───────────────────────────────────────────────────────────────
function BadgeEnCurso() {
  return (
    <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
      En curso
    </span>
  );
}
function BadgeProyectado() {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Proyectado
    </span>
  );
}

// ── Celdas de monto ────────────────────────────────────────────────────────
function IngresoCell({ v }: { v: number }) {
  return (
    <td className="px-3 py-3 text-right align-top tabular-nums">
      {Math.round(v) === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="text-emerald-600 dark:text-emerald-400">{fmtMoney(v)}</span>
      )}
    </td>
  );
}
function EgresoCell({ v }: { v: number }) {
  return (
    <td className="px-3 py-3 text-right align-top tabular-nums">
      {Math.round(v) === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="text-destructive">{`−${fmtMoney(v)}`}</span>
      )}
    </td>
  );
}
function NetoCell({ v }: { v: number }) {
  const cls =
    Math.round(v) === 0
      ? 'text-muted-foreground'
      : v > 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-destructive';
  return (
    <td className={cn('px-3 py-3 text-right align-top tabular-nums', cls)}>
      {fmtSigned(v)}
    </td>
  );
}

// ── Filas ──────────────────────────────────────────────────────────────────
function FilaFlujoRows({ f, gran }: { f: FilaFlujo; gran: Granularidad }) {
  const esProy = f.tipo === 'proyectado';
  const esActual = f.tipo === 'actual';

  return (
    <>
      <tr
        className={cn(
          'border-b border-border/50 transition-colors last:border-b-0',
          esProy && 'bg-muted/10 italic',
          esActual && 'bg-primary/5',
        )}
      >
        <td className="px-4 py-3 align-top">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'font-medium',
                esProy ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {formatPeriodo(f.periodo, gran)}
            </span>
            {esActual && <BadgeEnCurso />}
            {esProy && <BadgeProyectado />}
          </div>
        </td>
        <td
          className={cn(
            'px-3 py-3 text-right align-top tabular-nums',
            esProy ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {fmtMoney(f.saldoApertura)}
        </td>
        <IngresoCell v={f.ingresos} />
        <EgresoCell v={f.egresos} />
        <NetoCell v={f.neto} />
        {/* Saldo de cierre — columna PROTAGONISTA. Negativo en destructive
            (hito de liquidez visible). */}
        <td
          className={cn(
            'px-4 py-3 text-right align-top font-semibold tabular-nums',
            f.saldoCierre < 0 ? 'text-destructive' : 'text-foreground',
          )}
        >
          {fmtMoney(f.saldoCierre)}
        </td>
      </tr>

      {/* Período en curso: línea secundaria con el remanente PROYECTADO del
          período (real-a-hoy arriba, proyectado a fin de período acá). La
          cadena futura arranca en saldoCierreProy. */}
      {esActual && f.proyectadoRestante && (
        <tr className="border-b border-border/50 bg-primary/5 text-xs italic text-muted-foreground">
          <td className="px-4 py-1.5 pl-8 align-top">↳ Proyectado restante del período</td>
          <td className="px-3 py-1.5" aria-hidden="true" />
          <td className="px-3 py-1.5 text-right tabular-nums">
            {Math.round(f.proyectadoRestante.ingresos) === 0
              ? '—'
              : fmtMoney(f.proyectadoRestante.ingresos)}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums">
            {Math.round(f.proyectadoRestante.egresos) === 0
              ? '—'
              : `−${fmtMoney(f.proyectadoRestante.egresos)}`}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums">
            {fmtSigned(f.proyectadoRestante.neto)}
          </td>
          <td
            className={cn(
              'px-4 py-1.5 text-right font-medium tabular-nums',
              f.proyectadoRestante.saldoCierreProy < 0 ? 'text-destructive' : '',
            )}
          >
            {fmtMoney(f.proyectadoRestante.saldoCierreProy)}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Tabla ──────────────────────────────────────────────────────────────────
interface FlujoCajaTableProps {
  combinado: FlujoCombinado;
  granularidad: Granularidad;
}

export function FlujoCajaTable({ combinado, granularidad }: FlujoCajaTableProps) {
  if (combinado.filas.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Sin datos de flujo para este rango.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-semibold">Período</th>
              <th className="px-3 py-2 text-right font-semibold">Saldo apertura</th>
              <th className="px-3 py-2 text-right font-semibold">Ingresos</th>
              <th className="px-3 py-2 text-right font-semibold">Egresos</th>
              <th className="px-3 py-2 text-right font-semibold">Neto</th>
              <th className="px-4 py-2 text-right font-semibold">Saldo cierre</th>
            </tr>
          </thead>
          <tbody>
            {combinado.filas.map((f) => (
              <FilaFlujoRows key={f.periodo} f={f} gran={granularidad} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
