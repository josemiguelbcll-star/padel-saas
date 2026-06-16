import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth';
import { NuevoGastoDialog } from './NuevoGastoDialog';
import { NuevoOtroIngresoDialog } from './NuevoOtroIngresoDialog';
import { useResumenFinanciero, type ResumenFinanciero } from './hooks/useResumenFinanciero';
import { EERRHeroKpis } from './EERRHeroKpis';
import { EERRChartsRow } from './EERRChartsRow';
import { EERRTable, type DrillKey } from './EERRTable';
import { DrillDownPanel } from './DrillDownPanel';

const mesFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'long',
  year: 'numeric',
});

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function mesAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/**
 * Hub financiero del club — EERR corporativo en cascada.
 *
 * Layout alineado con el dashboard:
 *   - Hero limpio (título + mes + fecha completa).
 *   - 4 KPI cards hero (Ingresos / Egresos / Margen bruto % / Resultado).
 *   - 2 gráficos lado-a-lado (Ingresos por unidad / Top categorías).
 *   - Tabla EERR cascada con comparativo + drill-down.
 *
 * Sólo lectura — los botones "Gasto" / "Ingreso" abren los dialogs de
 * carga manual existentes (sin tocar).
 */
export function FinanzasPage() {
  const { club } = useSession();
  const ahora = new Date();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [gastoOpen, setGastoOpen] = useState(false);
  const [ingresoOpen, setIngresoOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Comparativo: hook actual + mes anterior.
  const queryActual = useResumenFinanciero(anio, mes);
  const { anio: anioAnt, mes: mesAnt } = mesAnterior(anio, mes);
  const queryAnterior = useResumenFinanciero(anioAnt, mesAnt);

  // Drill-down: qué línea está abierta. Cierra a null.
  const [drillKey, setDrillKey] = useState<DrillKey | null>(null);

  function navMes(delta: number): void {
    let nuevoMes = mes + delta;
    let nuevoAnio = anio;
    if (nuevoMes < 1) {
      nuevoMes = 12;
      nuevoAnio -= 1;
    } else if (nuevoMes > 12) {
      nuevoMes = 1;
      nuevoAnio += 1;
    }
    setMes(nuevoMes);
    setAnio(nuevoAnio);
    setDrillKey(null);
  }

  const mesLabel = useMemo(() => {
    const d = new Date(anio, mes - 1, 1);
    const s = mesFmt.format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [anio, mes]);

  const fechaHoyTxt = useMemo(() => {
    const s = fechaCortaFmt.format(ahora);
    return s.charAt(0).toUpperCase() + s.slice(1);
    // ahora capturado al mount; el dashboard hace lo mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const esMesActual = anio === ahora.getFullYear() && mes === ahora.getMonth() + 1;

  async function handleExportPdf() {
    const actual = queryActual.data;
    if (!actual) return;

    setExporting(true);
    try {
      const { jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      const clubNombre = club?.nombre ?? 'Club';

      // Colores institucionales
      const primaryColor = [11, 31, 77] as const; // #0B1F4D
      const secondaryColor = [71, 85, 105] as const; // text-muted-foreground

      // Encabezado
      doc.setFillColor(11, 31, 77);
      doc.rect(14, 12, 182, 1.5, 'F');

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(clubNombre, 14, 22);

      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('Reporte Financiero Mensual', 14, 29);

      doc.setFontSize(9);
      doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      doc.text(`Período: ${mesLabel}`, 14, 35);

      const ahoraFmt = new Intl.DateTimeFormat('es-AR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());
      doc.text(`Generado: ${ahoraFmt}`, 14, 40);

      doc.setDrawColor(226, 232, 240);
      doc.line(14, 44, 196, 44);

      let currentY = 52;

      // --- TABLA 1: Estado de Resultados ---
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text('1. Estado de Resultados (EERR) Corporativo', 14, currentY);
      currentY += 4;

      const currencyFmt = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });

      function variacionPct(act: number, ant: number | null): string {
        if (ant === null || ant === 0) return '—';
        const pct = ((act - ant) / Math.abs(ant)) * 100;
        return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      }

      const eerrRows: any[] = [];
      const addConceptRow = (
        label: string,
        actualVal: number,
        anteriorVal: number | null,
        isSubtotal: boolean = false,
        isHeader: boolean = false,
        hideIfZero: boolean = false
      ) => {
        if (hideIfZero && Math.abs(actualVal) < 0.005 && (anteriorVal === null || Math.abs(anteriorVal) < 0.005)) {
          return;
        }
        const varText = variacionPct(actualVal, anteriorVal);
        eerrRows.push([
          isHeader ? label : (isSubtotal ? `= ${label}` : label),
          currencyFmt.format(Math.round(actualVal)),
          anteriorVal === null ? '—' : currencyFmt.format(Math.round(anteriorVal)),
          varText,
        ]);
      };

      const anterior = queryAnterior.data ?? null;

      const ingresoPorTipo = (tipo: string, src: ResumenFinanciero | null): number =>
        src?.ingresos_por_unidad
          .filter((u) => u.tipo === tipo)
          .reduce((acc, u) => acc + u.monto, 0) ?? 0;

      const ingCanchas = ingresoPorTipo('canchas', actual);
      const ingClases = ingresoPorTipo('clases', actual);
      const ingBuffet = ingresoPorTipo('buffet', actual);
      const ingShop = ingresoPorTipo('shop', actual);

      const ingCanchasAnt = ingresoPorTipo('canchas', anterior);
      const ingClasesAnt = ingresoPorTipo('clases', anterior);
      const ingBuffetAnt = ingresoPorTipo('buffet', anterior);
      const ingShopAnt = ingresoPorTipo('shop', anterior);

      // Filas EERR
      addConceptRow('Ingresos operativos', actual.ingresos_total, anterior?.ingresos_total ?? null, false, true);
      addConceptRow('  Canchas', ingCanchas, anterior ? ingCanchasAnt : null, false, false, true);
      addConceptRow('  Clases', ingClases, anterior ? ingClasesAnt : null, false, false, true);
      addConceptRow('  Buffet', ingBuffet, anterior ? ingBuffetAnt : null, false, false, true);
      addConceptRow('  Shop', ingShop, anterior ? ingShopAnt : null, false, false, true);

      addConceptRow('− Costos directos (mercadería)', -actual.costos_directos, anterior ? -anterior.costos_directos : null, false, false, true);
      addConceptRow('− Gastos directos', -actual.gastos_operativos, anterior ? -anterior.gastos_operativos : null, false, false, true);

      addConceptRow('MARGEN BRUTO', actual.margen_bruto, anterior?.margen_bruto ?? null, true);

      addConceptRow('− Gastos de estructura', -actual.gastos_estructura, anterior ? -anterior.gastos_estructura : null, false, false, true);

      addConceptRow('RESULTADO OPERATIVO (≈ EBITDA)', actual.resultado_operativo, anterior?.resultado_operativo ?? null, true);

      addConceptRow('− Resultados financieros', -actual.gastos_financieros, anterior ? -anterior.gastos_financieros : null, false, false, false);
      addConceptRow('− Otros', -actual.gastos_otros, anterior ? -anterior.gastos_otros : null, false, false, true);

      addConceptRow('RESULTADO NETO', actual.resultado_neto, anterior?.resultado_neto ?? null, true);

      autoTable(doc, {
        startY: currentY,
        head: [['Concepto', 'Mes actual', 'Mes anterior', 'Var.']],
        body: eerrRows,
        styles: { fontSize: 8, font: 'helvetica' },
        headStyles: { fillColor: [11, 31, 77], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { halign: 'right', cellWidth: 35 },
          2: { halign: 'right', cellWidth: 35 },
          3: { halign: 'right', cellWidth: 25 },
        },
        didParseCell: function (data) {
          if (data.row.section === 'body') {
            const rowRaw = data.row.raw as any;
            const label = Array.isArray(rowRaw) ? (rowRaw[0] as string) : '';
            if (
              label === 'Ingresos operativos' ||
              label === '= MARGEN BRUTO' ||
              label === '= RESULTADO OPERATIVO (≈ EBITDA)' ||
              label === '= RESULTADO NETO'
            ) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [241, 245, 249];
              if (label === '= RESULTADO NETO') {
                data.cell.styles.fontSize = 9;
                const cleanVal = actual.resultado_neto;
                if (cleanVal >= 0) {
                  data.cell.styles.textColor = [16, 124, 65];
                } else {
                  data.cell.styles.textColor = [185, 28, 28];
                }
              }
            } else if (label.startsWith('  ')) {
              data.cell.styles.textColor = [71, 85, 105];
            }
          }
        },
      });

      currentY = (doc as any).lastAutoTable?.finalY ?? currentY + 95;
      currentY += 12;

      if (currentY > 210) {
        doc.addPage();
        currentY = 20;
      }

      // --- TABLA 2: Desglose de Ingresos ---
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text('2. Desglose de Ingresos por Unidad de Negocio', 14, currentY);
      currentY += 4;

      const ingresosTotalVal = actual.ingresos_total || 1;
      const ingresosUnidadRows = actual.ingresos_por_unidad.map((u) => {
        const pct = ((u.monto / ingresosTotalVal) * 100).toFixed(1);
        return [
          u.unidad,
          currencyFmt.format(Math.round(u.monto)),
          `${pct}%`,
        ];
      });

      autoTable(doc, {
        startY: currentY,
        head: [['Unidad de Negocio', 'Monto Cobrado', '% Participación']],
        body: ingresosUnidadRows,
        styles: { fontSize: 8, font: 'helvetica' },
        headStyles: { fillColor: [11, 31, 77], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { halign: 'right', cellWidth: 40 },
          2: { halign: 'right', cellWidth: 40 },
        },
        foot: [['Total Ingresos', currencyFmt.format(Math.round(actual.ingresos_total)), '100%']],
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      });

      currentY = (doc as any).lastAutoTable?.finalY ?? currentY + 40;
      currentY += 12;

      if (currentY > 210) {
        doc.addPage();
        currentY = 20;
      }

      // --- TABLA 3: Top Gastos ---
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text('3. Desglose de Egresos: Categorías Principales', 14, currentY);
      currentY += 4;

      const gastosTotalVal = actual.gastos_total || 1;
      const topGastosRows = actual.top_gastos_categoria.map((c) => {
        const pct = ((c.monto / gastosTotalVal) * 100).toFixed(1);
        return [
          c.categoria_nombre,
          c.unidad_nombre,
          currencyFmt.format(Math.round(c.monto)),
          `${pct}%`,
        ];
      });

      if (topGastosRows.length === 0) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
        doc.text('No se registraron egresos/gastos en este período.', 14, currentY);
      } else {
        autoTable(doc, {
          startY: currentY,
          head: [['Categoría', 'Unidad de Destino', 'Monto Egresado', '% S/ Gastos']],
          body: topGastosRows,
          styles: { fontSize: 8, font: 'helvetica' },
          headStyles: { fillColor: [11, 31, 77], textColor: [255, 255, 255], fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 50 },
            2: { halign: 'right', cellWidth: 35 },
            3: { halign: 'right', cellWidth: 25 },
          },
          foot: [['Total Gastos Operativos/Estructura', '', currencyFmt.format(Math.round(actual.gastos_total)), '100%']],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        });
      }

      const filename = `Reporte_Financiero_${anio}_${String(mes).padStart(2, '0')}.pdf`;
      doc.save(filename);
    } catch (err) {
      console.error('Error generando PDF:', err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Hero (estilo dashboard) ───────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Estado de Resultados
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {mesLabel}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {fechaHoyTxt}
          </p>
          <div className="inline-flex overflow-hidden rounded-md border border-border bg-card">
            <button
              type="button"
              onClick={() => navMes(-1)}
              className="px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navMes(1)}
              disabled={esMesActual}
              className="border-l border-border px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={!queryActual.data || exporting}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Exportar PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIngresoOpen(true)}
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Ingreso
          </Button>
          <Button type="button" size="sm" onClick={() => setGastoOpen(true)}>
            <TrendingDown className="h-3.5 w-3.5" />
            Gasto
          </Button>
        </div>
      </header>

      {queryActual.isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Calculando estado de resultados…
        </div>
      )}

      {queryActual.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {queryActual.error.message}
        </div>
      )}

      {queryActual.data && (
        <>
          {/* ── KPIs hero (4 cards) ─────────────────────────────────── */}
          <EERRHeroKpis
            actual={queryActual.data}
            anterior={queryAnterior.data ?? null}
            loading={queryActual.isLoading || queryAnterior.isLoading}
          />

          {/* ── Gráficos (2 columnas, estilo dashboard) ─────────────── */}
          <EERRChartsRow resumen={queryActual.data} anio={anio} mes={mes} />

          {/* ── Tabla EERR con comparativo + drill ──────────────────── */}
          <EERRTable
            actual={queryActual.data}
            anterior={queryAnterior.data ?? null}
            onDrill={(k) => setDrillKey(k)}
          />
        </>
      )}

      <DrillDownPanel
        open={drillKey !== null}
        drillKey={drillKey}
        resumen={queryActual.data ?? null}
        onClose={() => setDrillKey(null)}
      />

      <NuevoGastoDialog open={gastoOpen} onOpenChange={setGastoOpen} />
      <NuevoOtroIngresoDialog open={ingresoOpen} onOpenChange={setIngresoOpen} />
    </div>
  );
}
