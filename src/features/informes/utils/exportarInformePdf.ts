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
  let y = 14;

  doc.setFontSize(14);
  doc.text(datos.titulo, 14, y);
  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `${datos.nombreClub ? datos.nombreClub + ' · ' : ''}${datos.fechaLabel}`,
    14,
    y,
  );
  y += 5;
  doc.text(
    `Generado ${new Date().toLocaleString('es-AR', { timeZone: AR_TZ })}`,
    14,
    y,
  );
  for (const l of datos.lineasEncabezado) {
    y += 4;
    doc.text(l, 14, y);
  }
  doc.setTextColor(0);
  y += 7;

  const lastY = () =>
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY;

  autoTable(doc, {
    startY: y,
    head: [['Indicador', 'Valor', 'Detalle']],
    body: datos.kpis.map((k) => [
      k.label,
      typeof k.valor === 'number' ? fmtMoney(k.valor) : (k.valor ?? '—'),
      k.nota,
    ]),
    theme: 'grid',
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 40, 40] },
  });
  y = lastY() + 6;

  autoTable(doc, {
    startY: y,
    head: [['Medio de pago', 'Cobros', 'Monto', '%']],
    body: datos.porMedio.items.map((m) => [
      MEDIO_LABEL[m.medio],
      String(m.count),
      fmtMoney(m.monto),
      datos.porMedio.total !== 0
        ? `${Math.round((m.monto / Math.abs(datos.porMedio.total)) * 100)}%`
        : '—',
    ]),
    theme: 'striped',
    styles: { fontSize: 9 },
  });
  y = lastY() + 6;

  if (datos.arqueo) {
    const a = datos.arqueo;
    autoTable(doc, {
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
      theme: 'striped',
      styles: { fontSize: 9 },
    });
    y = lastY() + 6;
  }

  if (datos.jornadas && datos.jornadas.length > 0) {
    autoTable(doc, {
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
      theme: 'striped',
      styles: { fontSize: 8 },
    });
    y = lastY() + 6;
  }

  autoTable(doc, {
    startY: y,
    head: [['Unidad de negocio', 'Monto', '%']],
    body: [
      ['Canchas (alquiler)', fmtMoney(datos.unidades.canchas), pct(datos.unidades.canchas, datos.unidades.total)],
      ['Clases', fmtMoney(datos.unidades.clases), pct(datos.unidades.clases, datos.unidades.total)],
      ['Buffet (turno + mostrador)', fmtMoney(datos.unidades.buffet), pct(datos.unidades.buffet, datos.unidades.total)],
      ['Shop (turno + mostrador)', fmtMoney(datos.unidades.shop), pct(datos.unidades.shop, datos.unidades.total)],
      ['Total', fmtMoney(datos.unidades.total), '100%'],
    ],
    theme: 'striped',
    styles: { fontSize: 9 },
  });
  y = lastY() + 6;

  if (datos.topProductos.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Más vendidos', 'Unidades', 'Total']],
      body: datos.topProductos.map((p) => [
        p.nombre,
        String(p.cantidad),
        fmtMoney(p.total),
      ]),
      theme: 'striped',
      styles: { fontSize: 9 },
    });
    y = lastY() + 6;
  }

  autoTable(doc, {
    startY: y,
    head: [['Contexto del club', 'Valor']],
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
    theme: 'striped',
    styles: { fontSize: 9 },
  });
  y = lastY() + 6;

  autoTable(doc, {
    startY: y,
    head: [['Fecha/hora', 'Tipo', 'Detalle', 'Medio', 'Monto']],
    body: datos.cobros.map((c) => [
      fmtFechaHora(c.fecha_hora),
      ORIGEN_LABEL[c.origen],
      c.descripcion,
      MEDIO_LABEL[c.medio_pago],
      fmtMoney(c.monto),
    ]),
    theme: 'striped',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [40, 40, 40] },
  });

  const slug = datos.fechaLabel.replace(/[^\d]+/g, '-').replace(/^-|-$/g, '');
  doc.save(`informe-${slug || 'caja'}.pdf`);
}
