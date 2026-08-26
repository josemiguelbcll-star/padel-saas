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

export interface ParticipantDebt {
  id: number;
  paid: number;
  baseWeight: number;
}

export function distribuirDeudaPonderada(totalDebt: number, participants: ParticipantDebt[]): Record<number, number> {
  let active = [...participants];
  let remainingDebt = totalDebt;
  
  while (active.length > 0) {
    const totalWeight = active.reduce((sum, p) => sum + p.baseWeight, 0);
    if (totalWeight === 0) break;
    
    const quotaPerWeight = remainingDebt / totalWeight;
    const overpayers = active.filter(p => p.paid >= quotaPerWeight * p.baseWeight);
    
    if (overpayers.length === 0) break;
    
    for (const p of overpayers) {
      remainingDebt -= p.paid;
    }
    active = active.filter(p => p.paid < quotaPerWeight * p.baseWeight);
  }
  
  const saldos: Record<number, number> = {};
  const totalWeight = active.reduce((sum, p) => sum + p.baseWeight, 0);
  const finalQuotaPerWeight = totalWeight > 0 ? remainingDebt / totalWeight : 0;
  
  for (const p of active) {
    saldos[p.id] = Math.max(0, Math.ceil((finalQuotaPerWeight * p.baseWeight) - p.paid));
  }
  for (const p of participants) {
    if (saldos[p.id] === undefined) {
      saldos[p.id] = 0;
    }
  }
  return saldos;
}

export interface CalcularSaldosPersonasInput {
  /** Lista de personas del turno (jugadores e invitados). */
  personas: Array<{ id: number; tipo: TipoPersonaTurno; es_titular?: boolean }>;
  /** Pagos de la reserva (toda la historia). */
  pagos: Array<{
    reserva_jugador_id: number | null;
    monto_alquiler: number;
    monto_consumo: number;
    creado_en: string;
  }>;
  /** Consumos de la reserva. */
  consumos: Array<{
    subtotal: number;
    tipo_reparto: string;
    creado_en: string;
  }>;
  /** reserva.monto_total (alquiler). */
  montoAlquiler: number;
}

/**
 * Para cada persona del turno, calcula su parte, lo que ya pagó (desde
 * los pagos atados a ella vía reserva_jugador_id, con fallback a titular para pagos null),
 * y el saldo restante.
 *
 * Excluye cronológicamente de los nuevos consumos a las personas que ya saldaron su deuda.
 */
export function calcularSaldosPersonas(
  input: CalcularSaldosPersonasInput,
): SaldoPersona[] {
  const { personas, pagos, consumos, montoAlquiler } = input;

  const titular = personas.find((p) => p.es_titular);
  const titularId = titular?.id ?? null;

  const cantidadJugadores = personas.filter((p) => p.tipo === 'jugador').length;

  // Inicializar estado cronológico por persona
  const stateMap = new Map<number, {
    paidAlquiler: number;
    paidConsumo: number;
    partAlquiler: number;
    partConsumo: number;
  }>();

  for (const p of personas) {
    stateMap.set(p.id, {
      paidAlquiler: 0,
      paidConsumo: 0,
      partAlquiler: p.tipo === 'jugador' ? (cantidadJugadores > 0 ? Math.ceil(montoAlquiler / cantidadJugadores) : 0) : 0,
      partConsumo: 0,
    });
  }

  // Combinar pagos y consumos en una sola línea de tiempo ordenada
  interface TimelineEvent {
    tipo: 'pago' | 'consumo';
    creadoEn: Date;
    data: any;
  }

  const timeline: TimelineEvent[] = [];

  for (const p of pagos) {
    timeline.push({
      tipo: 'pago',
      creadoEn: p.creado_en ? new Date(p.creado_en) : new Date(0),
      data: p,
    });
  }

  for (const c of consumos) {
    timeline.push({
      tipo: 'consumo',
      creadoEn: c.creado_en ? new Date(c.creado_en) : new Date(0),
      data: c,
    });
  }

  // Ordenar cronológicamente (pagos primero en caso de empate para acreditar fondos cuanto antes)
  timeline.sort((a, b) => {
    const timeA = a.creadoEn.getTime();
    const timeB = b.creadoEn.getTime();
    if (timeA !== timeB) return timeA - timeB;
    if (a.tipo !== b.tipo) {
      return a.tipo === 'pago' ? -1 : 1;
    }
    return 0;
  });

  // Replay
  for (const event of timeline) {
    if (event.tipo === 'pago') {
      const p = event.data;
      const targetId = p.reserva_jugador_id === null ? titularId : p.reserva_jugador_id;
      if (targetId !== null) {
        const pState = stateMap.get(targetId);
        if (pState) {
          pState.paidAlquiler += Number(p.monto_alquiler);
          pState.paidConsumo += Number(p.monto_consumo);
        }
      }
    } else {
      const c = event.data;
      const subtotal = Number(c.subtotal);
      
      // Personas saldadas justo antes de este consumo (su pago cubre su deuda actual y ya debían algo)
      const saldadas = new Set<number>();
      for (const p of personas) {
        const pState = stateMap.get(p.id);
        if (pState && (pState.paidAlquiler + pState.paidConsumo >= pState.partAlquiler + pState.partConsumo) && (pState.partAlquiler + pState.partConsumo > 0)) {
          saldadas.add(p.id);
        }
      }

      // Filtrar elegibles que no estén saldados
      let eligible = personas.filter((p) => {
        if (saldadas.has(p.id)) return false;
        if (c.tipo_reparto === 'partido') {
          return p.tipo === 'jugador';
        }
        return true;
      });

      // Si todos los elegibles están saldados, fallback a todos los elegibles
      if (eligible.length === 0) {
        eligible = personas.filter((p) => {
          if (c.tipo_reparto === 'partido') {
            return p.tipo === 'jugador';
          }
          return true;
        });
      }

      if (eligible.length > 0) {
        const share = Math.ceil(subtotal / eligible.length);
        for (const p of eligible) {
          const pState = stateMap.get(p.id);
          if (pState) {
            pState.partConsumo += share;
          }
        }
      }
    }
  }

  // Ejecutar el prorrateo al final sobre los totales asignados (COMBINADO)
  const combinedParticipants: ParticipantDebt[] = [];

  for (const p of personas) {
    const pState = stateMap.get(p.id)!;
    combinedParticipants.push({
      id: p.id,
      paid: pState.paidAlquiler + pState.paidConsumo,
      baseWeight: pState.partAlquiler + pState.partConsumo,
    });
  }

  const totalConsumos = consumos.reduce((sum, c) => sum + Number(c.subtotal), 0);
  const totalDeuda = montoAlquiler + totalConsumos;
  const saldosCombinados = distribuirDeudaPonderada(totalDeuda, combinedParticipants);

  return personas.map((persona) => {
    const pState = stateMap.get(persona.id)!;
    const yaPagadoTotal = pState.paidAlquiler + pState.paidConsumo;

    const saldo = saldosCombinados[persona.id] ?? 0;

    // Dado que se unificó la deuda, asimilamos todo el saldo a `saldoAlquiler` por compatibilidad.
    // (La UI sólo usa `saldo` y `parteTotal` de todos modos).
    const saldoAlquiler = saldo;
    const saldoConsumo = 0;

    const parteTotal = saldo + yaPagadoTotal;

    // Para no romper la consistencia visual, prorrateamos la parte calculada según la intención original
    const totalPartIntencion = pState.partAlquiler + pState.partConsumo;
    const proportion = totalPartIntencion > 0 ? pState.partAlquiler / totalPartIntencion : 1;
    
    const parteAlquiler = Math.round(parteTotal * proportion);
    const parteConsumo = parteTotal - parteAlquiler;

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
      yaPagadoAlquiler: pState.paidAlquiler,
      yaPagadoConsumo: pState.paidConsumo,
      yaPagadoTotal,
      saldoAlquiler,
      saldoConsumo,
      saldo,
      estado,
    };
  });
}
