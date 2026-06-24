import { useMemo, useState } from 'react';
import { ArrowLeftRight, FileSpreadsheet, FileText, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSession } from '@/features/auth';
import { useCuentas } from '@/features/configuracion/hooks/useCuentas';
import {
  useTransferenciasDia,
  type TransferenciaDia,
} from './hooks/useTransferenciasDia';

const AR_TZ = 'America/Argentina/Buenos_Aires';

const currencyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Hora local AR (los datos vienen en TIMESTAMPTZ; nunca mostrar UTC).
const horaFmt = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: AR_TZ,
});

// Fecha + hora local AR — base de la exportación. Mismo AR_TZ que la tabla
// (la tabla muestra solo HH:MM; el export necesita el día porque el rango
// puede abarcar varias fechas).
const fechaHoraPartsFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: AR_TZ,
});

/** "DD/MM/YYYY HH:MM" en hora local AR (determinista, sin coma de locale). */
function fmtFechaHoraAR(d: Date): string {
  const parts = fechaHoraPartsFmt.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (string puro, sin Date, evita corrimiento UTC). */
function fmtFechaISO(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Hoy en formato ISO 'YYYY-MM-DD' según el día local AR. */
function hoyAR(): string {
  // 'en-CA' produce el formato YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: AR_TZ }).format(new Date());
}

const ORIGEN_META: Record<
  TransferenciaDia['origen'],
  { label: string; cls: string }
> = {
  turno: { label: 'Turno', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  venta: { label: 'Venta', cls: 'bg-green-50 text-green-700 border-green-200' },
  clase: { label: 'Clase', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
};

/**
 * Reporte de cobros por transferencia por período (reconciliación). Une las
 * tres fuentes (turnos + ventas + clases) vía la RPC fn_transferencias_dia.
 *
 * Independiente del turno de caja: funciona aunque no haya caja abierta (no
 * lee useCajaAbierta). El filtro de fecha es por día local AR (lo resuelve la
 * RPC); la búsqueda por nombre es client-side sobre lo ya cargado.
 */
export function TransferenciasPage() {
  const [desde, setDesde] = useState<string>(hoyAR);
  const [hasta, setHasta] = useState<string>(hoyAR);
  const [search, setSearch] = useState('');

  const { club } = useSession();
  const query = useTransferenciasDia({ desde, hasta });
  const cuentasQuery = useCuentas();

  // id → nombre de cuenta (la tabla muestra el nombre, no el id).
  const cuentasMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of cuentasQuery.data ?? []) m.set(c.id, c.nombre);
    return m;
  }, [cuentasQuery.data]);

  // Búsqueda client-side por nombre o "¿quién transfirió?".
  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const q = search.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter(
      (r) =>
        r.nombre.toLowerCase().includes(q) ||
        (r.quien_transfirio?.toLowerCase().includes(q) ?? false),
    );
  }, [query.data, search]);

  const total = useMemo(
    () => filtered.reduce((acc, r) => acc + r.monto, 0),
    [filtered],
  );

  function nombreCuenta(cuentaId: number | null): string {
    if (cuentaId === null) return '—';
    return cuentasMap.get(cuentaId) ?? `Cuenta #${cuentaId}`;
  }

  const fileBase = `transferencias_${desde}_${hasta}`;
  const HEADERS = [
    'Fecha y hora',
    'Origen',
    'Nombre',
    '¿Quién transfirió?',
    'Monto',
    'Cuenta',
  ] as const;

  // Exporta el array FILTRADO (lo que el usuario ve), no los datos crudos.
  // Excel: SheetJS. Monto como NÚMERO (Excel puede sumar). Fila TOTAL al pie.
  // xlsx se carga lazy (solo al exportar) para no pesar en el bundle inicial.
  async function handleExportExcel() {
    if (filtered.length === 0) return;
    const XLSX = await import('xlsx');
    const aoa: (string | number)[][] = [
      [...HEADERS],
      ...filtered.map((r) => [
        fmtFechaHoraAR(new Date(r.fecha_hora)),
        ORIGEN_META[r.origen].label,
        r.nombre,
        r.quien_transfirio ?? '—',
        r.monto, // número, no string → suma en Excel
        nombreCuenta(r.cuenta_id),
      ]),
      ['', '', 'TOTAL', '', total, ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transferencias');
    XLSX.writeFile(wb, `${fileBase}.xlsx`);
  }

  // PDF: jsPDF + autotable. Encabezado (club + título + período + generado),
  // tabla, y fila TOTAL en el foot de autotable. Portrait alcanza para 6 cols.
  // jspdf + autotable se cargan lazy (solo al exportar).
  async function handleExportPdf() {
    if (filtered.length === 0) return;
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const clubNombre = club?.nombre ?? 'Club';

    doc.setFontSize(14);
    doc.text(clubNombre, 14, 16);
    doc.setFontSize(11);
    doc.text('Reporte de Transferencias', 14, 23);
    doc.setFontSize(9);
    doc.text(
      `Período: ${fmtFechaISO(desde)} a ${fmtFechaISO(hasta)}`,
      14,
      29,
    );
    doc.text(`Generado: ${fmtFechaHoraAR(new Date())}`, 14, 34);

    autoTable(doc, {
      startY: 39,
      head: [[...HEADERS]],
      body: filtered.map((r) => [
        fmtFechaHoraAR(new Date(r.fecha_hora)),
        ORIGEN_META[r.origen].label,
        r.nombre,
        r.quien_transfirio ?? '—',
        currencyFmt.format(r.monto),
        nombreCuenta(r.cuenta_id),
      ]),
      foot: [['', '', 'TOTAL', '', currencyFmt.format(total), '']],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] }, // azul, alineado al lenguaje visual
      footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 4: { halign: 'right' } },
    });

    doc.save(`${fileBase}.pdf`);
  }

  const hayDatos = filtered.length > 0;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
          Transferencias
        </h2>
        <p className="text-sm text-muted-foreground">
          Reporte de cobros por transferencia del período (turnos, ventas y
          clases). Sirve para reconciliar contra el extracto bancario. Es
          independiente del turno de caja.
        </p>
      </header>

      {/* Controles: rango de fechas + buscador + exportación */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="transf-desde" className="text-xs">
              Desde
            </Label>
            <Input
              id="transf-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className="h-8 w-[9.5rem] text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="transf-hasta" className="text-xs">
              Hasta
            </Label>
            <Input
              id="transf-hasta"
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
              className="h-8 w-[9.5rem] text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="transf-buscar" className="text-xs">
              Buscar
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="transf-buscar"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nombre o quién transfirió…"
                className="h-8 w-56 pl-7 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void handleExportExcel();
            }}
            disabled={!hayDatos}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Exportar Excel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void handleExportPdf();
            }}
            disabled={!hayDatos}
          >
            <FileText className="h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* Estados de carga / error */}
      {query.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Cargando transferencias…
        </div>
      )}

      {query.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {query.error.message}
        </div>
      )}

      {/* Estado vacío */}
      {!query.isLoading && !query.error && !hayDatos && (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ArrowLeftRight className="h-6 w-6" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">
            No hay transferencias en este período
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {search.trim() !== ''
              ? 'Probá ajustar la búsqueda o el rango de fechas.'
              : 'Cambiá el rango de fechas para ver otros cobros por transferencia.'}
          </p>
        </div>
      )}

      {/* Tabla (Desktop) */}
      {!query.isLoading && !query.error && hayDatos && (
        <div className="hidden md:block overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Hora</th>
                <th className="px-3 py-2 font-medium">Origen</th>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">¿Quién transfirió?</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th>
                <th className="px-3 py-2 font-medium">Cuenta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const meta = ORIGEN_META[r.origen];
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/30"
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {horaFmt.format(new Date(r.fecha_hora))}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          meta.cls,
                        )}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground">{r.nombre}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.quien_transfirio ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-foreground">
                      {currencyFmt.format(r.monto)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {nombreCuenta(r.cuenta_id)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <td
                  className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  colSpan={4}
                >
                  Total ({filtered.length}{' '}
                  {filtered.length === 1 ? 'transferencia' : 'transferencias'})
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-base font-semibold tabular-nums text-foreground">
                  {currencyFmt.format(total)}
                </td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Tarjetas (Mobile) */}
      {!query.isLoading && !query.error && hayDatos && (
        <div className="md:hidden space-y-3">
          {filtered.map((r) => {
            const meta = ORIGEN_META[r.origen];
            return (
              <div
                key={r.id}
                className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs text-muted-foreground font-mono">
                      {horaFmt.format(new Date(r.fecha_hora))} hs
                    </span>
                    <h3 className="font-semibold text-foreground text-sm mt-0.5">
                      {r.nombre}
                    </h3>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium mt-1.5',
                        meta.cls,
                      )}
                    >
                      {meta.label}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground block">Monto</span>
                    <span className="font-bold text-foreground tabular-nums text-base">
                      {currencyFmt.format(r.monto)}
                    </span>
                  </div>
                </div>

                {/* Detalles secundarios */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs border-t border-border/60 pt-3 text-muted-foreground">
                  <div>
                    <span className="block text-[10px] uppercase font-medium tracking-wide text-muted-foreground/60">¿Quién transfirió?</span>
                    <span className="text-foreground">{r.quien_transfirio ?? '—'}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase font-medium tracking-wide text-muted-foreground/60 text-right">Cuenta</span>
                    <span className="text-foreground block text-right">{nombreCuenta(r.cuenta_id)}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Tarjeta de Total */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 shadow-sm flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total ({filtered.length} {filtered.length === 1 ? 'transf.' : 'transfs.'})
            </span>
            <span className="text-lg font-bold text-foreground tabular-nums">
              {currencyFmt.format(total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
