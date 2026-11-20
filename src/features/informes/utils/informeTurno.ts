/**
 * Lógica PURA del informe de turno del vendedor. Sin Supabase ni React:
 * recibe filas plain y devuelve los números. Misma filosofía que
 * `features/dashboard/utils/kpisHoy.ts` — testeable en Node sin mocks.
 *
 * Regla de oro del EERR respetada en `totalesPorUnidad`:
 *   - alquiler de cancha → Canchas (`reserva_pagos.monto_alquiler`)
 *   - consumos del turno → Buffet/Shop según `reserva_consumos.linea`
 *   - cobro de clase → Clases (`clase_cobros.monto_clase`)
 *   - consumos de clase → Buffet/Shop según `clase_consumos.linea`
 *   - venta de mostrador → Buffet/Shop según `venta_items.linea`
 * Ingreso y costo viajan por la misma fuente (los snapshots `linea`),
 * así que la atribución no puede divergir.
 */
import type { TipoMovimientoCaja } from '@/types/database';

// ─────────────────────────────────────────────────────────────────────
// Medios de pago
// ─────────────────────────────────────────────────────────────────────

export type MedioPagoInforme =
  | 'efectivo'
  | 'transferencia'
  | 'mp'
  | 'tarjeta'
  | 'otro';

export const MEDIO_LABEL: Record<MedioPagoInforme, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mp: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

/**
 * Normaliza cualquier string de medio_pago al bucket del informe.
 * Mismo criterio que `useIngresosPorMedio` (mp/mercado_pago → mp,
 * debito/credito/tarjeta_* → tarjeta, el resto → otro).
 */
export function normalizarMedio(
  medio: string | null | undefined,
): MedioPagoInforme {
  if (!medio) return 'otro';
  if (medio === 'efectivo') return 'efectivo';
  if (medio === 'transferencia') return 'transferencia';
  if (['mp', 'mercado_pago'].includes(medio)) return 'mp';
  if (
    ['tarjeta', 'debito', 'credito', 'tarjeta_debito', 'tarjeta_credito'].includes(
      medio,
    )
  ) {
    return 'tarjeta';
  }
  return 'otro';
}

// ─────────────────────────────────────────────────────────────────────
// Cobros normalizados del turno
// ─────────────────────────────────────────────────────────────────────

export type OrigenCobro = 'reserva' | 'clase' | 'venta' | 'otro_ingreso';

export interface CobroTurno {
  /** Clave única `${origen}-${id}` para React keys y dedupe. */
  clave: string;
  origen: OrigenCobro;
  fecha_hora: string;
  descripcion: string;
  medio_pago: MedioPagoInforme;
  /** Cuenta de tesorería donde se acreditó el cobro, si está registrada. */
  cuenta_id: number | null;
  cuenta_nombre: string | null;
  /** Monto con signo: reembolsos y reversiones ya vienen negativos. */
  monto: number;
}

export interface IngresoPorMedioInforme {
  /** Agrupa por cuenta cuando está disponible, si no por medio_pago. */
  clave: string;
  medio: MedioPagoInforme;
  etiqueta: string;
  monto: number;
  count: number;
}

/**
 * Agrupa los cobros del turno por cuenta cuando está disponible, y usa el
 * medio de pago como fallback para registros históricos sin cuenta. Ordena
 * DESC por monto; el total puede ser negativo si hay más reembolsos que cobros.
 */
export function agruparCobrosPorMedio(
  cobros: ReadonlyArray<CobroTurno>,
): { items: IngresoPorMedioInforme[]; total: number } {
  const acumulado = new Map<
    string,
    { medio: MedioPagoInforme; etiqueta: string; monto: number; count: number }
  >();
  for (const cobro of cobros) {
    const etiqueta = cobro.cuenta_nombre?.trim() || MEDIO_LABEL[cobro.medio_pago];
    const clave = cobro.cuenta_nombre?.trim()
      ? `cuenta:${etiqueta.toLocaleLowerCase('es-AR')}`
      : `medio:${cobro.medio_pago}`;
    const previo = acumulado.get(clave) ?? {
      medio: cobro.medio_pago,
      etiqueta,
      monto: 0,
      count: 0,
    };
    acumulado.set(clave, {
      ...previo,
      monto: previo.monto + cobro.monto,
      count: previo.count + 1,
    });
  }
  const items = Array.from(acumulado.entries())
    .map(([clave, item]) => ({ clave, ...item }))
    .sort((a, b) => b.monto - a.monto);
  return { items, total: items.reduce((acc, i) => acc + i.monto, 0) };
}

// ─────────────────────────────────────────────────────────────────────
// Ingresos por unidad de negocio (regla de oro)
// ─────────────────────────────────────────────────────────────────────

export interface TotalesUnidadInput {
  /** `reserva_pagos` atribuidos al vendedor (reembolsos ya con signo). */
  pagosReserva: ReadonlyArray<{
    monto_alquiler: number;
    /** Informativo: NO se suma directo — los consumos entran por
     *  `consumosReserva`/`consumosClase`/`itemsVenta` con su `linea`. */
    monto_consumo?: number;
  }>;
  /** `clase_cobros` atribuidos (monto_clase null → cae a `monto`). */
  cobrosClase: ReadonlyArray<{
    monto: number;
    monto_clase: number | null;
  }>;
  /** `reserva_consumos` de las reservas cobradas en la ventana. */
  consumosReserva: ReadonlyArray<{ linea: string; subtotal: number }>;
  /** `clase_consumos` de las clases cobradas en la ventana. */
  consumosClase: ReadonlyArray<{ linea: string; subtotal: number }>;
  /** `venta_items` de las ventas POS atribuidas al vendedor. */
  itemsVenta: ReadonlyArray<{ linea: string; subtotal: number }>;
}

export interface TotalesUnidad {
  canchas: number;
  clases: number;
  buffet: number;
  shop: number;
  total: number;
}

function sumarLinea(
  acc: { buffet: number; shop: number },
  linea: string,
  subtotal: number,
): void {
  if (linea === 'shop') acc.shop += subtotal;
  else acc.buffet += subtotal; // 'buffet' y cualquier valor desconocido → buffet
}

export function totalesPorUnidad(input: TotalesUnidadInput): TotalesUnidad {
  let canchas = 0;
  let clases = 0;
  const consumo = { buffet: 0, shop: 0 };

  for (const p of input.pagosReserva) {
    canchas += Number(p.monto_alquiler) || 0;
  }
  for (const c of input.cobrosClase) {
    clases += Number(c.monto_clase ?? c.monto) || 0;
  }
  for (const c of input.consumosReserva) {
    sumarLinea(consumo, c.linea, Number(c.subtotal) || 0);
  }
  for (const c of input.consumosClase) {
    sumarLinea(consumo, c.linea, Number(c.subtotal) || 0);
  }
  for (const v of input.itemsVenta) {
    sumarLinea(consumo, v.linea, Number(v.subtotal) || 0);
  }

  const buffet = consumo.buffet;
  const shop = consumo.shop;
  return {
    canchas,
    clases,
    buffet,
    shop,
    total: canchas + clases + buffet + shop,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Arqueo de la caja del turno
// ─────────────────────────────────────────────────────────────────────

export interface ArqueoCalculado {
  apertura: number;
  cobrosReservas: number;
  cobrosVentas: number;
  cobrosClases: number;
  entradasCobros: number;
  ajustesPositivos: number;
  salidas: number;
  esperado: number;
  contado: number | null;
  diferencia: number | null;
}

/**
 * Réplica del cálculo de `fn_cerrar_caja` / `useResumenCajaAbierta`:
 * esperado = apertura + cobros efectivo (reservas + ventas + clases,
 * reembolsos restan) + ajustes positivos − salidas. `contado` y
 * `diferencia` vienen de la jornada (NULL si sigue abierta).
 */
export function calcularArqueoTurno(input: {
  montoApertura: number;
  pagosEfectivo: ReadonlyArray<{ monto: number; tipo: string }>;
  cobrosClaseEfectivo: ReadonlyArray<{ monto: number }>;
  ventaPagosEfectivo: ReadonlyArray<{ monto: number }>;
  manuales: ReadonlyArray<{ tipo: TipoMovimientoCaja; monto: number }>;
  efectivoContado: number | null;
  diferenciaGuardada: number | null;
}): ArqueoCalculado {
  const cobrosReservas = input.pagosEfectivo.reduce(
    (acc, p) => acc + (p.tipo === 'reembolso' ? -Number(p.monto) : Number(p.monto)),
    0,
  );
  const cobrosClases = input.cobrosClaseEfectivo.reduce(
    (acc, c) => acc + Number(c.monto),
    0,
  );
  const cobrosVentas = input.ventaPagosEfectivo.reduce(
    (acc, v) => acc + Number(v.monto),
    0,
  );
  const entradasCobros = cobrosReservas + cobrosVentas + cobrosClases;

  let ajustesPositivos = 0;
  let salidas = 0;
  for (const m of input.manuales) {
    if (m.tipo === 'ajuste_positivo') ajustesPositivos += Number(m.monto);
    else salidas += Number(m.monto);
  }

  const esperado =
    Number(input.montoApertura) + entradasCobros + ajustesPositivos - salidas;

  return {
    apertura: Number(input.montoApertura),
    cobrosReservas,
    cobrosVentas,
    cobrosClases,
    entradasCobros,
    ajustesPositivos,
    salidas,
    esperado,
    contado: input.efectivoContado,
    diferencia: input.diferenciaGuardada,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Top productos vendidos (POS + consumos de turno/clase)
// ─────────────────────────────────────────────────────────────────────

export interface ProductoVendido {
  nombre: string;
  cantidad: number;
  total: number;
}

/**
 * Ranking de productos más vendidos. Acepta items de `venta_items` y
 * `reserva_consumos`/`clase_consumos` juntos (todos tienen
 * producto_nombre + cantidad + subtotal).
 */
export function topProductosVendidos(
  items: ReadonlyArray<{
    producto_nombre: string;
    cantidad: number;
    subtotal: number;
  }>,
  limite = 5,
): ProductoVendido[] {
  const mapa = new Map<string, ProductoVendido>();
  for (const it of items) {
    const nombre = it.producto_nombre?.trim() || 'Producto';
    const prev = mapa.get(nombre) ?? { nombre, cantidad: 0, total: 0 };
    mapa.set(nombre, {
      nombre,
      cantidad: prev.cantidad + (Number(it.cantidad) || 0),
      total: prev.total + (Number(it.subtotal) || 0),
    });
  }
  return Array.from(mapa.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limite);
}
