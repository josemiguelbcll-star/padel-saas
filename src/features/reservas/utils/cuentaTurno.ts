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
  /**
   * SUM de reserva_consumos.subtotal WHERE tipo_reparto='partido'. >= 0.
   * Estos consumos se reparten SÓLO entre jugadores (los invitados no
   * los pagan). Agregado en la 0015.
   */
  totalConsumosPartido: number;
  /**
   * SUM de reserva_consumos.subtotal WHERE tipo_reparto='general'. >= 0.
   * Estos consumos se reparten entre TODAS las personas (jugadores +
   * invitados). Agregado en la 0015.
   */
  totalConsumosGeneral: number;
  /** count total de personas (jugadores + invitados). >= 0. */
  cantidadPersonas: number;
}

export interface DesgloseCuenta {
  /** Parte del alquiler que le toca a cada jugador. Entero (CEIL). */
  parteAlquilerPorJugador: number;
  /**
   * Parte de consumos PARTIDO por jugador. Entero (CEIL). Invitados
   * no la pagan. Agregado en la 0015 (era parte de
   * parteConsumoPorPersona).
   */
  parteConsumoPartidoPorJugador: number;
  /**
   * Parte de consumos GENERALES por persona (jugador o invitado).
   * Entero (CEIL). Agregado en la 0015.
   */
  parteConsumoGeneralPorPersona: number;
  /**
   * Total que paga cada jugador =
   *   parteAlquilerPorJugador
   * + parteConsumoPartidoPorJugador
   * + parteConsumoGeneralPorPersona.
   */
  totalPorJugador: number;
  /** Total que paga cada invitado = sólo parteConsumoGeneralPorPersona. */
  totalPorInvitado: number;
  // Espejo de los inputs, útil para el hint visual del desglose.
  cantidadJugadores: number;
  cantidadPersonas: number;
  montoAlquiler: number;
  totalConsumosPartido: number;
  totalConsumosGeneral: number;
}

/**
 * Equivalente exacto del cálculo de fn_cobrar_persona_turno (RPC del
 * 0015). Si esta función y la RPC difieren, la validación cruzada
 * `p_monto_esperado` rechaza cobros válidos con "la cuenta cambió".
 *
 * Tabla de sincronización (header de la 0015):
 *   - parte alquiler / jugador       → CEIL(monto_total / cant_jug)
 *   - parte consumo partido / jug    → CEIL(total_partido / cant_jug)
 *   - parte consumo general / pers   → CEIL(total_general / cant_pers)
 *   - parte total jugador            → suma de las 3
 *   - parte total invitado           → sólo general
 * Todos con guard `> 0` para evitar div/0.
 */
export function calcularDesgloseCuenta(
  input: CalcularDesgloseInput,
): DesgloseCuenta {
  const {
    montoAlquiler,
    cantidadJugadores,
    totalConsumosPartido,
    totalConsumosGeneral,
    cantidadPersonas,
  } = input;

  const parteAlquilerPorJugador =
    cantidadJugadores > 0 && montoAlquiler > 0
      ? Math.ceil(montoAlquiler / cantidadJugadores)
      : 0;

  const parteConsumoPartidoPorJugador =
    cantidadJugadores > 0 && totalConsumosPartido > 0
      ? Math.ceil(totalConsumosPartido / cantidadJugadores)
      : 0;

  const parteConsumoGeneralPorPersona =
    cantidadPersonas > 0 && totalConsumosGeneral > 0
      ? Math.ceil(totalConsumosGeneral / cantidadPersonas)
      : 0;

  return {
    parteAlquilerPorJugador,
    parteConsumoPartidoPorJugador,
    parteConsumoGeneralPorPersona,
    totalPorJugador:
      parteAlquilerPorJugador +
      parteConsumoPartidoPorJugador +
      parteConsumoGeneralPorPersona,
    totalPorInvitado: parteConsumoGeneralPorPersona,
    cantidadJugadores,
    cantidadPersonas,
    montoAlquiler,
    totalConsumosPartido,
    totalConsumosGeneral,
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
    // Consumo agregado según tipo de persona (sin exponer las dos bolsas
    // por separado en SaldoPersona — la UI muestra el monto total y el
    // detalle vive en el hint colapsable del PersonasTurnoSection).
    // Mismo split que fn_cobrar_persona_turno (RPC del 0015): jugadores
    // pagan partido + general; invitados sólo general.
    const parteConsumo =
      persona.tipo === 'jugador'
        ? desglose.parteConsumoPartidoPorJugador +
          desglose.parteConsumoGeneralPorPersona
        : desglose.parteConsumoGeneralPorPersona;
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
