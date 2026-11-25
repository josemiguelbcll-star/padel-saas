/**
 * PDF del informe diario del dueño. Dibuja el mismo contenido que
 * `InformeDiarioView` con jsPDF (sin diálogo de imprimir).
 */
import type { InformeDiarioData } from '../hooks/useInformeDia';
import { generarAlertas } from './informeDiario';

const CREAM: [number, number, number] = [243, 239, 230];
const CARD: [number, number, number] = [252, 251, 247];
const INK: [number, number, number] = [31, 28, 24];
const MUTED: [number, number, number] = [122, 114, 104];
const LINE: [number, number, number] = [226, 220, 208];
const GREEN: [number, number, number] = [47, 107, 74];
const GREEN_BAR: [number, number, number] = [90, 148, 110];
const GREEN_SOFT: [number, number, number] = [168, 196, 168];
const BLUE: [number, number, number] = [74, 127, 212];
const PEACH: [number, number, number] = [251, 232, 212];
const PEACH_INK: [number, number, number] = [166, 90, 42];
const DARK: [number, number, number] = [26, 33, 28];
const WARN: [number, number, number] = [196, 106, 42];

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$ ${fmt.format(Math.abs(Math.round(n)))}`;
}

const M = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - M * 2;

export async function exportarInformeDiarioPdf(
  informe: InformeDiarioData,
  nombreClub: string,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const paintPage = () => {
    doc.setFillColor(...CREAM);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  };
  paintPage();

  let y = 16;
  const ensure = (need: number) => {
    if (y + need > PAGE_H - 12) {
      doc.addPage();
      paintPage();
      y = 16;
    }
  };

  const setInk = () => doc.setTextColor(...INK);
  const setMuted = () => doc.setTextColor(...MUTED);

  const fecha = new Date(`${informe.fecha}T12:00:00`);
  const titulo = `Cierre del ${fecha.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })}`;
  const alertas = generarAlertas({
    fugas: informe.fugas,
    jornadasAbiertas: informe.jornadas.filter((j) => !j.turno.cerrada_en).length,
    productosStockBajo: 0,
    pendientesCobroCount: informe.pendientesCobroCount,
  });

  setMuted();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(
    `INFORME DIARIO DEL DUEÑO${nombreClub ? ` · ${nombreClub.toUpperCase()}` : ''}`,
    M,
    y,
  );
  y += 8;
  setInk();
  doc.setFontSize(20);
  doc.text(titulo.charAt(0).toUpperCase() + titulo.slice(1), M, y);
  y += 6;
  setMuted();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const ctx = informe.contexto;
  doc.text(
    `${ctx.canchasActivas} canchas · horario ${ctx.horaApertura?.slice(0, 5) ?? '—'}–${ctx.horaCierre?.slice(0, 5) ?? '—'} h`,
    M,
    y,
  );
  if (alertas.length > 0) {
    doc.setFillColor(...PEACH);
    doc.roundedRect(PAGE_W - M - 58, 12, 58, 8, 4, 4, 'F');
    doc.setTextColor(...PEACH_INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(`Día con ${alertas.length} puntos a revisar`, PAGE_W - M - 29, 17, {
      align: 'center',
    });
  }
  y += 10;

  const kpis: Array<{ label: string; valor: string; nota: string; peach?: boolean }> = [
    {
      label: 'FACTURADO DEL DÍA',
      valor: money(informe.facturacion),
      nota: `Cobrado hoy: ${money(informe.cobrado)} · ${informe.cobros.length} cobros`,
    },
    {
      label: 'OCUPACIÓN DE CANCHAS',
      valor:
        informe.ocupacion.porcentaje === null
          ? '—'
          : `${Math.round(informe.ocupacion.porcentaje)}%`,
      nota: informe.ocupacion.pico
        ? `Pico ${informe.ocupacion.pico.etiqueta}: ${Math.round(informe.ocupacion.pico.pct)}%`
        : `${Math.round(informe.ocupacion.minutosOcupados / 60)} h ocupadas`,
    },
    {
      label: 'INGRESO POR HORA DISP.',
      valor:
        informe.ingresoHoraDisponible === null
          ? '—'
          : money(informe.ingresoHoraDisponible),
      nota:
        informe.ingresoHoraOcupada !== null
          ? `Por hora ocupada: ${money(informe.ingresoHoraOcupada)}`
          : 'Canchas + clases',
    },
    {
      label: 'PENDIENTE DE COBRO',
      valor: money(informe.pendienteCobro.total),
      nota: `${informe.pendienteCobro.count} turnos con saldo`,
      peach: true,
    },
  ];
  const gap = 3;
  const kpiW = (CONTENT_W - gap * 3) / 4;
  kpis.forEach((k, i) => {
    const x = M + i * (kpiW + gap);
    doc.setFillColor(...(k.peach ? PEACH : CARD));
    doc.roundedRect(x, y, kpiW, 28, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...(k.peach ? PEACH_INK : MUTED));
    doc.text(k.label, x + 3, y + 5);
    doc.setFontSize(11);
    doc.setTextColor(...(k.peach ? PEACH_INK : INK));
    doc.text(k.valor, x + 3, y + 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...(k.peach ? PEACH_INK : MUTED));
    doc.text(k.nota, x + 3, y + 22, { maxWidth: kpiW - 6 });
  });
  y += 34;

  const sectionTitle = (n: number, title: string) => {
    ensure(10);
    setInk();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${n} · ${title}`, M, y);
    y += 5;
  };

  sectionTitle(1, 'Actividad del día');
  const a = informe.actividad;
  const acts = [
    { l: 'Turnos fijos', v: String(a.turnosFijos.count), s: `${a.turnosFijos.horas} h · ${money(a.turnosFijos.monto)}` },
    { l: 'Turnos variables', v: String(a.variables.count), s: `${a.variables.horas} h · ${money(a.variables.monto)}` },
    { l: 'Clases con profe', v: String(a.clases.count), s: `${a.clases.horas} h · ${a.clases.alumnos} alumnos` },
    { l: 'Insumos', v: `${a.insumos.unidades} u.`, s: money(a.insumos.monto) },
  ];
  const actW = (CONTENT_W - gap * 3) / 4;
  acts.forEach((c, i) => {
    const x = M + i * (actW + gap);
    doc.setFillColor(...CARD);
    doc.roundedRect(x, y, actW, 22, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    setMuted();
    doc.text(c.l.toUpperCase(), x + 3, y + 5);
    setInk();
    doc.setFontSize(12);
    doc.text(c.v, x + 3, y + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    setMuted();
    doc.text(c.s, x + 3, y + 18, { maxWidth: actW - 6 });
  });
  y += 26;

  if (informe.clasesProfesor.filas.length > 0) {
    ensure(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setMuted();
    doc.text('CLASES POR PROFESOR', M, y);
    y += 4;
    const { default: autoTable } = await import('jspdf-autotable');
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Profesor', 'Clases hoy', 'Alumnos', 'Ingresos hoy', 'Clases mes', 'Ingresos mes', '%']],
      body: [
        ...informe.clasesProfesor.filas.map((f) => [
          f.profesor,
          String(f.clasesHoy),
          String(f.alumnosHoy),
          money(f.ingresosHoy),
          String(f.clasesMes),
          money(f.ingresosMes),
          `${Math.round(f.pctEscuela)}%`,
        ]),
        [
          'Total',
          String(informe.clasesProfesor.total.clasesHoy),
          String(informe.clasesProfesor.total.alumnosHoy),
          money(informe.clasesProfesor.total.ingresosHoy),
          String(informe.clasesProfesor.total.clasesMes),
          money(informe.clasesProfesor.total.ingresosMes),
          '100%',
        ],
      ],
      theme: 'plain',
      styles: { fontSize: 7, textColor: INK, cellPadding: 1.4, fillColor: CARD },
      headStyles: { textColor: MUTED, fontStyle: 'bold', fontSize: 6 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  ensure(55);
  const colW = (CONTENT_W - gap) / 2;
  const leftX = M;
  const rightX = M + colW + gap;
  const colTop = y;

  sectionTitle(2, 'Caja y medios de cobro');
  const boxY = y;
  doc.setFillColor(...CARD);
  doc.roundedRect(leftX, boxY, colW, 52, 2, 2, 'F');
  let ly = boxY + 6;
  const maxMedio = Math.max(...informe.porMedio.items.map((m) => Math.abs(m.monto)), 1);
  informe.porMedio.items.forEach((m) => {
    const pct =
      informe.porMedio.total !== 0
        ? Math.round((m.monto / Math.abs(informe.porMedio.total)) * 100)
        : 0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setInk();
    doc.text(m.etiqueta, leftX + 3, ly);
    const barMax = colW - 42;
    const barW = Math.max(2, (Math.abs(m.monto) / maxMedio) * barMax);
    doc.setFillColor(...LINE);
    doc.roundedRect(leftX + 3, ly + 1.5, barMax, 1.6, 0.5, 0.5, 'F');
    doc.setFillColor(...GREEN_BAR);
    doc.roundedRect(leftX + 3, ly + 1.5, barW, 1.6, 0.5, 0.5, 'F');
    doc.text(`${money(m.monto)}  ${pct}%`, leftX + colW - 3, ly, { align: 'right' });
    ly += 7;
  });
  doc.setFont('helvetica', 'bold');
  setInk();
  doc.text('Total cobrado', leftX + 3, ly + 2);
  doc.text(money(informe.porMedio.total), leftX + colW - 3, ly + 2, { align: 'right' });

  y = colTop;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setInk();
  doc.text('3 · Ingresos por unidad de negocio', rightX, y);
  y += 5;
  const u = informe.unidades;
  const filasU = [
    ['Canchas', u.canchas],
    ['Escuela / clases', u.clases],
    ['Buffet', u.buffet],
    ['Shop', u.shop],
    ['Total facturado', u.total],
  ] as const;
  doc.setFillColor(...CARD);
  doc.roundedRect(rightX, y, colW, 52, 2, 2, 'F');
  let uy = y + 7;
  filasU.forEach((row, i) => {
    doc.setFont('helvetica', i === filasU.length - 1 ? 'bold' : 'normal');
    doc.setFontSize(7);
    setInk();
    doc.text(row[0], rightX + 3, uy);
    doc.text(money(row[1]), rightX + colW - 3, uy, { align: 'right' });
    uy += 8;
  });
  y = Math.max(boxY + 56, y + 56);

  if (informe.facturacion7dias.length > 0) {
    ensure(36);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setMuted();
    doc.text('FACTURACIÓN ÚLTIMOS 7 DÍAS', M, y);
    y += 3;
    const dias = informe.facturacion7dias;
    const maxV = Math.max(...dias.map((d) => d.ingresos), 1);
    const barAreaH = 22;
    const slot = CONTENT_W / dias.length;
    dias.forEach((d, i) => {
      const h = Math.max(1.5, (d.ingresos / maxV) * barAreaH);
      const x = M + i * slot + 2;
      const ultimo = i === dias.length - 1;
      doc.setFillColor(...(ultimo ? GREEN : GREEN_SOFT));
      doc.roundedRect(x, y + (barAreaH - h), slot - 4, h, 0.6, 0.6, 'F');
      doc.setFontSize(5);
      setMuted();
      const label = new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-AR', {
        weekday: 'short',
        day: 'numeric',
      });
      doc.text(label.replace('.', ''), x + (slot - 4) / 2, y + barAreaH + 4, {
        align: 'center',
      });
    });
    y += barAreaH + 10;
  }

  if (informe.mapa && informe.mapa.horas.length > 0) {
    ensure(18 + informe.mapa.canchas.length * 6);
    sectionTitle(4, 'Mapa de ocupación por cancha y hora');
    const mapa = informe.mapa;
    const cell = Math.min(6, (CONTENT_W - 32) / Math.max(mapa.horas.length, 1));
    doc.setFontSize(5);
    setMuted();
    mapa.horas.forEach((h, i) => {
      doc.text(String(h), M + 28 + i * cell + cell / 2, y, { align: 'center' });
    });
    y += 3;
    mapa.canchas.forEach((c) => {
      ensure(7);
      setInk();
      doc.setFontSize(6);
      doc.text(c.nombre, M, y + 3, { maxWidth: 26 });
      c.celdas.forEach((celda, i) => {
        const color =
          celda === 'fijo' ? GREEN : celda === 'variable' ? GREEN_SOFT : celda === 'clase' ? BLUE : LINE;
        doc.setFillColor(...color);
        doc.roundedRect(M + 28 + i * cell, y, cell - 0.7, 4.2, 0.5, 0.5, 'F');
      });
      setMuted();
      doc.text(`${Math.round(c.ocupacionPct)}%`, PAGE_W - M, y + 3, { align: 'right' });
      y += 5.5;
    });
    y += 4;
  }

  ensure(48);
  const f = informe.fugas;
  const fugasY = y;
  sectionTitle(5, 'Fugas de plata');
  doc.setFillColor(...CARD);
  doc.roundedRect(leftX, y, colW, 44, 2, 2, 'F');
  const fugasRows: [string, string, boolean?][] = [
    ['Cobros incompletos', money(f.cobrosIncompletos.total)],
    ['Cancelaciones con cargo', money(f.cancelaciones.conCargo.monto), true],
    ['Cancelaciones perdidas', money(f.cancelaciones.perdidas.monto)],
    ['Diferencias de arqueo', money(Math.abs(f.diferenciasArqueo.total))],
    ['Total en riesgo', money(f.totalRiesgo)],
  ];
  let fy = y + 7;
  fugasRows.forEach((row, i) => {
    const isTotal = i === fugasRows.length - 1;
    const informativo = row[2] === true;
    doc.setFont('helvetica', isTotal ? 'bold' : 'normal');
    doc.setFontSize(7);
    if (isTotal) doc.setTextColor(...WARN);
    else if (informativo) setMuted();
    else setInk();
    doc.text(row[0], leftX + 3, fy);
    doc.text(row[1], leftX + colW - 3, fy, { align: 'right' });
    fy += 7;
  });

  y = fugasY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setInk();
  doc.text('6 · Buffet y shop', rightX, y);
  y += 5;
  doc.setFillColor(...CARD);
  doc.roundedRect(rightX, y, colW, 36, 2, 2, 'F');
  doc.setFontSize(7);
  setMuted();
  doc.text('VENTAS', rightX + 3, y + 6);
  setInk();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(money(informe.buffetShop.ventas), rightX + 3, y + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  setMuted();
  doc.text(
    `Margen bruto ${informe.buffetShop.margenPct === null ? '—' : `${Math.round(informe.buffetShop.margenPct)}%`}`,
    rightX + 3,
    y + 20,
  );
  informe.buffetShop.topProductos.slice(0, 2).forEach((p, i) => {
    setInk();
    doc.text(`${p.nombre} · ${p.cantidad} u.`, rightX + 3, y + 27 + i * 4, {
      maxWidth: colW - 6,
    });
  });
  y = fugasY + 46;

  ensure(40);
  const mesY = y;
  sectionTitle(7, 'Cómo viene el mes');
  const m = informe.mes;
  doc.setFillColor(...CARD);
  doc.roundedRect(leftX, y, colW, 34, 2, 2, 'F');
  const mesRows: [string, string][] = [
    [`Facturado al ${fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })}`, money(m.facturadoMes)],
    ['Mismo período mes anterior', money(m.facturadoMesAntMismoPeriodo)],
    [
      'Proyección de cierre',
      m.proyeccionCierre === null ? '—' : money(m.proyeccionCierre),
    ],
  ];
  let my = y + 7;
  mesRows.forEach((row) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setInk();
    doc.text(row[0], leftX + 3, my);
    doc.setFont('helvetica', 'bold');
    doc.text(row[1], leftX + colW - 3, my, { align: 'right' });
    my += 8;
  });

  y = mesY;
  const manana = informe.manana;
  if (manana) {
    const dMan = new Date(fecha);
    dMan.setDate(dMan.getDate() + 1);
    const tMan = `Hoy, ${dMan.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' })}`;
    doc.setFillColor(...DARK);
    doc.roundedRect(rightX, y, colW, 39, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`8 · ${tMan}`, rightX + 3, y + 6, { maxWidth: colW - 6 });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 210, 200);
    doc.text('Ya reservado', rightX + 3, y + 14);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(
      manana.pctReservado === null ? '—' : `${Math.round(manana.pctReservado)}%`,
      rightX + 3,
      y + 22,
    );
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 210, 200);
    doc.text(`Huecos en pico: ${manana.horasLibresPico} h`, rightX + 3, y + 30);
  }
  y = mesY + 44;

  ensure(20 + alertas.length * 5);
  doc.setFillColor(...PEACH);
  doc.roundedRect(M, y, CONTENT_W, 10 + Math.max(alertas.length, 1) * 5, 2, 2, 'F');
  doc.setTextColor(...PEACH_INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('9 · Alertas para resolver', M + 3, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  if (alertas.length === 0) {
    doc.text('Sin alertas — todo en orden.', M + 3, y + 12);
  } else {
    alertas.forEach((al, i) => {
      doc.text(`${i + 1}. ${al.texto}`, M + 3, y + 12 + i * 5, {
        maxWidth: CONTENT_W - 8,
      });
    });
  }

  const slug = informe.fecha;
  const clubSlug = nombreClub.replace(/[^\w]+/g, '-').toLowerCase() || 'club';
  doc.save(`informe-cierre-${slug}-${clubSlug}.pdf`);
}
