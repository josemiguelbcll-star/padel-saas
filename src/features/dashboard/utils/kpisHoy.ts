/**
 * Lógica PURA de los KPIs y alarmas "del día" del dashboard. Sin Supabase
 * ni React: recibe filas plain y devuelve los números. Esto la hace
 * testeable en Node sin mockear nada (misma filosofía que clavePeriodo /
 * combinarFlujo / estadoPagoGasto). Los hooks de `../hooks/` cablean las
 * queries y delegan el cómputo acá.
 *
 * Convenciones:
 *  - día de la semana: 1 = lunes … 7 = domingo (espejo del modelo de datos;
 *    ver fechaUtils.diaSemanaDe).
 *  - saldos: SOLO alquiler (monto_total − monto_pagado). Los consumos del
 *    turno NO entran (decisión de alcance: son chicos y se saldan al cerrar;
 *    si con uso real importan, se agrega la query de reserva_consumos).
 */
import type { EstadoReserva } from '@/types/database';

// ─────────────────────────────────────────────────────────────────────
// Helpers de tiempo
// ─────────────────────────────────────────────────────────────────────

/** 'HH:MM:SS' (o 'HH:MM') → minutos desde medianoche. */
export function horaAMinutos(hhmmss: string): number {
  const partes = hhmmss.split(':');
  const h = Number(partes[0] ?? 0);
  const m = Number(partes[1] ?? 0);
  return h * 60 + m;
}

// ─────────────────────────────────────────────────────────────────────
// Saldo / firmeza de reservas (compartido por proyección y cobro pendiente)
// ─────────────────────────────────────────────────────────────────────

/**
 * Una reserva "firme" cuenta para la proyección de cierre y para la alarma
 * de cobro pendiente. El enum `estado` tiene exactamente pendiente / senada
 * / pagada / jugada / cancelada → "firme" = todo salvo 'cancelada'
 * (incluye pendiente sin seña, por decisión de alcance: no se descuenta el
 * riesgo de no-show).
 */
export function esReservaFirme(estado: EstadoReserva): boolean {
  return estado !== 'cancelada';
}

/**
 * Saldo de ALQUILER pendiente de una reserva (monto_total − monto_pagado),
 * acotado a ≥ 0 (un eventual sobrepago no genera saldo negativo).
 */
export function saldoAlquiler(r: {
  monto_total: number;
  monto_pagado: number;
}): number {
  return Math.max(0, Number(r.monto_total) - Number(r.monto_pagado));
}

// ─────────────────────────────────────────────────────────────────────
// KPI: ocupación de canchas hoy
// ─────────────────────────────────────────────────────────────────────

export interface InsumosOcupacion {
  /** Reservas del día (la función filtra las canceladas). */
  reservas: ReadonlyArray<{ duracion_min: number; estado: EstadoReserva }>;
  /** Catálogo de clases (la función filtra activas + del día de la semana). */
  clases: ReadonlyArray<{
    duracion_min: number;
    dias_semana: number[];
    activa: boolean;
  }>;
  /** 1 = lunes … 7 = domingo. */
  diaSemana: number;
  horaApertura: string | null;
  horaCierre: string | null;
  /** Cantidad de canchas activas del club. */
  canchasActivas: number;
}

export interface ResultadoOcupacion {
  /**
   * % de ocupación (0–100, puede superar 100 si hay turnos/clases fuera del
   * horario configurado — señal de dato a revisar, no se clampea acá).
   * `null` = no calculable: sin horario configurado, sin canchas activas, o
   * cierre ≤ apertura. La UI muestra "—".
   */
  porcentaje: number | null;
  minutosOcupados: number;
  minutosDisponibles: number;
}

/**
 * Ocupación = (minutos de reservas firmes + minutos de clases activas de hoy)
 * / (ventana operativa × canchas activas).
 *
 * Sin doble conteo entre reservas y clases: un slot de clase está bloqueado
 * para reservas (trigger trg_clases_no_overlap_reservas) y la materialización
 * de turnos fijos saltea las clases → nunca comparten franja.
 */
export function calcularOcupacion(insumos: InsumosOcupacion): ResultadoOcupacion {
  const {
    reservas,
    clases,
    diaSemana,
    horaApertura,
    horaCierre,
    canchasActivas,
  } = insumos;

  const minReservas = reservas
    .filter((r) => esReservaFirme(r.estado))
    .reduce((acc, r) => acc + r.duracion_min, 0);
  const minClases = clases
    .filter((c) => c.activa && c.dias_semana.includes(diaSemana))
    .reduce((acc, c) => acc + c.duracion_min, 0);
  const minutosOcupados = minReservas + minClases;

  if (horaApertura === null || horaCierre === null || canchasActivas <= 0) {
    return { porcentaje: null, minutosOcupados, minutosDisponibles: 0 };
  }

  const ventana = horaAMinutos(horaCierre) - horaAMinutos(horaApertura);
  if (ventana <= 0) {
    return { porcentaje: null, minutosOcupados, minutosDisponibles: 0 };
  }

  const minutosDisponibles = ventana * canchasActivas;
  return {
    porcentaje: (minutosOcupados / minutosDisponibles) * 100,
    minutosOcupados,
    minutosDisponibles,
  };
}

// ─────────────────────────────────────────────────────────────────────
// KPI: proyección de cierre del día (conservadora)
// ─────────────────────────────────────────────────────────────────────

export interface ReservaSaldo {
  estado: EstadoReserva;
  monto_total: number;
  monto_pagado: number;
}

/**
 * Proyección conservadora del cierre del día = lo YA percibido hoy (todos los
 * medios, vía fn_flujo_caja) + el saldo de ALQUILER aún pendiente de los
 * turnos firmes de hoy.
 *
 * Sin doble conteo: la venta del día es lo que ENTRÓ (monto_pagado, ya cobrado);
 * el saldo pendiente es lo que NO se pagó (monto_total − monto_pagado). Son
 * porciones disjuntas del mismo turno.
 */
export function calcularProyeccionCierre(
  ventaDelDia: number,
  reservasHoy: ReadonlyArray<ReservaSaldo>,
): number {
  const saldoPendiente = reservasHoy
    .filter((r) => esReservaFirme(r.estado))
    .reduce((acc, r) => acc + saldoAlquiler(r), 0);
  return ventaDelDia + saldoPendiente;
}

// ─────────────────────────────────────────────────────────────────────
// Alarma: turnos de hoy con cobro pendiente
// ─────────────────────────────────────────────────────────────────────

export interface ReservaCobro {
  id: number;
  hora_inicio: string;
  cancha_id: number;
  estado: EstadoReserva;
  monto_total: number;
  monto_pagado: number;
  jugador: { nombre: string } | null;
}

export interface TurnoCobroPendiente {
  id: number;
  hora_inicio: string;
  cancha_id: number;
  /** Nombre del titular; null si la reserva no tiene jugador registrado. */
  titular: string | null;
  /** Saldo de alquiler pendiente (> 0). */
  saldo: number;
}

export interface ResultadoCobroPendiente {
  turnos: TurnoCobroPendiente[];
  /** Suma de los saldos pendientes. */
  total: number;
  cantidad: number;
}

/**
 * Turnos firmes de hoy con saldo de alquiler pendiente (> 0), ordenados por
 * hora de inicio. Alimenta la alarma "turnos de hoy con cobro pendiente".
 */
export function turnosConCobroPendiente(
  reservasHoy: ReadonlyArray<ReservaCobro>,
): ResultadoCobroPendiente {
  const turnos: TurnoCobroPendiente[] = reservasHoy
    .filter((r) => esReservaFirme(r.estado) && saldoAlquiler(r) > 0)
    .map((r) => ({
      id: r.id,
      hora_inicio: r.hora_inicio,
      cancha_id: r.cancha_id,
      titular: r.jugador?.nombre ?? null,
      saldo: saldoAlquiler(r),
    }))
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

  const total = turnos.reduce((acc, t) => acc + t.saldo, 0);
  return { turnos, total, cantidad: turnos.length };
}

// La selección de "productos para reponer" (días de stock < umbral) vive en
// features/inventario/utils/reponer.ts — es dominio de inventario (opera sobre
// RotacionFila). La consumen la alarma del dashboard y el tab "Reposición".
