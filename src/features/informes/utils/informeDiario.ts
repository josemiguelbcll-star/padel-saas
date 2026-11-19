/**
 * Lógica PURA del "informe diario del dueño" (modo día completo).
 * Sin Supabase ni React — recibe filas plain y devuelve los números,
 * igual que `informeTurno.ts` y `kpisHoy.ts`.
 */
import type { EstadoReserva } from '@/types/database';
import { esReservaFirme, saldoAlquiler } from '@/features/dashboard/utils/kpisHoy';
import { horaAMinutos } from '@/features/dashboard/utils/kpisHoy';

// ── Tipos de entrada (filas plain) ──────────────────────────────────

export interface ReservaDiaRow {
  cancha_id: number;
  hora_inicio: string;
  duracion_min: number;
  estado: EstadoReserva;
  turno_fijo_id: number | null;
  monto_total: number;
  monto_pagado: number;
}

export interface ClaseCatalogoRow {
  id: number;
  profesor_id: number | null;
  nombre: string | null;
  duracion_min: number;
  dias_semana: number[];
  activa: boolean;
  es_recurrente: boolean;
  fecha_clase: string | null;
  hora_inicio: string;
  cancha_id: number | null;
}

export interface ProfesorRow {
  id: number;
  nombre: string;
}

// ── 1 · Actividad del día ───────────────────────────────────────────

export interface BloqueActividad {
  count: number;
  horas: number;
  monto: number;
  detalle: string;
}

export interface ActividadDia {
  turnosFijos: BloqueActividad;
  variables: BloqueActividad;
  clases: { count: number; horas: number; alumnos: number; monto: number };
  insumos: { unidades: number; monto: number };
}

function bloque(
  filas: ReservaDiaRow[],
): Omit<BloqueActividad, 'detalle'> {
  return {
    count: filas.length,
    horas: Math.round((filas.reduce((a, r) => a + r.duracion_min, 0) / 60) * 10) / 10,
    monto: filas.reduce((a, r) => a + Number(r.monto_total), 0),
  };
}

export function actividadDelDia(input: {
  reservas: ReservaDiaRow[];
  clasesHoy: ClaseCatalogoRow[];
  alumnosClasesHoy: number;
  montoClasesHoy: number;
  insumosUnidades: number;
  insumosMonto: number;
}): ActividadDia {
  const firmes = input.reservas.filter((r) => esReservaFirme(r.estado));
  const fijos = firmes.filter((r) => r.turno_fijo_id !== null);
  const variables = firmes.filter((r) => r.turno_fijo_id === null);
  const bF = bloque(fijos);
  const bV = bloque(variables);
  return {
    turnosFijos: { ...bF, detalle: `${bF.horas} h` },
    variables: { ...bV, detalle: `${bV.horas} h` },
    clases: {
      count: input.clasesHoy.length,
      horas:
        Math.round(
          (input.clasesHoy.reduce((a, c) => a + c.duracion_min, 0) / 60) * 10,
        ) / 10,
      alumnos: input.alumnosClasesHoy,
      monto: input.montoClasesHoy,
    },
    insumos: {
      unidades: input.insumosUnidades,
      monto: input.insumosMonto,
    },
  };
}

// ── 2 · Ocupación: % general, pico/valle, mapa por cancha y hora ────

export interface OcupacionDia {
  porcentaje: number | null;
  minutosOcupados: number;
  minutosDisponibles: number;
  /** Ventana de 6h más ocupada y menos ocupada (labels 'HH–HH h'). */
  pico: { etiqueta: string; pct: number } | null;
  valle: { etiqueta: string; pct: number } | null;
}

export type CeldaOcupacion = 'fijo' | 'variable' | 'clase' | 'libre';

export interface MapaOcupacion {
  horas: number[];
  canchas: Array<{
    cancha_id: number;
    nombre: string;
    celdas: CeldaOcupacion[];
    ocupacionPct: number;
  }>;
}

function horaLabel(h: number): string {
  return `${String(h).padStart(2, '0')} h`;
}

/**
 * Ocupación del día = minutos ocupados (reservas firmes + clases) /
 * (ventana horaria × canchas activas). Pico/valle = ventanas móviles de
 * 6 horas consecutivas con mayor/menor ocupación.
 */
export function ocupacionDelDia(input: {
  reservas: ReservaDiaRow[];
  clasesHoy: ClaseCatalogoRow[];
  canchas: Array<{ id: number; nombre: string; activa: boolean }>;
  horaApertura: string | null;
  horaCierre: string | null;
}): { ocupacion: OcupacionDia; mapa: MapaOcupacion | null } {
  const canchasActivas = input.canchas.filter((c) => c.activa);
  const aperturaMin = input.horaApertura
    ? horaAMinutos(input.horaApertura)
    : null;
  const cierreMin = input.horaCierre ? horaAMinutos(input.horaCierre) : null;

  const reservasFirmes = input.reservas.filter((r) =>
    esReservaFirme(r.estado),
  );
  const minutosOcupados =
    reservasFirmes.reduce((a, r) => a + r.duracion_min, 0) +
    input.clasesHoy.reduce((a, c) => a + c.duracion_min, 0);

  // Minutos disponibles
  let minutosDisponibles = 0;
  let ventanaHoras: number[] = [];
  if (aperturaMin !== null && cierreMin !== null && cierreMin > aperturaMin) {
    let c = cierreMin;
    if (c <= aperturaMin) c += 1440;
    minutosDisponibles = (c - aperturaMin) * canchasActivas.length;
    const hIni = Math.floor(aperturaMin / 60);
    const hFin = Math.floor(c / 60);
    for (let h = hIni; h < hFin; h++) ventanaHoras.push(h % 24);
  }

  const porcentaje =
    minutosDisponibles > 0
      ? (minutosOcupados / minutosDisponibles) * 100
      : null;

  // ── Mapa por cancha y hora ──
  let mapa: MapaOcupacion | null = null;
  if (ventanaHoras.length > 0) {
    // Ocupación por hora: fracción de canchas ocupadas en esa hora.
    const ocupPorHora = new Map<number, number>();
    for (const h of ventanaHoras) ocupPorHora.set(h, 0);

    const solapa = (
      iniMin: number,
      durMin: number,
      h: number,
    ): boolean => {
      const hIni = h * 60;
      const hFin = hIni + 60;
      return iniMin < hFin && iniMin + durMin > hIni;
    };

    const marcar = (canchaId: number | null, iniMin: number, durMin: number) => {
      if (canchaId === null) return;
      for (const h of ventanaHoras) {
        if (solapa(iniMin, durMin, h)) {
          ocupPorHora.set(h, (ocupPorHora.get(h) ?? 0) + 1);
        }
      }
    };

    for (const r of reservasFirmes) {
      marcar(r.cancha_id, horaAMinutos(r.hora_inicio), r.duracion_min);
    }
    for (const c of input.clasesHoy) {
      if (c.cancha_id !== null && c.cancha_id !== undefined) {
        marcar(c.cancha_id, horaAMinutos(c.hora_inicio), c.duracion_min);
      }
    }

    // Pico/valle: ventana móvil de 6h consecutivas.
    let pico: OcupacionDia['pico'] = null;
    let valle: OcupacionDia['valle'] = null;
    if (ventanaHoras.length >= 6) {
      let mejor = -1;
      let peor = Infinity;
      for (let i = 0; i + 6 <= ventanaHoras.length; i++) {
        const win = ventanaHoras.slice(i, i + 6);
        const ocupMin = win.reduce((a, h) => {
          const fraccion = (ocupPorHora.get(h) ?? 0) / canchasActivas.length;
          return a + fraccion * 60;
        }, 0);
        const pctWin = (ocupMin / (6 * 60)) * 100;
        if (pctWin > mejor) {
          mejor = pctWin;
          pico = {
            etiqueta: `${horaLabel(win[0])}–${horaLabel((win[5] + 1) % 24)}`,
            pct: pctWin,
          };
        }
        if (pctWin < peor) {
          peor = pctWin;
          valle = {
            etiqueta: `${horaLabel(win[0])}–${horaLabel((win[5] + 1) % 24)}`,
            pct: pctWin,
          };
        }
      }
    }

    // Celdas por cancha/hora
    const nombrePorId = new Map(input.canchas.map((c) => [c.id, c.nombre]));
    mapa = {
      horas: ventanaHoras,
      canchas: canchasActivas.map((can) => {
        const celdas: CeldaOcupacion[] = ventanaHoras.map((h) => {
          const hIni = h * 60;
          const hFin = hIni + 60;
          const solapaCon = (iniMin: number, durMin: number) =>
            iniMin < hFin && iniMin + durMin > hIni;
          const reservasH = reservasFirmes.filter(
            (r) =>
              r.cancha_id === can.id &&
              solapaCon(horaAMinutos(r.hora_inicio), r.duracion_min),
          );
          if (reservasH.length > 0) {
            return reservasH.some((r) => r.turno_fijo_id !== null)
              ? 'fijo'
              : 'variable';
          }
          const claseH = input.clasesHoy.find(
            (c) =>
              c.cancha_id === can.id &&
              solapaCon(horaAMinutos(c.hora_inicio), c.duracion_min),
          );
          return claseH ? 'clase' : 'libre';
        });
        const ocupadas = celdas.filter((c) => c !== 'libre').length;
        return {
          cancha_id: can.id,
          nombre: nombrePorId.get(can.id) ?? `Cancha ${can.id}`,
          celdas,
          ocupacionPct:
            ventanaHoras.length > 0
              ? (ocupadas / ventanaHoras.length) * 100
              : 0,
        };
      }),
    };

    return {
      ocupacion: {
        porcentaje,
        minutosOcupados,
        minutosDisponibles,
        pico,
        valle,
      },
      mapa,
    };
  }

  return {
    ocupacion: {
      porcentaje,
      minutosOcupados,
      minutosDisponibles,
      pico: null,
      valle: null,
    },
    mapa,
  };
}

// ── 3 · Clases por profesor ─────────────────────────────────────────

export interface ClaseProfesorRow {
  profesor: string;
  clasesHoy: number;
  alumnosHoy: number;
  ingresosHoy: number;
  clasesMes: number;
  ingresosMes: number;
  pctEscuela: number;
}

/**
 * `cobrosMesPorClase`: mapa clase_id → {clases: count, monto} del mes.
 * `alumnosHoyPorClase`: mapa clase_id → cantidad de alumnos hoy.
 * `ingresosHoyPorClase`: mapa clase_id → monto cobrado hoy.
 */
export function clasesPorProfesor(input: {
  clases: ClaseCatalogoRow[];
  profesores: ProfesorRow[];
  clasesHoyIds: Set<number>;
  alumnosHoyPorClase: Map<number, number>;
  ingresosHoyPorClase: Map<number, number>;
  cobrosMesPorClase: Map<number, { clases: number; monto: number }>;
}): { filas: ClaseProfesorRow[]; total: ClaseProfesorRow } {
  const profesorPorClase = new Map<number, number>();
  for (const c of input.clases) {
    if (c.profesor_id !== null) profesorPorClase.set(c.id, c.profesor_id);
  }
  const nombreProfesor = new Map(input.profesores.map((p) => [p.id, p.nombre]));

  const porProfesor = new Map<number, ClaseProfesorRow>();
  const acumular = (profId: number) => {
    const prev =
      porProfesor.get(profId) ?? {
        profesor: nombreProfesor.get(profId) ?? `Profesor ${profId}`,
        clasesHoy: 0,
        alumnosHoy: 0,
        ingresosHoy: 0,
        clasesMes: 0,
        ingresosMes: 0,
        pctEscuela: 0,
      };
    porProfesor.set(profId, prev);
    return prev;
  };

  // Hoy: clases que ocurren hoy (ya filtradas por el caller en clasesHoyIds)
  for (const claseId of input.clasesHoyIds) {
    const profId = profesorPorClase.get(claseId);
    if (profId === undefined) continue;
    const row = acumular(profId);
    row.clasesHoy += 1;
    row.alumnosHoy += input.alumnosHoyPorClase.get(claseId) ?? 0;
    row.ingresosHoy += input.ingresosHoyPorClase.get(claseId) ?? 0;
  }

  // Mes: todos los cobros del mes agrupados por profesor
  let totalIngresosMes = 0;
  for (const [claseId, cobro] of input.cobrosMesPorClase) {
    const profId = profesorPorClase.get(claseId);
    if (profId === undefined) continue;
    const row = acumular(profId);
    row.clasesMes += cobro.clases;
    row.ingresosMes += cobro.monto;
    totalIngresosMes += cobro.monto;
  }

  const filas = [...porProfesor.values()].sort(
    (a, b) => b.ingresosMes - a.ingresosMes,
  );
  for (const f of filas) {
    f.pctEscuela =
      totalIngresosMes > 0 ? (f.ingresosMes / totalIngresosMes) * 100 : 0;
  }
  const total: ClaseProfesorRow = {
    profesor: 'Total',
    clasesHoy: filas.reduce((a, f) => a + f.clasesHoy, 0),
    alumnosHoy: filas.reduce((a, f) => a + f.alumnosHoy, 0),
    ingresosHoy: filas.reduce((a, f) => a + f.ingresosHoy, 0),
    clasesMes: filas.reduce((a, f) => a + f.clasesMes, 0),
    ingresosMes: totalIngresosMes,
    pctEscuela: 100,
  };
  return { filas, total };
}

// ── 4 · Facturación últimos 7 días ──────────────────────────────────

export interface DiaFacturacion {
  fecha: string;
  ingresos: number;
}

// ── 5 · Cómo viene el mes ───────────────────────────────────────────

export interface ComoVieneElMes {
  facturadoMes: number;
  facturadoMesAntMismoPeriodo: number;
  variacionPct: number | null;
  proyeccionCierre: number | null;
  ocupacionMesPct: number | null;
}

export function comoVieneElMes(input: {
  facturadoMes: number;
  facturadoMesAntMismoPeriodo: number;
  /** Días transcurridos del mes (1..diasMes). */
  diasTranscurridos: number;
  diasMes: number;
  ocupacionMesPct: number | null;
}): ComoVieneElMes {
  const variacionPct =
    input.facturadoMesAntMismoPeriodo > 0
      ? ((input.facturadoMes - input.facturadoMesAntMismoPeriodo) /
          input.facturadoMesAntMismoPeriodo) *
        100
      : null;
  const proyeccionCierre =
    input.diasTranscurridos > 0
      ? (input.facturadoMes / input.diasTranscurridos) * input.diasMes
      : null;
  return {
    facturadoMes: input.facturadoMes,
    facturadoMesAntMismoPeriodo: input.facturadoMesAntMismoPeriodo,
    variacionPct,
    proyeccionCierre,
    ocupacionMesPct: input.ocupacionMesPct,
  };
}

// ── 6 · Fugas de plata ──────────────────────────────────────────────

export interface Fugas {
  pendienteCobro: { count: number; total: number };
  cancelaciones: { count: number; monto: number };
  diferenciasArqueo: { count: number; total: number };
  total: number;
}

export function calcularFugas(input: {
  reservas: ReservaDiaRow[];
  diferenciasJornadas: Array<number | null>;
}): Fugas {
  const pendientes = input.reservas.filter(
    (r) => esReservaFirme(r.estado) && saldoAlquiler(r) > 0,
  );
  const pendienteCobro = {
    count: pendientes.length,
    total: pendientes.reduce((a, r) => a + saldoAlquiler(r), 0),
  };
  const canceladas = input.reservas.filter((r) => r.estado === 'cancelada');
  const cancelaciones = {
    count: canceladas.length,
    monto: canceladas.reduce((a, r) => a + Number(r.monto_total), 0),
  };
  const difs = input.diferenciasJornadas.filter(
    (d): d is number => d !== null && d !== 0,
  );
  const diferenciasArqueo = {
    count: difs.length,
    total: difs.reduce((a, d) => a + d, 0),
  };
  return {
    pendienteCobro,
    cancelaciones,
    diferenciasArqueo,
    total: pendienteCobro.total + cancelaciones.monto + Math.abs(diferenciasArqueo.total),
  };
}

// ── 7 · Mañana (día siguiente) ──────────────────────────────────────

export interface MananaResumen {
  reservasCount: number;
  minutosReservados: number;
  minutosDisponibles: number;
  pctReservado: number | null;
  /** Horas libres dentro de la ventana pico (18–24) aproximadas. */
  horasLibresPico: number;
}

export function resumenManana(input: {
  reservasManana: ReservaDiaRow[];
  canchasActivas: number;
  horaApertura: string | null;
  horaCierre: string | null;
}): MananaResumen {
  const firmes = input.reservasManana.filter((r) =>
    esReservaFirme(r.estado),
  );
  const minutosReservados = firmes.reduce((a, r) => a + r.duracion_min, 0);

  const aperturaMin = input.horaApertura ? horaAMinutos(input.horaApertura) : null;
  const cierreMin = input.horaCierre ? horaAMinutos(input.horaCierre) : null;
  let minutosDisponibles = 0;
  if (aperturaMin !== null && cierreMin !== null && cierreMin > aperturaMin) {
    minutosDisponibles = (cierreMin - aperturaMin) * input.canchasActivas;
  }

  // Horas libres en ventana pico 18–24: minutos libres / 60 / canchas.
  const picoIni = 18 * 60;
  const picoFin = 24 * 60;
  const enPico = firmes.filter((r) => {
    const ini = horaAMinutos(r.hora_inicio);
    return ini < picoFin && ini + r.duracion_min > picoIni;
  });
  const minutosPicoReservados = enPico.reduce(
    (a, r) =>
      a +
      Math.min(r.duracion_min, picoFin - Math.max(horaAMinutos(r.hora_inicio), picoIni)),
    0,
  );
  const minutosPicoTotal = (picoFin - picoIni) * input.canchasActivas;
  const horasLibresPico =
    minutosPicoTotal > 0
      ? Math.max(0, (minutosPicoTotal - minutosPicoReservados) / 60)
      : 0;

  return {
    reservasCount: firmes.length,
    minutosReservados,
    minutosDisponibles,
    pctReservado:
      minutosDisponibles > 0
        ? (minutosReservados / minutosDisponibles) * 100
        : null,
    horasLibresPico: Math.round(horasLibresPico * 10) / 10,
  };
}

// ── 8 · Alertas ─────────────────────────────────────────────────────

export interface AlertaInforme {
  severidad: 'rojo' | 'ambar';
  texto: string;
}

export function generarAlertas(input: {
  fugas: Fugas;
  jornadasAbiertas: number;
  productosStockBajo: number;
  pendientesCobroCount: number;
}): AlertaInforme[] {
  const alertas: AlertaInforme[] = [];
  if (input.fugas.diferenciasArqueo.count > 0) {
    alertas.push({
      severidad: 'rojo',
      texto: `Diferencia de arqueo en ${input.fugas.diferenciasArqueo.count} jornada(s): ${fmtAlertMoney(Math.abs(input.fugas.diferenciasArqueo.total))}.`,
    });
  }
  if (input.pendientesCobroCount > 0) {
    alertas.push({
      severidad: 'ambar',
      texto: `${input.pendientesCobroCount} turno(s) con cobro pendiente por ${fmtAlertMoney(input.fugas.pendienteCobro.total)}.`,
    });
  }
  if (input.fugas.cancelaciones.count > 0) {
    alertas.push({
      severidad: 'ambar',
      texto: `${input.fugas.cancelaciones.count} cancelación(es) del día por ${fmtAlertMoney(input.fugas.cancelaciones.monto)}.`,
    });
  }
  if (input.productosStockBajo > 0) {
    alertas.push({
      severidad: 'ambar',
      texto: `${input.productosStockBajo} producto(s) para reponer stock.`,
    });
  }
  if (input.jornadasAbiertas > 0) {
    alertas.push({
      severidad: 'ambar',
      texto: `${input.jornadasAbiertas} jornada(s) de caja siguen abiertas.`,
    });
  }
  return alertas;
}

const alertMoneyFmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtAlertMoney(n: number): string {
  return alertMoneyFmt.format(Math.round(n));
}
