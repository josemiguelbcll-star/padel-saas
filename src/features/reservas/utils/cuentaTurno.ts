import type { TipoPersonaTurno } from '@/types/database';

/**
 * Cálculo de la división de la cuenta del turno (paso 3 del módulo
 * "cuenta del turno tipo restaurante" — ver CLAUDE.md sección "División
 * de la cuenta del turno").
 *
 * Reglas (Forma B, ya confirmadas en CLAUDE.md):
 *
 *   - El ALQUILER se divide entre la cantidad de JUGADORES (incluido el
 *     titular). Los invitados NO pagan alquiler.
 *   - Los CONSUMOS se reparten parejos entre TODAS las personas
 *     (jugadores + invitados).
 *   - Redondeo HACIA ARRIBA AL PESO por cada parte individual (la parte
 *     de cada jugador, la parte de cada invitado) — NO sobre el total.
 *     Así cada uno paga un entero y la suma de las partes queda >= total
 *     real; el sobrante (centavos) queda a favor del club, nunca corto.
 *
 * Casos borde manejados:
 *   - 0 jugadores o alquiler = 0 → parte de alquiler = 0 (sin div/0).
 *   - 0 personas o consumos = 0 → parte de consumo = 0.
 *
 * Función PURA, sin React, sin side effects. Testeable solo.
 */

export interface CalcularDesgloseInput {
  /** reserva.monto_total. >= 0. */
  montoAlquiler: number;
  /** count de reserva_jugadores con tipo='jugador'. >= 0. */
  cantidadJugadores: number;
  /** SUM de reserva_consumos.subtotal. >= 0. */
  totalConsumos: number;
  /** count total de personas (jugadores + invitados). >= 0. */
  cantidadPersonas: number;
}

export interface DesgloseCuenta {
  /** Parte del alquiler que le toca a cada jugador. Entero (redondeo ceil). */
  parteAlquilerPorJugador: number;
  /** Parte de consumos que le toca a cada persona (jugador o invitado). Entero. */
  parteConsumoPorPersona: number;
  /** Total que paga cada jugador = parteAlquilerPorJugador + parteConsumoPorPersona. */
  totalPorJugador: number;
  /** Total que paga cada invitado = parteConsumoPorPersona (no paga alquiler). */
  totalPorInvitado: number;
  // Espejo de los inputs, útil para el hint visual del desglose.
  cantidadJugadores: number;
  cantidadPersonas: number;
  montoAlquiler: number;
  totalConsumos: number;
}

export function calcularDesgloseCuenta(
  input: CalcularDesgloseInput,
): DesgloseCuenta {
  const {
    montoAlquiler,
    cantidadJugadores,
    totalConsumos,
    cantidadPersonas,
  } = input;

  // Redondeo ceil por cada parte INDIVIDUAL — no sobre el total.
  // Si la división da decimales, cada uno paga el entero de arriba; la
  // suma de las N partes queda >= monto total (a favor del club, nunca
  // corto). El chequeo `> 0` evita Math.ceil(0/N)=0 inútil y deja la
  // intención explícita.
  const parteAlquilerPorJugador =
    cantidadJugadores > 0 && montoAlquiler > 0
      ? Math.ceil(montoAlquiler / cantidadJugadores)
      : 0;

  const parteConsumoPorPersona =
    cantidadPersonas > 0 && totalConsumos > 0
      ? Math.ceil(totalConsumos / cantidadPersonas)
      : 0;

  return {
    parteAlquilerPorJugador,
    parteConsumoPorPersona,
    totalPorJugador: parteAlquilerPorJugador + parteConsumoPorPersona,
    totalPorInvitado: parteConsumoPorPersona,
    cantidadJugadores,
    cantidadPersonas,
    montoAlquiler,
    totalConsumos,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Saldos por persona (paso 4 — pagos por persona)
// ─────────────────────────────────────────────────────────────────────

/**
 * Estado del saldo de una persona en el turno:
 *
 *   - 'debe':         no pagó nada y tiene saldo > 0.
 *   - 'pago_parcial': pagó algo antes pero AHORA debe más (típicamente
 *                     porque se agregó un consumo o se quitó otra
 *                     persona después de su pago). UI debe mostrar
 *                     claramente "pagó $X · debe $Y más".
 *   - 'saldada':      saldo = 0 (pagó lo justo, o pagó de más y la parte
 *                     bajó después — sin "crédito", el sobrante queda a
 *                     favor del club).
 */
export type EstadoSaldoPersona = 'debe' | 'pago_parcial' | 'saldada';

export interface SaldoPersona {
  reservaJugadorId: number;
  tipo: TipoPersonaTurno;
  parteAlquiler: number;
  parteConsumo: number;
  parteTotal: number;
  yaPagadoAlquiler: number;
  yaPagadoConsumo: number;
  yaPagadoTotal: number;
  saldoAlquiler: number;
  saldoConsumo: number;
  saldo: number;
  estado: EstadoSaldoPersona;
}

export interface CalcularSaldosPersonasInput {
  /** Lista de personas del turno (jugadores e invitados). */
  personas: Array<{ id: number; tipo: TipoPersonaTurno }>;
  /** Pagos de la reserva (toda la historia). */
  pagos: Array<{
    reserva_jugador_id: number | null;
    monto_alquiler: number;
    monto_consumo: number;
  }>;
  /** Desglose de la división — debe corresponder al estado actual. */
  desglose: DesgloseCuenta;
}

/**
 * Para cada persona del turno, calcula su parte, lo que ya pagó (desde
 * los pagos atados a ella vía reserva_jugador_id), y el saldo restante.
 *
 * Cumple el mismo invariante que la RPC `fn_cobrar_persona_turno`:
 * - Invitados no pagan alquiler (parte_alquiler = 0).
 * - GREATEST(0, parte - ya_pagado) — sin "crédito" si pagó de más.
 * - Si bajó la parte (por edits post-pago) y ya_pagado >= parte_actual,
 *   el saldo es 0 (saldada) y el sobrante queda a favor del club.
 *
 * Función PURA, sin React. Se usa en la UI para mostrar el estado de
 * cada persona; la RPC recalcula del lado server (single source of
 * truth para el cobro).
 */
export function calcularSaldosPersonas(
  input: CalcularSaldosPersonasInput,
): SaldoPersona[] {
  const { personas, pagos, desglose } = input;

  return personas.map((persona) => {
    const pagosPropios = pagos.filter(
      (p) => p.reserva_jugador_id === persona.id,
    );
    const yaPagadoAlquiler = pagosPropios.reduce(
      (sum, p) => sum + p.monto_alquiler,
      0,
    );
    const yaPagadoConsumo = pagosPropios.reduce(
      (sum, p) => sum + p.monto_consumo,
      0,
    );
    const yaPagadoTotal = yaPagadoAlquiler + yaPagadoConsumo;

    const parteAlquiler =
      persona.tipo === 'jugador' ? desglose.parteAlquilerPorJugador : 0;
    const parteConsumo = desglose.parteConsumoPorPersona;
    const parteTotal = parteAlquiler + parteConsumo;

    const saldoAlquiler = Math.max(0, parteAlquiler - yaPagadoAlquiler);
    const saldoConsumo = Math.max(0, parteConsumo - yaPagadoConsumo);
    const saldo = saldoAlquiler + saldoConsumo;

    let estado: EstadoSaldoPersona;
    if (saldo === 0) {
      estado = 'saldada';
    } else if (yaPagadoTotal > 0) {
      estado = 'pago_parcial';
    } else {
      estado = 'debe';
    }

    return {
      reservaJugadorId: persona.id,
      tipo: persona.tipo,
      parteAlquiler,
      parteConsumo,
      parteTotal,
      yaPagadoAlquiler,
      yaPagadoConsumo,
      yaPagadoTotal,
      saldoAlquiler,
      saldoConsumo,
      saldo,
      estado,
    };
  });
}
