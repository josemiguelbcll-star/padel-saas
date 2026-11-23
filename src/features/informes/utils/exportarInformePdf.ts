/**
 * Exportación a PDF del informe de caja (jsPDF + autotable, carga lazy
 * desde el caller). Recibe los mismos datos que `InformeViewProps` de
 * la página — se define un tipo estructural acá para no acoplar utils
 * con el componente.
 */
import {
  MEDIO_LABEL,
  type ArqueoCalculado,
  type CobroTurno,
  type IngresoPorMedioInforme,
  type ProductoVendido,
  type TotalesUnidad,
} from './informeTurno';
import type { JornadaArqueo } from '../hooks/useInformeDia';
import { dataUrlLogoMatchgo, dibujarLogoPdf } from './logoMatchgoPdf';

type ColorRgb = [number, number, number];

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

const fechaCortaFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: AR_TZ,
});

const horaFmt = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: AR_TZ,
});

function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  return `${fechaCortaFmt.format(d)} ${horaFmt.format(d)}`;
}

const ORIGEN_LABEL: Record<CobroTurno['origen'], string> = {
  reserva: 'Reserva',
  clase: 'Clase',
  venta: 'Venta',
  otro_ingreso: 'Otro ingreso',
};

export interface InformePdfData {
  titulo: string;
  nombreClub: string;
  fechaLabel: string;
  lineasEncabezado: string[];
  kpis: Array<{ label: string; valor: number | string | null; nota: string }>;
  porMedio: { items: IngresoPorMedioInforme[]; total: number };
  arqueo?: ArqueoCalculado;
  jornadas?: JornadaArqueo[];
  unidades: TotalesUnidad;
  topProductos: ProductoVendido[];
  cobros: CobroTurno[];
  contexto: {
    ocupacionPct: number | null;
    turnosTotales: number;
    reservasCount: number;
  };
}

function pct(parte: number, total: number): string {
  return total > 0 ? `${Math.round((parte / total) * 100)}%` : '—';
}

/** Genera y descarga el PDF del informe. Lazy-importa jspdf/autotable. */
export async function exportarInformePdf(datos: InformePdfData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setDisplayMode(1.25);
  const logo = await dataUrlLogoMatchgo();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 54;

  doc.setFillColor(20, 83, 68);
  doc.rect(0, 0, pageWidth, 48, 'F');
  dibujarLogoPdf(doc, logo, margin, 5);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(datos.nombreClub || 'Informe de caja', margin, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(datos.titulo, margin, 28);
  doc.text(datos.fechaLabel, margin, 34);
  doc.setFontSize(8);
  doc.text(
    `Generado ${new Date().toLocaleString('es-AR', { timeZone: AR_TZ })}`,
    margin,
    40,
  );
  doc.setTextColor(0);
  y = 54;

  for (const linea of datos.lineasEncabezado) {
    doc.setFontSize(9);
    doc.setTextColor(70);
    doc.text(linea, margin, y);
    y += 5;
  }
  doc.setTextColor(0);
  y += 2;

  const lastY = () =>
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY;
  const sectionTitle = (title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 83, 68);
    doc.text(title.toUpperCase(), margin, y);
    doc.setDrawColor(20, 83, 68);
    doc.setLineWidth(0.4);
    doc.line(margin, y + 1.5, pageWidth - margin, y + 1.5);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    y += 5;
  };
  const tableStyles = {
    theme: 'striped' as const,
    styles: { fontSize: 8, cellPadding: 2.2, textColor: [45, 55, 55] as ColorRgb },
    headStyles: { fillColor: [20, 83, 68] as ColorRgb, textColor: [255, 255, 255] as ColorRgb, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [240, 247, 244] as ColorRgb },
    margin: { left: margin, right: margin },
  };

  sectionTitle('Resumen de la jornada');
  autoTable(doc, {
    ...tableStyles,
    startY: y,
    head: [['Indicador', 'Valor', 'Detalle']],
    body: datos.kpis.map((k) => [
      k.label,
      typeof k.valor === 'number' ? fmtMoney(k.valor) : (k.valor ?? '—'),
      k.nota,
    ]),
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  });
  y = lastY() + 6;

  sectionTitle('Cobros por medio de pago');
  autoTable(doc, {
    ...tableStyles,
    startY: y,
    head: [['Medio de pago', 'Cobros', 'Monto', '%']],
    body: datos.porMedio.items.map((m) => [
      m.etiqueta,
      String(m.count),
      fmtMoney(m.monto),
      datos.porMedio.total !== 0
        ? `${Math.round((m.monto / Math.abs(datos.porMedio.total)) * 100)}%`
        : '—',
    ]),
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' }, 3: { halign: 'right' } },
    foot: [['TOTAL', String(datos.porMedio.items.reduce((sum, item) => sum + item.count, 0)), fmtMoney(datos.porMedio.total), '100%']],
    showFoot: 'lastPage',
    footStyles: { fillColor: [20, 83, 68], textColor: [255, 255, 255], fontStyle: 'bold' },
  });
  y = lastY() + 6;

  if (datos.arqueo) {
    const a = datos.arqueo;
    sectionTitle('Arqueo de efectivo');
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [['Caja de la jornada (efectivo)', 'Monto']],
      body: [
        ['Saldo inicial', fmtMoney(a.apertura)],
        ['+ Cobros de reservas', fmtMoney(a.cobrosReservas)],
        ['+ Cobros de ventas', fmtMoney(a.cobrosVentas)],
        ['+ Cobros de clases', fmtMoney(a.cobrosClases)],
        ['+ Ajustes positivos', fmtMoney(a.ajustesPositivos)],
        ['− Salidas y pagos', fmtMoney(-a.salidas)],
        ['= Efectivo esperado', fmtMoney(a.esperado)],
        ['Efectivo contado', a.contado === null ? '—' : fmtMoney(a.contado)],
        ['Diferencia', a.diferencia === null ? '—' : fmtMoney(a.diferencia)],
      ],
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index >= 6) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = lastY() + 6;
  }

  if (datos.jornadas && datos.jornadas.length > 0) {
    sectionTitle('Jornadas del día');
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [
        [
          'Jornada',
          'Apertura',
          'Cierre',
          'Esperado',
          'Contado',
          'Diferencia',
          'Estado',
        ],
      ],
      body: datos.jornadas.map((j) => [
        `#${j.turno.id}`,
        horaFmt.format(new Date(j.turno.abierta_en)),
        j.turno.cerrada_en
          ? horaFmt.format(new Date(j.turno.cerrada_en))
          : '—',
        fmtMoney(j.arqueo.esperado),
        j.arqueo.contado === null ? '—' : fmtMoney(j.arqueo.contado),
        j.arqueo.diferencia === null ? '—' : fmtMoney(j.arqueo.diferencia),
        j.turno.cerrada_en ? 'Cerrada' : 'Abierta',
      ]),
      styles: { ...tableStyles.styles, fontSize: 7 },
    });
    y = lastY() + 6;
  }

  sectionTitle('Ingresos por unidad de negocio');
  autoTable(doc, {
    ...tableStyles,
    startY: y,
    head: [['Unidad de negocio', 'Monto', '%']],
    body: [
      ['Canchas (alquiler)', fmtMoney(datos.unidades.canchas), pct(datos.unidades.canchas, datos.unidades.total)],
      ['Clases', fmtMoney(datos.unidades.clases), pct(datos.unidades.clases, datos.unidades.total)],
      ['Buffet (turno + mostrador)', fmtMoney(datos.unidades.buffet), pct(datos.unidades.buffet, datos.unidades.total)],
      ['Shop (turno + mostrador)', fmtMoney(datos.unidades.shop), pct(datos.unidades.shop, datos.unidades.total)],
      ['Total', fmtMoney(datos.unidades.total), '100%'],
    ],
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' }, 2: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === 4) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [220, 238, 230];
      }
    },
  });
  y = lastY() + 6;

  if (datos.topProductos.length > 0) {
    sectionTitle('Productos más vendidos');
    autoTable(doc, {
      ...tableStyles,
      startY: y,
      head: [['Más vendidos', 'Unidades', 'Total']],
      body: datos.topProductos.map((p) => [
        p.nombre,
        String(p.cantidad),
        fmtMoney(p.total),
      ]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } },
    });
    y = lastY() + 6;
  }

  sectionTitle('Contexto del club');
  autoTable(doc, {
    ...tableStyles,
    startY: y,
    head: [['Indicador', 'Valor']],
    body: [
      [
        'Ocupación de canchas',
        datos.contexto.ocupacionPct === null
          ? '—'
          : `${Math.round(datos.contexto.ocupacionPct)}%`,
      ],
      [
        'Turnos totales (reservas + clases)',
        String(datos.contexto.turnosTotales),
      ],
      ['Reservas del día', String(datos.contexto.reservasCount)],
    ],
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  });
  y = lastY() + 6;

  sectionTitle('Detalle de cobros');
  autoTable(doc, {
    ...tableStyles,
    startY: y,
    head: [['Fecha/hora', 'Tipo', 'Detalle', 'Medio', 'Monto']],
    body: datos.cobros.map((c) => [
      fmtFechaHora(c.fecha_hora),
      ORIGEN_LABEL[c.origen],
      c.descripcion,
      c.cuenta_nombre ?? MEDIO_LABEL[c.medio_pago],
      fmtMoney(c.monto),
    ]),
    styles: { ...tableStyles.styles, fontSize: 7 },
    columnStyles: { 4: { halign: 'right', fontStyle: 'bold' } },
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `${datos.nombreClub || 'Informe de caja'} · Página ${page} de ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 7,
      { align: 'center' },
    );
  }

  const slug = datos.fechaLabel.replace(/[^\d]+/g, '-').replace(/^-|-$/g, '');
  doc.save(`informe-${slug || 'caja'}.pdf`);
}
